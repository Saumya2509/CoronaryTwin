"""SQLite database (app/db.py) and view_db.py: reference tables, privacy-safe prediction log."""
import io
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db, registry
from app.main import app
from src import config, data

SECRET_ID = "Jane-Doe-1970"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def high(client):
    if registry.mode() != "models":
        pytest.skip("trained models not available")
    return client.get("/demo-patients").json()["high"]["features"]


def rows(sql, params=()):
    with db.connect() as con:
        return con.execute(sql, params).fetchall()


def test_reference_tables_created(client):
    assert rows("SELECT COUNT(*) FROM features")[0][0] == len(data.feature_names())
    if registry.mode() == "models":
        assert {r[0] for r in rows("SELECT target FROM models")} == set(config.all_targets())


def test_predict_is_logged_without_inputs_or_patient_id(client, high):
    before = rows("SELECT COUNT(*) FROM prediction_log")[0][0]
    body = client.post("/predict", json={"features": high, "patient_id": SECRET_ID}).json()
    assert rows("SELECT COUNT(*) FROM prediction_log")[0][0] == before + 1
    log_id = rows("SELECT MAX(id) FROM prediction_log")[0][0]
    res = dict(rows("SELECT target, prob FROM prediction_results WHERE log_id = ?", (log_id,)))
    assert res[config.overall_target()] == pytest.approx(body["overall"]["prob"])
    assert set(res) == set(config.all_targets())
    # Privacy: dump every table except the public reference data; no input value or ID appears.
    with db.connect() as con:
        dump = "\n".join(con.iterdump())
    log_dump = "\n".join(l for l in dump.splitlines() if "prediction_" in l)
    assert SECRET_ID not in dump
    for name in ("ldl", "age", "bmi", "typical_chest_pain"):
        assert name not in log_dump
    cols = {r[1] for r in rows("PRAGMA table_info(prediction_log)")}
    assert not cols & set(data.feature_names()) and "patient_id" not in cols


def test_batch_logs_one_row_per_patient(client, high):
    cols = data.feature_names()
    csv = "\n".join([",".join(cols)] + [",".join("" if high[c] is None else str(high[c]) for c in cols)] * 3)
    before = rows("SELECT COUNT(*) FROM prediction_log WHERE endpoint = 'batch'")[0][0]
    client.post("/predict/batch", files={"file": ("c.csv", io.BytesIO(csv.encode()), "text/csv")})
    assert rows("SELECT COUNT(*) FROM prediction_log WHERE endpoint = 'batch'")[0][0] == before + 3


def test_summary_endpoint(client, high):
    s = client.get("/log/summary").json()
    assert s["enabled"] and s["predictions"] >= 1 and "privacy" in s


def test_disabled_writes_nothing(monkeypatch):
    monkeypatch.setenv("CORONARYTWIN_DB", "off")
    assert db.db_path() is None
    assert db.log_predictions("predict", "v", [{"overall": {}, "vessels": {}, "coherence": {"flag": False}}]) == 0
    assert db.summary() == {"enabled": False}


def test_view_db_is_read_only_and_runs(client, high, capsys):
    import view_db
    view_db.main([])
    assert "prediction_log" in capsys.readouterr().out
    view_db.main(["--log", "5"])
    assert "%" in capsys.readouterr().out
    with pytest.raises(SystemExit, match="readonly"):
        view_db.main(["--sql", "DELETE FROM prediction_log"])
    with pytest.raises(sqlite3.OperationalError):
        con = view_db.open_ro(db.db_path())
        con.execute("DROP TABLE features")
