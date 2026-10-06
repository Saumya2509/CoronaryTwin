# Sample patient files

50 **synthetic** CSV files for trying and testing the upload in CoronaryTwin (*Upload CSV* in the patient record).
These patients are invented, not real people and not rows from the dataset. Regenerate them with
`python scripts/make_sample_csvs.py`; the seed is fixed, so the output is reproducible.

Estimates below are the **models' output for these invented values**, recorded when the files were generated.
They are not ground truth and not a diagnosis.

| File | Scenario | Expected behaviour | Overall CAD | LAD | LCX | RCA |
|---|---|---|---|---|---|---|
| **Clinical profile** | | | | | | |
| `01_healthy_young_woman.csv` | 34-year-old woman, no symptoms, normal tests. | All rows load and are scored. | 11% unlikely | 13% unlikely | 10% unlikely | 16% unlikely |
| `02_healthy_young_man.csv` | 31-year-old man, active, no risk factors. | All rows load and are scored. | 13% unlikely | 13% unlikely | 13% unlikely | 18% unlikely |
| `03_middle_aged_asymptomatic.csv` | 52-year-old man, no chest pain, mildly raised cholesterol. | All rows load and are scored. | 36% unlikely | 17% unlikely | 20% unlikely | 32% uncertain |
| `04_typical_angina_smoker.csv` | 58-year-old male smoker with typical exertional chest pain. | All rows load and are scored. | 78% likely | 71% likely | 50% uncertain | 44% uncertain |
| `05_diabetic_hypertensive_woman.csv` | 66-year-old woman with diabetes and hypertension. | All rows load and are scored. | 88% likely | 47% uncertain | 42% uncertain | 57% uncertain |
| `06_elderly_typical_angina.csv` | 78-year-old man with typical angina and low-threshold symptoms. | All rows load and are scored. | 97% likely | 81% likely | 60% uncertain | 65% uncertain |
| `07_atypical_pain_young_woman.csv` | 39-year-old woman with atypical chest pain, normal ECG. | All rows load and are scored. | 11% unlikely | 7% unlikely | 12% unlikely | 12% unlikely |
| `08_nonanginal_pain.csv` | 46-year-old man with non-anginal chest pain. | All rows load and are scored. | 17% unlikely | 11% unlikely | 15% unlikely | 25% unlikely |
| `09_st_elevation_q_wave.csv` | 63-year-old man, ST elevation and Q waves on ECG. | All rows load and are scored. | 92% likely | 81% likely | 48% uncertain | 42% uncertain |
| `10_st_depression_only.csv` | 59-year-old woman with ST depression, otherwise unremarkable. | All rows load and are scored. | 42% uncertain | 23% unlikely | 26% unlikely | 28% unlikely |
| `11_t_wave_inversion.csv` | 55-year-old man with T-wave inversion. | All rows load and are scored. | 53% uncertain | 24% unlikely | 19% unlikely | 31% unlikely |
| `12_left_bundle_branch_block.csv` | 70-year-old man with left bundle branch block. | All rows load and are scored. | 59% uncertain | 34% uncertain | 38% uncertain | 42% uncertain |
| `13_right_bundle_branch_block.csv` | 62-year-old woman with right bundle branch block. | All rows load and are scored. | 29% unlikely | 23% unlikely | 26% unlikely | 30% unlikely |
| `14_reduced_ef_wall_motion.csv` | 68-year-old man, EF 30%, three regions with wall-motion abnormality. | All rows load and are scored. | 96% likely | 88% likely | 44% uncertain | 36% uncertain |
| `15_isolated_wall_motion.csv` | 57-year-old woman, one region with wall-motion abnormality, normal EF. | All rows load and are scored. | 46% uncertain | 49% uncertain | 25% unlikely | 26% unlikely |
| `16_severe_valve_disease.csv` | 72-year-old woman with severe valvular disease and a systolic murmur. | All rows load and are scored. | 15% unlikely | 24% unlikely | 30% unlikely | 26% unlikely |
| `17_high_ldl_triglycerides.csv` | 49-year-old man with dyslipidemia: LDL 190, TG 420. | All rows load and are scored. | 53% uncertain | 22% unlikely | 17% unlikely | 46% uncertain |
| `18_metabolic_syndrome.csv` | 54-year-old woman: obesity, low HDL, high sugar and triglycerides. | All rows load and are scored. | 60% uncertain | 29% unlikely | 19% unlikely | 32% uncertain |
| `19_chronic_kidney_disease.csv` | 67-year-old man with chronic renal failure, creatinine 2.1. | All rows load and are scored. | 73% likely | 55% uncertain | 62% uncertain | 39% uncertain |
| `20_heart_failure_dyspnea.csv` | 74-year-old woman with heart failure, edema and dyspnea. | All rows load and are scored. | 80% likely | 57% uncertain | 42% uncertain | 42% uncertain |
| `21_prior_stroke.csv` | 71-year-old man with previous stroke and hypertension. | All rows load and are scored. | 81% likely | 37% uncertain | 43% uncertain | 44% uncertain |
| `22_young_family_history.csv` | 41-year-old man with a strong family history of CAD. | All rows load and are scored. | 33% unlikely | 15% unlikely | 16% unlikely | 23% unlikely |
| `23_ex_smoker.csv` | 61-year-old man who quit smoking. | All rows load and are scored. | 44% uncertain | 24% unlikely | 30% unlikely | 35% uncertain |
| `24_thyroid_disease.csv` | 48-year-old woman with thyroid disease. | All rows load and are scored. | 35% unlikely | 14% unlikely | 14% unlikely | 21% unlikely |
| `25_anemia.csv` | 60-year-old woman with anemia, Hb 9.4. | All rows load and are scored. | 30% unlikely | 23% unlikely | 24% unlikely | 16% unlikely |
| `26_high_inflammation.csv` | 56-year-old man with raised ESR and white cells. | All rows load and are scored. | 60% uncertain | 27% unlikely | 23% unlikely | 52% uncertain |
| `27_tachycardia.csv` | 45-year-old woman with a resting pulse of 108. | All rows load and are scored. | 39% unlikely | 14% unlikely | 14% unlikely | 20% unlikely |
| `28_very_high_blood_pressure.csv` | 65-year-old man with systolic BP 190. | All rows load and are scored. | 82% likely | 35% uncertain | 39% uncertain | 41% uncertain |
| `29_typical_pain_normal_tests.csv` | 52-year-old woman: typical chest pain, all tests normal. | All rows load and are scored. | 60% uncertain | 54% uncertain | 21% unlikely | 31% unlikely |
| `30_everything_normal_45_man.csv` | 45-year-old man with every value in the normal range. | All rows load and are scored. | 22% unlikely | 13% unlikely | 14% unlikely | 26% unlikely |
| **Data quality** | | | | | | |
| `31_key_fields_only.csv` | Only 10 of 51 measurements are given. | Loads; the other 41 are imputed and flagged. | – | – | – | – |
| `32_age_and_sex_only.csv` | Almost everything missing. | Loads; 49 values imputed. The estimate leans on typical values. | – | – | – | – |
| `33_original_dataset_format.csv` | UCI column names and raw values (DM, Sex=Male/Fmale, Y/N, LBBB, mild...). | Loads exactly like the canonical format. | – | – | – | – |
| `34_semicolon_separated.csv` | Saved by European-locale Excel with ';' as separator. | Separator is detected; loads normally. | – | – | – | – |
| `35_out_of_range_values.csv` | Row 1 has LDL 999, age 12 and BP 400; row 2 is valid. | Row 1 is flagged with three messages and not scored; row 2 is scored. | – | – | – | – |
| `36_typos_and_text.csv` | Row 1 has LDL 'one-forty' and diabetes 'maybe'. | Row 1 is flagged (not a number / not yes-no); row 2 is scored. | – | – | – | – |
| `37_extra_columns.csv` | Includes columns the model does not use. | Loads; the extra columns are listed as ignored. | – | – | – | – |
| `38_quoted_patient_id.csv` | Patient ID with a comma and quotes. | Quoting is parsed correctly; the ID shows as written. | – | – | – | – |
| `39_yes_no_text.csv` | Every yes/no field written as Yes or No, and sex written as Female. | Words are understood; loads normally. | – | – | – | – |
| `40_missing_markers.csv` | Uses NA, null, - and N/A for missing values. | Treated as missing (imputed and flagged), not as errors. | – | – | – | – |
| **Batch** | | | | | | |
| `41_cohort_low_risk_10.csv` | 10 younger patients with few risk factors. | All rows load and are scored. | – | – | – | – |
| `42_cohort_high_risk_10.csv` | 10 older patients with several risk factors. | All rows load and are scored. | – | – | – | – |
| `43_cohort_mixed_20.csv` | 20 patients, about half low and half high risk. | All rows load and are scored. | – | – | – | – |
| `44_sweep_age.csv` | The same patient at ages 30 to 80. | Same patient, one value changed per row. Shows model sensitivity, not treatment effect. | – | – | – | – |
| `45_sweep_ldl.csv` | LDL from 70 to 220 mg/dL. | Same patient, one value changed per row. Shows model sensitivity, not treatment effect. | – | – | – | – |
| `46_sweep_blood_pressure.csv` | Systolic BP from 100 to 180 mmHg. | Same patient, one value changed per row. Shows model sensitivity, not treatment effect. | – | – | – | – |
| `47_sweep_ejection_fraction.csv` | EF from 60% down to 20%. | Same patient, one value changed per row. Shows model sensitivity, not treatment effect. | – | – | – | – |
| `48_chest_pain_variants.csv` | The same 57-year-old man with each kind of chest pain. | All rows load and are scored. | – | – | – | – |
| `49_smoker_pairs.csv` | 5 patients, each as a non-smoker and a smoker. | All rows load and are scored. | – | – | – | – |
| `50_batch_100_patients.csv` | A larger upload: 100 mixed patients. | All rows load and are scored. | – | – | – | – |

Batch files (41–50) open in the results table, where each patient's estimates appear and can be downloaded.
