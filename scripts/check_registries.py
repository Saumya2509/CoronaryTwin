"""Cross-check the registries that drive CoronaryTwin (module 07).

    python scripts/check_registries.py          # exit code 1 if anything disagrees

Three registries drive the system:
  features.yaml            inputs: form, validation, SHAP groups, what-if, patient text
  artifacts/registry.json  models: paths, thresholds, conformal quantiles, version
  web/src/anatomy.json     3D: vessel ids, mesh curves, labels
plus config/settings.yaml (vessel ids, groups, banned inputs).

Each check below names the registry to fix. Run it after adding a feature, model or vessel.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src import config, data  # noqa: E402

problems: list[str] = []
notes: list[str] = []


def check(ok: bool, msg: str) -> None:
    if not ok:
        problems.append(msg)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    problems.clear()
    notes.clear()
    vessels = config.vessel_ids()
    overall = config.overall_target()
    targets = config.all_targets()

    # settings <-> anatomy
    anatomy = load(config.ANATOMY_JSON)
    anat_ids = [v["id"] for v in anatomy["vessels"]]
    check(anat_ids == vessels, f"anatomy.json vessel ids {anat_ids} != settings targets.vessels {vessels}")
    for v in anatomy["vessels"]:
        check(len(v.get("points", [])) >= 2, f"anatomy.json {v['id']}: needs at least 2 curve points")
        check(v.get("radius", 0) > 0, f"anatomy.json {v['id']}: radius must be > 0")
        check(bool(v.get("patient_label")), f"anatomy.json {v['id']}: missing patient_label (used in patient wording)")

    # settings <-> features.yaml
    groups = config.feature_groups()
    used_groups = {f["group"] for f in data.features()}
    check(used_groups <= set(groups), f"features.yaml uses groups not in settings: {sorted(used_groups - set(groups))}")
    check(set(groups) <= used_groups, f"settings feature_groups has unused groups: {sorted(set(groups) - used_groups)}")
    target_names = [t["name"] for t in data.registry()["targets"]]
    check(target_names == targets, f"features.yaml targets {target_names} != settings targets {targets}")
    banned = set(config.settings()["banned_inputs"]) | set(targets)
    leaked = [f["name"] for f in data.features() if f["source"] in banned or f["name"] in banned]
    check(not leaked, f"features.yaml uses banned columns as inputs: {leaked}")

    # features.yaml <-> feature manifest (training-time order)
    if config.MANIFEST_JSON.exists():
        man = load(config.MANIFEST_JSON)
        check(man["feature_order"] == data.feature_names(),
              "artifacts/feature_manifest.json order differs from features.yaml: run `python tasks.py data` and retrain")
    else:
        notes.append("feature_manifest.json missing (run `python tasks.py data`)")

    # model registry <-> settings, files, metrics
    if config.REGISTRY_JSON.exists():
        reg = load(config.REGISTRY_JSON)
        check(set(reg["targets"]) == set(targets), f"registry.json targets {sorted(reg['targets'])} != settings {targets}")
        for t, e in reg["targets"].items():
            path = config.ARTIFACTS_DIR / e["path"]
            check(path.exists(), f"registry.json {t}: model file {e['path']} is missing")
            check(0 < e["threshold"] < 1, f"registry.json {t}: threshold {e['threshold']} out of (0, 1)")
            check(0 < e["qhat"] <= 1, f"registry.json {t}: qhat {e['qhat']} out of (0, 1]")
        if config.METRICS_JSON.exists():
            m = load(config.METRICS_JSON)
            check(m["version"] == reg["version"], f"metrics.json version {m['version']} != registry {reg['version']}")
            check(set(m["targets"]) == set(reg["targets"]), "metrics.json targets differ from registry.json")
    else:
        notes.append("registry.json missing: the API will run in mock mode (run `python tasks.py train`)")

    # mock fixtures <-> settings (the frontend falls back to these)
    for p in sorted((config.FIXTURES_DIR / "responses").glob("*.json")):
        r = load(p)
        check(list(r["vessels"]) == vessels, f"{p.name}: vessel keys {list(r['vessels'])} != {vessels}")
        check(set(r["explanations"]) == set(targets), f"{p.name}: explanation keys differ from targets")
        names = set(data.feature_names())
        for exp in r["explanations"].values():
            unknown = {f["name"] for f in exp["features"]} - names
            check(not unknown, f"{p.name}: unknown features {sorted(unknown)} (run `python tasks.py mock`)")

    print(f"vessels  {vessels}   overall {overall}")
    print(f"features {len(data.feature_names())} in {len(groups)} groups")
    for n in notes:
        print(f"note: {n}")
    if problems:
        print(f"\n{len(problems)} problem(s):")
        for p in problems:
            print(f"  - {p}")
        return 1
    print("OK: all registries agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())
