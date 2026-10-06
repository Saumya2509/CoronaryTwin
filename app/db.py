"""SQLite database for the API: reference data plus a privacy-safe prediction log.

    data/coronarytwin.db        (override with CORONARYTWIN_DB=<path>; CORONARYTWIN_DB=off disables it)
    python view_db.py            # browse it from the command line

Tables
  features              the feature registry (features.yaml): name, label, type, group, unit, modifiable
  models                one row per served model: version, family, threshold, conformal qhat, CV metrics
  dataset               the public training data (Extension of Z-Alizadeh Sani, 303 rows), when available
  prediction_log        one row per scored patient: time, endpoint, model version, how many values were
                        missing, OOD and coherence flags, latency
  prediction_results    per log row and target: probability, state, uncertainty

Privacy: the log holds model OUTPUTS only. Patient input values and the patient ID are never written,
so nothing in the database can identify or reconstruct a patient. Writing is best effort: a database
error is logged and never fails a prediction.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import pandas as pd

from src import config, data

log = logging.getLogger("coronarytwin.db")
ENV = "CORONARYTWIN_DB"

SCHEMA = """
CREATE TABLE IF NOT EXISTS features (
  name TEXT PRIMARY KEY, label TEXT NOT NULL, type TEXT NOT NULL, grp TEXT NOT NULL,
  unit TEXT, modifiable INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  version TEXT NOT NULL, target TEXT NOT NULL, family TEXT NOT NULL, threshold REAL, qhat REAL,
  roc_auc REAL, roc_auc_lo REAL, roc_auc_hi REAL, brier REAL, coverage REAL, uncertain_rate REAL,
  loaded_at TEXT NOT NULL, PRIMARY KEY (version, target)
);
CREATE TABLE IF NOT EXISTS prediction_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  endpoint TEXT NOT NULL,              -- predict | batch
  model_version TEXT NOT NULL,
  n_missing INTEGER NOT NULL,          -- how many of the 51 values were imputed (count only)
  ood_flag INTEGER,                    -- input unlike the training data
  coherence_flag INTEGER NOT NULL,     -- overall and artery estimates disagree
  latency_ms REAL
);
CREATE TABLE IF NOT EXISTS prediction_results (
  log_id INTEGER NOT NULL REFERENCES prediction_log(id) ON DELETE CASCADE,
  target TEXT NOT NULL, prob REAL NOT NULL, state TEXT NOT NULL, uncertainty REAL,
  PRIMARY KEY (log_id, target)
);
CREATE INDEX IF NOT EXISTS ix_log_time ON prediction_log(created_at);
"""


def db_path() -> Path | None:
    """Database file, or None when disabled (CORONARYTWIN_DB=off or settings database.enabled: false)."""
    env = os.environ.get(ENV, "").strip()
    if env.lower() in {"off", "0", "false", "no"}:
        return None
    cfg = config.settings().get("database", {})
    if not env and cfg.get("enabled") is False:
        return None
    p = Path(env or cfg.get("path", "data/coronarytwin.db"))
    return p if p.is_absolute() else config.ROOT / p


@contextmanager
def connect(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    path = path or db_path()
    if path is None:
        raise RuntimeError("database disabled")
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path, timeout=10)
    try:
        con.execute("PRAGMA foreign_keys = ON")
        con.execute("PRAGMA journal_mode = WAL")   # readers (view_db.py) never block the API
        yield con
        con.commit()
    finally:
        con.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init(registry: dict | None = None, metrics: dict | None = None) -> Path | None:
    """Create tables and refresh the reference data. Safe to call at every start."""
    path = db_path()
    if path is None:
        return None
    try:
        with connect(path) as con:
            con.executescript(SCHEMA)
            con.execute("DELETE FROM features")
            con.executemany(
                "INSERT INTO features VALUES (?, ?, ?, ?, ?, ?)",
                [(f["name"], f["label"], f["type"], f["group"], f.get("unit"), int(bool(f.get("modifiable"))))
                 for f in data.features()])
            if registry:
                tm = (metrics or {}).get("targets", {})
                for t, e in registry["targets"].items():
                    m = tm.get(t, {})
                    auc = m.get("metrics_at_0.5", {}).get("roc_auc", {})
                    con.execute(
                        "INSERT OR REPLACE INTO models VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (registry["version"], t, e["family"], e.get("threshold"), e.get("qhat"),
                         auc.get("mean"), *(auc.get("ci95") or [None, None]),
                         m.get("metrics_at_0.5", {}).get("brier", {}).get("mean"),
                         m.get("conformal", {}).get("coverage"), m.get("conformal", {}).get("uncertain_rate"),
                         _now()))
        _load_dataset(path)
        return path
    except Exception as e:  # never block the API on the database
        log.warning("database init failed (%s): %s", path, e)
        return None


def _load_dataset(path: Path) -> None:
    """Public training data, if the processed CSV is present (it is not shipped in Docker images)."""
    if not data.PROCESSED_CSV.exists():
        return
    with connect(path) as con:
        exists = con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dataset'").fetchone()
        if exists and con.execute("SELECT COUNT(*) FROM dataset").fetchone()[0] > 0:
            return
        pd.read_csv(data.PROCESSED_CSV).to_sql("dataset", con, if_exists="replace", index=False)


def log_predictions(endpoint: str, model_version: str, rows: list[dict], latency_ms: float | None = None) -> int:
    """Append one log row per scored patient. `rows` are prediction outputs (overall, vessels,
    coherence, imputed, ood); any input values they carry are ignored. Returns rows written."""
    if db_path() is None or not rows:
        return 0
    try:
        with connect() as con:
            written = 0
            for r in rows:
                ood = r.get("ood")
                ood_flag = ood.get("flag") if isinstance(ood, dict) else ood
                cur = con.execute(
                    "INSERT INTO prediction_log (created_at, endpoint, model_version, n_missing, ood_flag,"
                    " coherence_flag, latency_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (_now(), endpoint, model_version, len(r.get("imputed") or []),
                     None if ood_flag is None else int(bool(ood_flag)), int(bool(r["coherence"]["flag"])),
                     None if latency_ms is None else round(latency_ms / max(1, len(rows)), 1)))
                results = [(config.overall_target(), r["overall"]), *r["vessels"].items()]
                con.executemany(
                    "INSERT INTO prediction_results VALUES (?, ?, ?, ?, ?)",
                    [(cur.lastrowid, t, float(x["prob"]), x["state"], x.get("uncertainty")) for t, x in results])
                written += 1
            return written
    except Exception as e:
        log.warning("prediction log write failed: %s", e)
        return 0


def summary() -> dict:
    """Aggregate view of the log for GET /log/summary (counts only, nothing per patient)."""
    if db_path() is None:
        return {"enabled": False}
    with connect() as con:
        total = con.execute("SELECT COUNT(*) FROM prediction_log").fetchone()[0]
        by_endpoint = dict(con.execute("SELECT endpoint, COUNT(*) FROM prediction_log GROUP BY endpoint").fetchall())
        flags = con.execute("SELECT COALESCE(SUM(ood_flag), 0), COALESCE(SUM(coherence_flag), 0) FROM prediction_log").fetchone()
        states = {}
        for t, s, n, p in con.execute(
                "SELECT target, state, COUNT(*), AVG(prob) FROM prediction_results GROUP BY target, state"):
            states.setdefault(t, {})[s] = {"n": n, "mean_prob": round(p, 4)}
        first, last = con.execute("SELECT MIN(created_at), MAX(created_at) FROM prediction_log").fetchone()
    return {"enabled": True, "predictions": total, "by_endpoint": by_endpoint,
            "ood_flags": flags[0], "coherence_flags": flags[1], "states": states,
            "first": first, "last": last,
            "privacy": "Outputs only: no patient input values or patient IDs are stored."}


class Timer:
    """`with Timer() as t: ...; t.ms` for the latency column."""

    def __enter__(self):
        self.start = time.perf_counter()
        return self

    def __exit__(self, *exc):
        self.ms = (time.perf_counter() - self.start) * 1000

