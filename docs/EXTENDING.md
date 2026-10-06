# Extending CoronaryTwin

Three registries drive the system. Adding a clinical feature, a model or an anatomical structure means editing
these registries, not rewriting code.

| Registry | Drives |
|---|---|
| `features.yaml` | Model inputs, preprocessing, API validation, the input form, SHAP groups, what-if sliders, patient wording |
| `artifacts/registry.json` (written by training) | Which models are served, with their thresholds, conformal quantiles and version |
| `web/src/anatomy.json` | 3D vessels: IDs, labels, curve paths and radii |
| `config/settings.yaml` | Vessel IDs, SHAP groups, banned inputs, CV settings, coherence thresholds, disclaimer text |

After any change, run `python tasks.py check`. It cross-checks every registry and names the file to fix.

---

## Add a clinical feature

Example: a troponin lab value.

1. Add the column to the dataset (or to your CSV), then add one entry to `features.yaml`:
   ```yaml
   - {name: troponin, source: Troponin, label: Troponin I, unit: ng/L, type: numeric, group: Labs,
      valid_range: [0, 50000], normal_range: [0, 14], modifiable: false, step: 1,
      patient_text: "Your troponin (heart muscle) test"}
   ```
2. Run `python tasks.py data`, then `python tasks.py train`.

What updates with no further code changes:
- **API:** `PatientInput` gets a range-validated `troponin` field, and out-of-range values return 422.
- **Preprocessing:** the feature joins the numeric branch (median imputation and scaling).
- **Form:** the field appears under *Labs* with its unit and normal range.
- **Explanations:** SHAP rows and the Labs group total include it, with patient wording from `patient_text`.
- **What-if:** set `modifiable: true` to give it a slider.

Guarded by `tests/test_extensibility.py::test_new_feature_*` and `tests/test_data.py::test_every_raw_column_is_accounted_for`.
The second test fails if a raw column is neither used nor listed under `excluded` with a reason.

## Add a model type

1. Add the estimator and its search space to `src/models.py` (`_estimator`, `PARAM_SPACE`, `FAMILY_LABELS`).
2. List it in `config/settings.yaml` → `training.families`.
3. Run `python tasks.py train`. Nested CV compares it with the other families, and the one-SE rule decides whether it is used.
   If it isn't a tree or linear model, add an explainer branch in `src/explain.py::TargetExplainer`.
   `tests/test_explain.py::test_shap_is_additive` checks the new branch.

## Add an anatomical structure (for example, the left main)

1. **Label:** add the target to `features.yaml` → `targets` (and ban its raw column in `settings.yaml`).
2. **Model:** add the ID to `settings.yaml` → `targets.vessels`, then retrain. The registry picks it up automatically.
3. **Anatomy:** add an entry to `web/src/anatomy.json` with `id`, `label`, `patient_label`, `territory`, direction
   `points` and `radius`. Points are directions from the heart center and are projected onto the surface for you.
   (Remove the matching `decorations` entry if it was drawn as a neutral placeholder.)
4. **Mock data:** run `python tasks.py mock`.

The API, risk readout, explanations, what-if and trust tab all iterate over the registry, so the new vessel appears
everywhere. If any of the four places disagree, `python tasks.py check` and `tests/test_contract.py` fail. This is
covered by `test_checker_catches_a_vessel_added_in_only_one_place`.

## Change a threshold or a safety setting

- Coherence thresholds, conformal α and the disclaimer text live in `config/settings.yaml`.
- Per-target decision thresholds are chosen during training (`training.min_recall`) and written to `registry.json`.
- After changing settings, run `python -m src.report` (model card) and `python -m src.demo_patients`.
