"""Generate mock /predict responses so the 3D scene and dashboard can be built
before the real models exist (overview section 8 tip).

The numbers are invented but internally consistent: conformal sets follow the
split-conformal rule, uncertainty is distance from 0.5, the coherence flag uses
the shared rule in src/contract.py, group totals are sums of feature SHAP values,
and every response validates against app/schemas.py.

Run:  python scripts/make_mock_fixtures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas import PredictResponse  # noqa: E402
from src import config, contract, data
from src import explain as wording  # noqa: E402

# Both labels enter the set when 1 - qhat <= p <= qhat, which needs qhat > 0.5.
MOCK_QHAT = 0.62       # probabilities in [0.38, 0.62] become "Uncertain"
MOCK_VERSION = "mock-0"

# Group and normal range come from features.yaml; only the mock "physiology" lives here.
# name: (healthy reference, scale). Negative scale = higher value lowers risk.
MOCK_EFFECT = {
    "age": (50, 12), "sex_male": (0, 1), "bmi": (24, 4),
    "diabetes": (0, 1), "hypertension": (0, 1), "current_smoker": (0, 1),
    "typical_chest_pain": (0, 1.5),
    "bp": (120, 20), "pulse_rate": (75, 15),
    "fbs": (95, 30), "tg": (130, 60), "ldl": (100, 30), "hdl": (45, -10),
    "creatinine": (1.0, 0.3), "esr": (15, 12),
    "q_wave": (0, 1), "st_elevation": (0, 1), "st_depression": (0, 1), "t_inversion": (0, 1),
    "lvh": (0, 1), "ef_tte": (55, -8), "region_rwma": (0, 1),
}

# Per-target emphasis, so each vessel gets its own explanation (module 03, 3.1).
GROUP_WEIGHT = {
    "CAD": {"Demographics": 0.35, "History": 0.25, "Symptoms": 0.40, "Vitals": 0.20,
            "Labs": 0.18, "ECG": 0.30, "Echo": 0.30},
    "LAD": {"Demographics": 0.25, "History": 0.18, "Symptoms": 0.30, "Vitals": 0.12,
            "Labs": 0.12, "ECG": 0.40, "Echo": 0.35},
    "LCX": {"Demographics": 0.20, "History": 0.20, "Symptoms": 0.22, "Vitals": 0.15,
            "Labs": 0.20, "ECG": 0.18, "Echo": 0.20},
    "RCA": {"Demographics": 0.22, "History": 0.25, "Symptoms": 0.22, "Vitals": 0.18,
            "Labs": 0.15, "ECG": 0.30, "Echo": 0.15},
}

_KEYS = list(MOCK_EFFECT)


def _inputs(*values) -> dict:
    return dict(zip(_KEYS, values, strict=True))


SCENARIOS = {
    #                      age sex bmi  dm htn smk tcp  bp  pr  fbs  tg  ldl hdl  cr   esr qw ste std ti lvh ef rwma
    "demo-low":        {"inputs": _inputs(38, 0, 23.0, 0, 0, 0, 0, 115, 72, 88, 110, 90, 55, 0.8, 10, 0, 0, 0, 0, 0, 60, 0),
                        "probs": {"CAD": 0.12, "LAD": 0.14, "LCX": 0.08, "RCA": 0.10}},
    "demo-mixed":      {"inputs": _inputs(57, 1, 28.5, 0, 1, 1, 0, 138, 84, 118, 190, 128, 38, 1.1, 18, 0, 0, 0, 1, 0, 50, 0),
                        "probs": {"CAD": 0.68, "LAD": 0.58, "LCX": 0.44, "RCA": 0.22}},
    "demo-high":       {"inputs": _inputs(66, 1, 30.1, 1, 1, 1, 1, 160, 92, 162, 240, 155, 32, 1.3, 28, 1, 1, 0, 1, 1, 35, 2),
                        "probs": {"CAD": 0.93, "LAD": 0.86, "LCX": 0.61, "RCA": 0.74}},
    # Overall model is confident but no vessel model is: exercises the coherence banner.
    "demo-discordant": {"inputs": _inputs(70, 0, 26.0, 1, 1, 0, 1, 150, 80, 105, 160, 110, 42, 1.0, 22, 0, 0, 1, 0, 0, 55, 0),
                        "probs": {"CAD": 0.81, "LAD": 0.27, "LCX": 0.18, "RCA": 0.24}},
}


def _spec(name: str) -> dict:
    return next(f for f in data.features() if f["name"] == name)


def conformal_set(p: float, qhat: float = MOCK_QHAT) -> list[str]:
    out = []
    if 1 - p <= qhat:
        out.append(contract.POSITIVE)
    if p <= qhat:
        out.append(contract.NEGATIVE)
    return out


def uncertainty(p: float) -> float:
    return round(1 - abs(2 * p - 1), 2)


def submodel_range(p: float) -> list[float]:
    """Mock sub-model range: wider when the estimate is ambiguous (like the real fold ensemble)."""
    half = 0.03 + 0.12 * uncertainty(p)
    return [round(max(0.0, p - half), 4), round(min(1.0, p + half), 4)]


def range_status(value, rng):
    if rng is None or not isinstance(value, (int, float)):
        return None
    lo, hi = rng
    if lo is not None and value < lo:
        return "below"
    if hi is not None and value > hi:
        return "above"
    return "within"


def explain(target: str, inputs: dict) -> dict:
    feats = []
    for name, value in inputs.items():
        spec = _spec(name)
        ref, scale = MOCK_EFFECT[name]
        shap = round(GROUP_WEIGHT[target][spec["group"]] * (value - ref) / scale * 0.4, 3)
        feats.append({"name": name, "value": value, "shap": shap, "group": spec["group"],
                      "range_status": range_status(value, spec.get("normal_range"))})
    feats.sort(key=lambda f: abs(f["shap"]), reverse=True)

    groups = {g: 0.0 for g in config.feature_groups()}
    for f in feats:
        groups[f["group"]] += f["shap"]
    groups = {g: round(v, 3) for g, v in groups.items()}

    return {"groups": groups, "features": feats,
            "text": wording.clinician_text(target, feats, "log-odds"),
            "text_patient": wording.patient_text(target, feats),
            "base_value": 0.0, "units": "log-odds"}


def build(patient_id: str, scenario: dict) -> dict:
    probs, inputs = scenario["probs"], scenario["inputs"]
    overall_t = config.overall_target()
    p_cad = probs[overall_t]
    cad_set = conformal_set(p_cad)
    vessels = {}
    for v in config.vessel_ids():
        s = conformal_set(probs[v])
        vessels[v] = {"prob": probs[v], "uncertainty": uncertainty(probs[v]),
                      "set": s, "state": contract.state_from_set(s), "range": submodel_range(probs[v])}
    return {
        "patient_id": patient_id,
        "overall": {"prob": p_cad, "uncertainty": uncertainty(p_cad), "set": cad_set,
                    "state": contract.state_from_set(cad_set),
                    "label": contract.overall_label(cad_set), "range": submodel_range(p_cad)},
        "vessels": vessels,
        "coherence": contract.coherence(p_cad, {v: probs[v] for v in config.vessel_ids()}),
        "explanations": {t: explain(t, inputs) for t in config.all_targets()},
        "imputed": [],
        "ood": {"flag": False, "out_of_range": [], "unusual_combination": False, "typicality": 0.5, "reasons": []},
        "model_version": MOCK_VERSION,
        "disclaimer": config.disclaimer(),
    }


def main() -> None:
    out_dir = config.FIXTURES_DIR / "responses"
    out_dir.mkdir(parents=True, exist_ok=True)
    patients = {}
    for pid, scenario in SCENARIOS.items():
        resp = PredictResponse.model_validate(build(pid, scenario)).model_dump()
        (out_dir / f"{pid}.json").write_text(json.dumps(resp, indent=2) + "\n", encoding="utf-8")
        patients[pid] = scenario["inputs"]
        print(f"wrote {pid}.json  overall={resp['overall']['label']}  "
              f"coherence_flag={resp['coherence']['flag']}")
    (config.FIXTURES_DIR / "demo_patients.json").write_text(
        json.dumps(patients, indent=2) + "\n", encoding="utf-8")
    # The registry payload exactly as GET /features serves it (the web CSV tests import this).
    from app.main import features as features_endpoint
    (config.FIXTURES_DIR / "features.json").write_text(
        json.dumps(features_endpoint(), indent=2) + "\n", encoding="utf-8")
    print("wrote features.json")


if __name__ == "__main__":
    main()
