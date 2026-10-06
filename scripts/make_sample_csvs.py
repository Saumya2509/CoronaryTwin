"""Generate csv/: 50 SYNTHETIC patient files covering clinical profiles, data-quality
cases and batch uploads, for trying and testing the upload workflow.

    python scripts/make_sample_csvs.py

These are invented patients, not real people and not dataset rows. Values stay inside
the registry's valid ranges unless a file is meant to test validation. Each profile
starts from typical (median) values and overrides only what defines the scenario.
csv/README.md lists every file with the model's estimate, which is model output, not
ground truth.
"""
from __future__ import annotations

import csv
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import config, data, explain  # noqa: E402

OUT = config.ROOT / "csv"
SEED = 20261002
FEATS = data.features()
NAMES = [f["name"] for f in FEATS]
SPEC = {f["name"]: f for f in FEATS}
STATS = explain.load_stats()

# Typical adult values: medians for numbers, "absent" for findings, none for BBB.
BASE = {}
for f in FEATS:
    if f["type"] == "binary":
        BASE[f["name"]] = 0
    elif f["type"] == "categorical":
        BASE[f["name"]] = "none"
    elif f["name"] in ("function_class", "region_rwma", "vhd"):
        BASE[f["name"]] = 0
    else:
        st = STATS[f["name"]]
        step = f.get("step", 1)
        BASE[f["name"]] = round(round(st["median"] / step) * step, 2)
BASE.update({"ef_tte": 55, "bp": 120, "pulse_rate": 76, "hb": 14.0, "k": 4.3, "na": 140})


def patient(**overrides) -> dict:
    p = dict(BASE)
    for k, v in overrides.items():
        if k not in SPEC:
            raise KeyError(f"unknown feature {k}")
        p[k] = v
    return p


# ---------------------------------------------------------------- 01-30 clinical profiles
PROFILES = [
    ("healthy_young_woman", "34-year-old woman, no symptoms, normal tests.",
     patient(age=34, sex_male=0, bmi=22.5, bp=110, ldl=95, hdl=60, tg=90, fbs=88)),
    ("healthy_young_man", "31-year-old man, active, no risk factors.",
     patient(age=31, sex_male=1, bmi=23.8, bp=118, ldl=100, hdl=50, tg=105, fbs=90)),
    ("middle_aged_asymptomatic", "52-year-old man, no chest pain, mildly raised cholesterol.",
     patient(age=52, sex_male=1, bmi=26.4, ldl=128, tg=160)),
    ("typical_angina_smoker", "58-year-old male smoker with typical exertional chest pain.",
     patient(age=58, sex_male=1, current_smoker=1, typical_chest_pain=1, function_class=1, bmi=27.9, ldl=145, hdl=36)),
    ("diabetic_hypertensive_woman", "66-year-old woman with diabetes and hypertension.",
     patient(age=66, sex_male=0, diabetes=1, hypertension=1, bp=150, fbs=168, bmi=30.2, tg=210)),
    ("elderly_typical_angina", "78-year-old man with typical angina and low-threshold symptoms.",
     patient(age=78, sex_male=1, typical_chest_pain=1, low_threshold_angina=1, function_class=2, hypertension=1, bp=145)),
    ("atypical_pain_young_woman", "39-year-old woman with atypical chest pain, normal ECG.",
     patient(age=39, sex_male=0, atypical_chest_pain=1, bmi=24.0)),
    ("nonanginal_pain", "46-year-old man with non-anginal chest pain.",
     patient(age=46, sex_male=1, nonanginal_chest_pain=1)),
    ("st_elevation_q_wave", "63-year-old man, ST elevation and Q waves on ECG.",
     patient(age=63, sex_male=1, st_elevation=1, q_wave=1, typical_chest_pain=1, t_inversion=1)),
    ("st_depression_only", "59-year-old woman with ST depression, otherwise unremarkable.",
     patient(age=59, sex_male=0, st_depression=1)),
    ("t_wave_inversion", "55-year-old man with T-wave inversion.",
     patient(age=55, sex_male=1, t_inversion=1)),
    ("left_bundle_branch_block", "70-year-old man with left bundle branch block.",
     patient(age=70, sex_male=1, bbb="left", hypertension=1)),
    ("right_bundle_branch_block", "62-year-old woman with right bundle branch block.",
     patient(age=62, sex_male=0, bbb="right")),
    ("reduced_ef_wall_motion", "68-year-old man, EF 30%, three regions with wall-motion abnormality.",
     patient(age=68, sex_male=1, ef_tte=30, region_rwma=3, dyspnea=1, function_class=2, q_wave=1)),
    ("isolated_wall_motion", "57-year-old woman, one region with wall-motion abnormality, normal EF.",
     patient(age=57, sex_male=0, region_rwma=1, ef_tte=55)),
    ("severe_valve_disease", "72-year-old woman with severe valvular disease and a systolic murmur.",
     patient(age=72, sex_male=0, vhd=3, systolic_murmur=1, dyspnea=1)),
    ("high_ldl_triglycerides", "49-year-old man with dyslipidemia: LDL 190, TG 420.",
     patient(age=49, sex_male=1, dyslipidemia=1, ldl=190, tg=420, hdl=34)),
    ("metabolic_syndrome", "54-year-old woman: obesity, low HDL, high sugar and triglycerides.",
     patient(age=54, sex_male=0, bmi=36.5, hdl=31, tg=260, fbs=128, bp=140, hypertension=1)),
    ("chronic_kidney_disease", "67-year-old man with chronic renal failure, creatinine 2.1.",
     patient(age=67, sex_male=1, chronic_renal_failure=1, creatinine=2.1, bun=42, hypertension=1)),
    ("heart_failure_dyspnea", "74-year-old woman with heart failure, edema and dyspnea.",
     patient(age=74, sex_male=0, chf=1, edema=1, dyspnea=1, lung_rales=1, ef_tte=35, function_class=3)),
    ("prior_stroke", "71-year-old man with previous stroke and hypertension.",
     patient(age=71, sex_male=1, cva=1, hypertension=1, bp=150)),
    ("young_family_history", "41-year-old man with a strong family history of CAD.",
     patient(age=41, sex_male=1, family_history=1, ldl=150)),
    ("ex_smoker", "61-year-old man who quit smoking.",
     patient(age=61, sex_male=1, ex_smoker=1)),
    ("thyroid_disease", "48-year-old woman with thyroid disease.",
     patient(age=48, sex_male=0, thyroid_disease=1, pulse_rate=96)),
    ("anemia", "60-year-old woman with anemia, Hb 9.4.",
     patient(age=60, sex_male=0, hb=9.4, dyspnea=1)),
    ("high_inflammation", "56-year-old man with raised ESR and white cells.",
     patient(age=56, sex_male=1, esr=70, wbc=13500)),
    ("tachycardia", "45-year-old woman with a resting pulse of 108.",
     patient(age=45, sex_male=0, pulse_rate=108)),
    ("very_high_blood_pressure", "65-year-old man with systolic BP 190.",
     patient(age=65, sex_male=1, hypertension=1, bp=190)),
    ("typical_pain_normal_tests", "52-year-old woman: typical chest pain, all tests normal.",
     patient(age=52, sex_male=0, typical_chest_pain=1, ldl=95, hdl=58, fbs=90, bp=118)),
    ("everything_normal_45_man", "45-year-old man with every value in the normal range.",
     patient(age=45, sex_male=1, bmi=23.0, bp=115, ldl=90, hdl=52, tg=110, fbs=88, ef_tte=60)),
]

# ---------------------------------------------------------------- helpers

def write(name: str, header: list[str], rows: list[list], delimiter: str = ",") -> Path:
    path = OUT / name
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh, delimiter=delimiter)
        w.writerow(header)
        w.writerows(rows)
    return path


def canonical_rows(patients: list[tuple[str, dict]]) -> tuple[list[str], list[list]]:
    return ["patient_id", *NAMES], [[pid, *[p[n] for n in NAMES]] for pid, p in patients]


def jitter(p: dict, rng: random.Random) -> dict:
    """Small, plausible person-to-person variation inside the valid ranges."""
    q = dict(p)
    for n, f in SPEC.items():
        if f["type"] == "numeric" and n in STATS:
            lo, hi = f["valid_range"]
            sd = STATS[n]["std"] * 0.25
            v = q[n] + rng.gauss(0, sd)
            step = f.get("step", 1)
            q[n] = round(min(max(round(v / step) * step, max(lo, STATS[n]["p01"])), min(hi, STATS[n]["p99"])), 2)
    return q


def random_patient(rng: random.Random, risk: str) -> dict:
    high = risk == "high"
    p = patient(
        age=rng.randint(58, 82) if high else rng.randint(30, 50),
        sex_male=rng.randint(0, 1),
        diabetes=int(rng.random() < (0.55 if high else 0.05)),
        hypertension=int(rng.random() < (0.7 if high else 0.1)),
        current_smoker=int(rng.random() < (0.35 if high else 0.1)),
        typical_chest_pain=int(rng.random() < (0.75 if high else 0.05)),
        t_inversion=int(rng.random() < (0.4 if high else 0.02)),
        region_rwma=rng.choice([0, 1, 2, 3]) if high else 0,
        ef_tte=rng.choice([35, 40, 45, 50]) if high else rng.choice([55, 60]),
        bp=rng.randint(135, 175) if high else rng.randint(105, 125),
        fbs=rng.randint(110, 220) if high else rng.randint(80, 98),
        ldl=rng.randint(120, 190) if high else rng.randint(70, 115),
    )
    return jitter(p, rng)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.csv"):
        old.unlink()
    rng = random.Random(SEED)
    catalog: list[dict] = []

    def add(name, title, kind, desc, expect="All rows load and are scored.", patients=None):
        catalog.append({"file": name, "title": title, "kind": kind, "desc": desc, "expect": expect,
                        "patients": patients or []})

    # 01-30: one patient each
    for i, (slug, desc, p) in enumerate(PROFILES, start=1):
        name = f"{i:02d}_{slug}.csv"
        pid = f"S{i:02d}"
        write(name, *canonical_rows([(pid, p)]))
        add(name, slug.replace("_", " ").capitalize(), "Clinical profile", desc, patients=[(pid, p)])

    base = PROFILES[3][2]  # typical angina smoker, reused for data-quality files

    # 31-40: data-quality cases
    key = ["age", "sex_male", "typical_chest_pain", "diabetes", "hypertension", "bp", "ldl", "hdl", "fbs", "ef_tte"]
    write("31_key_fields_only.csv", ["patient_id", *key], [["S31", *[base[k] for k in key]]])
    add("31_key_fields_only.csv", "Key fields only", "Data quality",
        "Only 10 of 51 measurements are given.", "Loads; the other 41 are imputed and flagged.")

    write("32_age_and_sex_only.csv", ["patient_id", "age", "sex_male"], [["S32", 64, 1]])
    add("32_age_and_sex_only.csv", "Age and sex only", "Data quality",
        "Almost everything missing.", "Loads; 49 values imputed. The estimate leans on typical values.")

    raw_header = ["patient_id"] + [SPEC[n]["source"] for n in NAMES]

    def raw_value(n, v):
        f = SPEC[n]
        enc = f.get("encoding")
        if enc and f["type"] in ("binary", "categorical", "ordinal"):
            inv = {str(val): k for k, val in enc.items()}
            return inv.get(str(v), v)
        return v
    write("33_original_dataset_format.csv", raw_header, [["S33", *[raw_value(n, base[n]) for n in NAMES]]])
    add("33_original_dataset_format.csv", "Original dataset format", "Data quality",
        "UCI column names and raw values (DM, Sex=Male/Fmale, Y/N, LBBB, mild...).", "Loads exactly like the canonical format.")

    h, rows = canonical_rows([("S34", base)])
    write("34_semicolon_separated.csv", h, rows, delimiter=";")
    add("34_semicolon_separated.csv", "Semicolon separated", "Data quality",
        "Saved by European-locale Excel with ';' as separator.", "Separator is detected; loads normally.")

    bad = dict(base, ldl=999, age=12, bp=400)
    write("35_out_of_range_values.csv", *canonical_rows([("S35-bad", bad), ("S35-ok", base)]))
    add("35_out_of_range_values.csv", "Out-of-range values", "Data quality",
        "Row 1 has LDL 999, age 12 and BP 400; row 2 is valid.",
        "Row 1 is flagged with three messages and not scored; row 2 is scored.")

    h, rows = canonical_rows([("S36-typo", base), ("S36-ok", base)])
    rows[0][h.index("ldl")] = "one-forty"
    rows[0][h.index("diabetes")] = "maybe"
    write("36_typos_and_text.csv", h, rows)
    add("36_typos_and_text.csv", "Typos in values", "Data quality",
        "Row 1 has LDL 'one-forty' and diabetes 'maybe'.", "Row 1 is flagged (not a number / not yes-no); row 2 is scored.")

    h, rows = canonical_rows([("S37", base)])
    write("37_extra_columns.csv", [*h, "shoe_size", "notes"], [[*rows[0], 43, "follow-up in 3 months"]])
    add("37_extra_columns.csv", "Extra columns", "Data quality",
        "Includes columns the model does not use.", "Loads; the extra columns are listed as ignored.")

    h, rows = canonical_rows([('Smith, J. "JJ"', base)])
    write("38_quoted_patient_id.csv", h, rows)
    add("38_quoted_patient_id.csv", "Quoted patient ID", "Data quality",
        "Patient ID with a comma and quotes.", "Quoting is parsed correctly; the ID shows as written.")

    h, rows = canonical_rows([("S39", base)])
    for i, n in enumerate(h):
        if n in SPEC and SPEC[n]["type"] == "binary":
            rows[0][i] = "Yes" if rows[0][i] == 1 else "No"
    rows[0][h.index("sex_male")] = "Female"
    write("39_yes_no_text.csv", h, rows)
    add("39_yes_no_text.csv", "Yes/No as words", "Data quality",
        "Every yes/no field written as Yes or No, and sex written as Female.", "Words are understood; loads normally.")

    h, rows = canonical_rows([("S40", base)])
    for col, marker in [("hdl", "NA"), ("esr", "null"), ("wbc", "-"), ("plt", "N/A")]:
        rows[0][h.index(col)] = marker
    write("40_missing_markers.csv", h, rows)
    add("40_missing_markers.csv", "Missing-value markers", "Data quality",
        "Uses NA, null, - and N/A for missing values.", "Treated as missing (imputed and flagged), not as errors.")

    # 41-50: batches
    low = [(f"L{i:02d}", random_patient(rng, "low")) for i in range(1, 11)]
    write("41_cohort_low_risk_10.csv", *canonical_rows(low))
    add("41_cohort_low_risk_10.csv", "Low-risk cohort", "Batch", "10 younger patients with few risk factors.", patients=low)

    high = [(f"H{i:02d}", random_patient(rng, "high")) for i in range(1, 11)]
    write("42_cohort_high_risk_10.csv", *canonical_rows(high))
    add("42_cohort_high_risk_10.csv", "High-risk cohort", "Batch", "10 older patients with several risk factors.", patients=high)

    mixed = [(f"M{i:02d}", random_patient(rng, rng.choice(["low", "high"]))) for i in range(1, 21)]
    write("43_cohort_mixed_20.csv", *canonical_rows(mixed))
    add("43_cohort_mixed_20.csv", "Mixed cohort", "Batch", "20 patients, about half low and half high risk.", patients=mixed)

    def sweep(name, title, feature, values, desc, ref):
        pts = [(f"{feature}={v}", dict(ref, **{feature: v})) for v in values]
        write(name, *canonical_rows(pts))
        add(name, title, "Batch", desc, "Same patient, one value changed per row. Shows model sensitivity, not treatment effect.", patients=pts)

    sweep("44_sweep_age.csv", "Age sweep", "age", [30, 40, 50, 60, 70, 80], "The same patient at ages 30 to 80.", base)
    sweep("45_sweep_ldl.csv", "LDL sweep", "ldl", [70, 100, 130, 160, 190, 220], "LDL from 70 to 220 mg/dL.", base)
    sweep("46_sweep_blood_pressure.csv", "Blood pressure sweep", "bp", [100, 120, 140, 160, 180], "Systolic BP from 100 to 180 mmHg.", base)
    sweep("47_sweep_ejection_fraction.csv", "Ejection fraction sweep", "ef_tte", [60, 50, 40, 30, 20], "EF from 60% down to 20%.", base)

    sym = [("no_pain", patient(age=57, sex_male=1)),
           ("typical", patient(age=57, sex_male=1, typical_chest_pain=1)),
           ("atypical", patient(age=57, sex_male=1, atypical_chest_pain=1)),
           ("nonanginal", patient(age=57, sex_male=1, nonanginal_chest_pain=1)),
           ("low_threshold", patient(age=57, sex_male=1, typical_chest_pain=1, low_threshold_angina=1))]
    write("48_chest_pain_variants.csv", *canonical_rows(sym))
    add("48_chest_pain_variants.csv", "Chest pain variants", "Batch", "The same 57-year-old man with each kind of chest pain.", patients=sym)

    pairs = []
    for i in range(1, 6):
        p = random_patient(rng, rng.choice(["low", "high"]))
        pairs += [(f"P{i}-nonsmoker", dict(p, current_smoker=0)), (f"P{i}-smoker", dict(p, current_smoker=1))]
    write("49_smoker_pairs.csv", *canonical_rows(pairs))
    add("49_smoker_pairs.csv", "Smoker pairs", "Batch", "5 patients, each as a non-smoker and a smoker.", patients=pairs)

    big = [(f"B{i:03d}", random_patient(rng, rng.choice(["low", "low", "high"]))) for i in range(1, 101)]
    write("50_batch_100_patients.csv", *canonical_rows(big))
    add("50_batch_100_patients.csv", "100-patient batch", "Batch", "A larger upload: 100 mixed patients.", patients=big)

    assert len(catalog) == 50, len(catalog)
    write_readme(catalog)
    print(f"wrote {len(catalog)} files to {OUT.relative_to(config.ROOT)}/")


def write_readme(catalog: list[dict]) -> None:
    """README with each file's purpose and the model's estimate (model output, not truth)."""
    est = {}
    try:
        from src.inference import Predictor
        pred = Predictor()
        for c in catalog:
            if len(c["patients"]) == 1:
                r = pred.predict(c["patients"][0][1])
                est[c["file"]] = r
    except Exception as e:  # models missing: README without estimates
        print(f"note: estimates skipped ({e})")

    lines = [
        "# Sample patient files",
        "",
        "50 **synthetic** CSV files for trying and testing the upload in CoronaryTwin (*Upload CSV* in the patient record).",
        "These patients are invented, not real people and not rows from the dataset. Regenerate them with",
        "`python scripts/make_sample_csvs.py`; the seed is fixed, so the output is reproducible.",
        "",
        "Estimates below are the **models' output for these invented values**, recorded when the files were generated.",
        "They are not ground truth and not a diagnosis.",
        "",
        "| File | Scenario | Expected behaviour | Overall CAD | LAD | LCX | RCA |",
        "|---|---|---|---|---|---|---|",
    ]
    kinds = []
    for c in catalog:
        if c["kind"] not in kinds:
            kinds.append(c["kind"])
            lines.append(f"| **{c['kind']}** | | | | | | |")
        r = est.get(c["file"])
        cells = [f"{r[t]['prob']:.0%} {r[t]['state'].lower()}" for t in ("CAD", "LAD", "LCX", "RCA")] if r else ["–"] * 4
        lines.append(f"| `{c['file']}` | {c['desc']} | {c['expect']} | " + " | ".join(cells) + " |")
    lines += ["", "Batch files (41–50) open in the results table, where each patient's estimates appear and can be downloaded."]
    (OUT / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (OUT / "manifest.json").write_text(json.dumps(
        [{k: c[k] for k in ("file", "kind", "expect")} for c in catalog], indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
