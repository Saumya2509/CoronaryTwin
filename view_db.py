"""Browse the CoronaryTwin SQLite database from the command line (read-only).

    python view_db.py                       overview: tables, row counts, latest predictions
    python view_db.py --log 50              the 50 latest predictions, one line each with all targets
    python view_db.py --table models        any table (features, models, dataset, prediction_log, ...)
    python view_db.py --stats               states and mean probability per target over the whole log
    python view_db.py --sql "SELECT target, AVG(prob) FROM prediction_results GROUP BY target"
    python view_db.py --log 500 --csv log.csv   write the result to a CSV file instead of printing

The database path comes from CORONARYTWIN_DB or config/settings.yaml (default data/coronarytwin.db).
It is opened read-only, so this script can never change it. The prediction log holds model outputs
only: no patient input values and no patient IDs.
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from app.db import db_path  # noqa: E402

LOG_QUERY = """
SELECT l.id, l.created_at, l.endpoint, l.model_version AS model, l.n_missing AS missing,
       COALESCE(l.ood_flag, '') AS ood, l.coherence_flag AS coherence, l.latency_ms AS ms,
       {cols}
FROM prediction_log l
{joins}
ORDER BY l.id DESC LIMIT ?
"""


def open_ro(path: Path) -> sqlite3.Connection:
    if not path.exists():
        sys.exit(f"No database at {path}. Start the API once (python tasks.py serve) to create it.")
    return sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)


def targets(con: sqlite3.Connection) -> list[str]:
    rows = con.execute("SELECT DISTINCT target FROM prediction_results").fetchall()
    order = {"CAD": 0, "LAD": 1, "LCX": 2, "RCA": 3}
    return sorted((r[0] for r in rows), key=lambda t: (order.get(t, 9), t))


def log_query(con: sqlite3.Connection) -> str:
    ts = targets(con)
    if not ts:
        return LOG_QUERY.format(cols="NULL AS results", joins="")
    cols = ", ".join(f"printf('%.0f%% %s', r{i}.prob * 100, r{i}.state) AS {t}" for i, t in enumerate(ts))
    joins = "\n".join(f"LEFT JOIN prediction_results r{i} ON r{i}.log_id = l.id AND r{i}.target = '{t}'"
                      for i, t in enumerate(ts))
    return LOG_QUERY.format(cols=cols, joins=joins)


def show(headers: list[str], rows: list[tuple], csv_path: str | None = None, max_width: int = 28) -> None:
    if csv_path:
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(headers)
            w.writerows(rows)
        print(f"wrote {len(rows)} rows to {csv_path}")
        return
    if not rows:
        print("(no rows)")
        return
    cells = [[("" if v is None else str(v))[:max_width] for v in r] for r in rows]
    widths = [max(len(h), *(len(r[i]) for r in cells)) for i, h in enumerate(headers)]
    print("  ".join(h.ljust(w) for h, w in zip(headers, widths)))
    print("  ".join("-" * w for w in widths))
    for r in cells:
        print("  ".join(v.ljust(w) for v, w in zip(r, widths)))


def run(con: sqlite3.Connection, sql: str, params: tuple = (), csv_path: str | None = None) -> None:
    cur = con.execute(sql, params)
    show([d[0] for d in cur.description], cur.fetchall(), csv_path)


def overview(con: sqlite3.Connection, path: Path) -> None:
    print(f"Database: {path}  ({path.stat().st_size / 1024:.0f} KB)\n")
    tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    show(["table", "rows"], [(t, con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]) for t in tables])
    print("\nLatest predictions (outputs only; no inputs or patient IDs are stored):")
    run(con, log_query(con), (10,))
    print("\nMore: --log N, --stats, --table NAME, --sql \"SELECT ...\", --csv FILE  (see --help)")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--db", help="database file (default: CORONARYTWIN_DB or settings)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--log", type=int, metavar="N", help="latest N predictions")
    g.add_argument("--table", metavar="NAME", help="show a table")
    g.add_argument("--stats", action="store_true", help="per-target summary of the log")
    g.add_argument("--sql", metavar="QUERY", help="run a read-only SQL query")
    ap.add_argument("--limit", type=int, default=50, help="rows for --table (default 50)")
    ap.add_argument("--csv", metavar="FILE", help="write the result to CSV instead of printing")
    args = ap.parse_args(argv)

    path = Path(args.db) if args.db else db_path()
    if path is None:
        sys.exit("The database is disabled (CORONARYTWIN_DB=off or settings database.enabled: false).")
    con = open_ro(path)
    try:
        if args.log:
            run(con, log_query(con), (args.log,), args.csv)
        elif args.table:
            names = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if args.table not in names:
                sys.exit(f"No table {args.table!r}. Tables: {', '.join(sorted(n for n in names if not n.startswith('sqlite_')))}")
            run(con, f'SELECT * FROM "{args.table}" LIMIT ?', (args.limit,), args.csv)
        elif args.stats:
            run(con, """
                SELECT target, state, COUNT(*) AS n, printf('%.1f%%', AVG(prob) * 100) AS mean_prob,
                       printf('%.2f', AVG(uncertainty)) AS mean_uncertainty
                FROM prediction_results GROUP BY target, state ORDER BY target, state""", (), args.csv)
        elif args.sql:
            run(con, args.sql, (), args.csv)
        else:
            overview(con, path)
    except sqlite3.Error as e:
        sys.exit(f"SQL error: {e}")
    finally:
        con.close()


if __name__ == "__main__":
    main()
