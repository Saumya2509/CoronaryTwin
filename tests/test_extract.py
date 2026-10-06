"""Report reading (src/extract.py, POST /extract): rules, units, negation, Claude path (mocked)."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.main import app
from src import extract

SAMPLES = Path(__file__).resolve().parents[1] / "samples" / "reports"


def read(text: str) -> dict:
    return {f.name: f for f in extract.parse_lines(text.splitlines(), "t.txt", "text")}


def test_units_are_converted_to_model_units():
    f = read("Fasting glucose 7.4 mmol/L 3.9 - 5.5\nCreatinine 97 µmol/L\nLDL cholesterol 3.9 mmol/L\n"
             "Haemoglobin 138 g/L\nWhite blood cells 7.8 x10^9/L\nTriglycerides 2.6 mmol/L")
    assert f["fbs"].value == pytest.approx(133.3, abs=0.1)
    assert f["creatinine"].value == pytest.approx(1.1, abs=0.01)
    assert f["ldl"].value == pytest.approx(150.8, abs=0.1)
    assert f["hb"].value == pytest.approx(13.8)
    assert f["wbc"].value == 7800
    assert f["tg"].value == pytest.approx(230.3, abs=0.1)
    assert "converted from 7.4 mmol/l" in f["fbs"].note


def test_missing_unit_is_inferred_but_flagged_low():
    f = read("FBS: 6.1")
    assert f["fbs"].value == pytest.approx(109.9, abs=0.1)
    assert f["fbs"].confidence == "low"


def test_implausible_values_are_dropped():
    assert "ldl" not in read("LDL 9000 mg/dL")


def test_negation_and_yes_no():
    f = read("No pathological Q waves. ST depression of 1 mm in V4-V6.\nHypertension: Yes   Diabetes: No\n"
             "No left bundle branch block. Normal R wave progression.")
    assert f["q_wave"].value == 0 and f["st_depression"].value == 1
    assert f["hypertension"].value == 1 and f["diabetes"].value == 0
    assert f["bbb"].value == "none" and f["poor_r_progression"].value == 0


def test_no_st_t_changes_clears_three_findings():
    f = read("Sinus rhythm, no ST-T changes.")
    assert f["st_elevation"].value == f["st_depression"].value == f["t_inversion"].value == 0


def test_chest_pain_type_sets_all_three_flags():
    f = read("Atypical chest pain for two weeks.")
    assert (f["atypical_chest_pain"].value, f["typical_chest_pain"].value, f["nonanginal_chest_pain"].value) == (1, 0, 0)


def test_vitals_demographics_echo():
    f = read("62-year-old woman. BP 148/92 mmHg, pulse 84 bpm.\nLVEF 40-45%. RWMA in 2 segments. Moderate aortic stenosis.")
    assert f["age"].value == 62 and f["sex_male"].value == 0
    assert f["bp"].value == 148 and f["pulse_rate"].value == 84
    assert f["ef_tte"].value == pytest.approx(42.5)
    assert f["region_rwma"].value == 2 and f["vhd"].value == 2


def test_rejects_unknown_binary_and_limits():
    out = extract.extract([("x.bin", b"\x00\x01\x02")])
    assert out["findings"] == [] and out["warnings"]
    with pytest.raises(ValueError):
        extract.extract([])


def test_conflicting_files_warn():
    out = extract.extract([("a.txt", b"LDL 120 mg/dL"), ("b.txt", b"LDL 160 mg/dL")])
    assert [f["value"] for f in out["findings"] if f["name"] == "ldl"] == [120]
    assert any("LDL" in w for w in out["warnings"])


def test_claude_claims_go_through_same_checks():
    claims = [{"feature": "ldl", "value": "3.9", "unit": "mmol/L", "evidence": "LDL 3.9 mmol/L"},
              {"feature": "q_wave", "value": "no", "unit": "", "evidence": "No Q waves"},
              {"feature": "hdl", "value": "900", "unit": "mg/dL", "evidence": "nonsense"},
              {"feature": "bbb", "value": "LBBB", "unit": "", "evidence": "LBBB"},
              {"feature": "function_class", "value": "2", "unit": "", "evidence": "NYHA II"}]
    f = {x.name: x for x in extract.normalize_claims(claims, "r.pdf")}
    assert f["ldl"].value == pytest.approx(150.8, abs=0.1) and f["q_wave"].value == 0 and f["bbb"].value == "left"
    assert "hdl" not in f and "function_class" not in f


def test_claude_request_shape():
    sent = {}

    class Fake:
        class beta:
            class messages:
                @staticmethod
                def create(**kw):
                    sent.update(kw)
                    body = json.dumps({"values": [{"feature": "age", "value": "61", "unit": "years", "evidence": "Age: 61"}]})
                    return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=body)])

    out = extract.claude_extract([("r.pdf", b"%PDF-1.4 x"), ("e.png", b"\x89PNG\r\n\x1a\nxxxx")], client=Fake())
    assert [(f.name, f.value, f.method) for f in out] == [("age", 61, "claude")]
    assert sent["model"] == "claude-opus-5-5"
    assert sent["output_config"]["format"]["type"] == "json_schema"
    kinds = [c["type"] for c in sent["messages"][0]["content"]]
    assert kinds == ["document", "image", "text"]


def test_endpoint_reads_text_and_refuses_claude_when_disabled(monkeypatch):
    monkeypatch.delenv("CORONARYTWIN_CLAUDE_EXTRACT", raising=False)
    with TestClient(app) as c:
        r = c.post("/extract", files=[("files", ("note.txt", b"Age: 58\nSex: Female\nLDL 130 mg/dL"))])
        assert r.status_code == 200
        body = r.json()
        assert {f["name"] for f in body["findings"]} == {"age", "sex_male", "ldl"} and body["stored"] is False
        r = c.post("/extract", files=[("files", ("note.txt", b"LDL 130"))], data={"use_claude": "true"})
        assert r.status_code == 400
        assert c.get("/extract/capabilities").json()["claude"] is False


@pytest.mark.skipif(not SAMPLES.exists(), reason="sample reports not generated")
def test_sample_reports_end_to_end():
    if extract.ocr_engine() is None:
        pytest.skip("OCR not installed")
    files = [(p.name, p.read_bytes()) for p in sorted(SAMPLES.iterdir())]
    f = {x["name"]: x for x in extract.extract(files)["findings"]}
    expect = {"age": 61, "sex_male": 1, "bp": 148, "typical_chest_pain": 1, "st_depression": 1, "t_inversion": 1,
              "q_wave": 0, "ef_tte": 45, "region_rwma": 2, "vhd": 1, "hdl": 34.8, "diabetes": 1, "current_smoker": 0}
    assert {k: f[k]["value"] for k in expect} == expect
    assert len(f) >= 38
