"""API contract (module 04).

Input:  PatientInput is generated from features.yaml, so adding a feature to the
        registry adds a validated field (range-checked numerics, 0/1 binaries,
        enumerated categories) with no code change here.
Output: PredictResponse is the vessel-centric contract the 3D scene and dashboard
        rely on. Vessel keys are checked against config/settings.yaml.
"""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, create_model, field_validator

from src import config, data

Prob = Field(ge=0.0, le=1.0)
ConformalLabel = Literal["CAD", "No CAD"]
RiskState = Literal["Likely", "Unlikely", "Uncertain"]


# ---------------------------------------------------------------- input

def _field(f: dict) -> tuple[Any, Any]:
    desc = f["label"] + (f" ({f['unit']})" if f.get("unit") else "")
    if f["type"] in ("numeric", "ordinal"):
        lo, hi = f.get("valid_range", (None, None))
        return Optional[float], Field(None, ge=lo, le=hi, description=desc)
    if f["type"] == "binary":
        return Optional[Literal[0, 1]], Field(None, description=desc + " (0 = no, 1 = yes)")
    if f["type"] == "categorical":
        allowed = tuple(f["encoding"].values())
        return Optional[Literal[allowed]], Field(None, description=desc)
    raise ValueError(f"unsupported feature type {f['type']!r}")


class _PatientBase(BaseModel):
    # Unknown keys are rejected so a typo ("ldl_c") cannot silently become "missing".
    model_config = ConfigDict(extra="forbid")


def build_input_model() -> type[BaseModel]:
    """Every feature is optional: missing values are imputed by the model pipeline
    and reported back in `imputed`, so a partial form still gets an (honest) answer."""
    fields = {f["name"]: _field(f) for f in data.features()}
    return create_model("PatientInput", __base__=_PatientBase, **fields)


PatientInput = build_input_model()


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_id: Optional[str] = Field(None, max_length=64)
    demo: Optional[str] = Field(None, description="Load a demo patient instead of `features`.")
    features: Optional[PatientInput] = None  # type: ignore[valid-type]


class WhatIfRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    patient_id: Optional[str] = Field(None, max_length=64)
    demo: Optional[str] = None
    features: Optional[PatientInput] = None  # type: ignore[valid-type]
    overrides: dict[str, Union[float, int]] = Field(
        default_factory=dict, description="Modifiable features only (see GET /features).")


class NextBestTestRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    demo: Optional[str] = None
    features: Optional[PatientInput] = None  # type: ignore[valid-type]
    target: Optional[str] = Field(None, description="Rank for one target (CAD, LAD, LCX, RCA); default: all four")


class SimilarRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    demo: Optional[str] = None
    features: Optional[PatientInput] = None  # type: ignore[valid-type]
    k: int = Field(5, ge=1, le=10)


class CounterfactualRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    demo: Optional[str] = None
    features: Optional[PatientInput] = None  # type: ignore[valid-type]
    target: str = Field(description="CAD, LAD, LCX or RCA")


# ---------------------------------------------------------------- output

# Lowest and highest probability among the calibrated sub-models (cross-fitted fold copies)
# that the estimate averages. It shows model disagreement; it is not a confidence interval.
SubModelRange = Optional[list[float]]


class OverallResult(BaseModel):
    prob: float = Prob
    uncertainty: float = Prob
    set: list[ConformalLabel]
    state: RiskState
    label: str
    threshold: Optional[float] = None
    range: SubModelRange = None


class VesselResult(BaseModel):
    prob: float = Prob
    uncertainty: float = Prob
    set: list[ConformalLabel]
    state: RiskState
    threshold: Optional[float] = None
    range: SubModelRange = None


class Coherence(BaseModel):
    flag: bool
    note: str = ""


class FeatureContribution(BaseModel):
    name: str
    value: Union[float, str, None]
    shap: float
    group: str
    range_status: Literal["below", "within", "above"] | None = None


class Explanation(BaseModel):
    groups: dict[str, float]
    features: list[FeatureContribution]
    text: str                      # clinician wording
    text_patient: str = ""         # plain-language wording for the patient view
    base_value: float | None = None
    units: Literal["log-odds", "probability"] = "log-odds"

    @field_validator("groups")
    @classmethod
    def known_groups(cls, v: dict[str, float]) -> dict[str, float]:
        unknown = set(v) - set(config.feature_groups())
        if unknown:
            raise ValueError(f"unknown feature groups: {sorted(unknown)}")
        return v


class OODCheck(BaseModel):
    """Out-of-distribution check (speciality A3): does this input look like the training data?"""
    flag: bool
    out_of_range: list[str] = []
    unusual_combination: bool = False
    typicality: float = Prob       # share of training patients at least as unusual as this input
    reasons: list[str] = []


class GuidelineScore(BaseModel):
    id: str
    label: str
    short: str
    prob: float = Prob


class Guideline(BaseModel):
    """Guideline pre-test probability scores for the same patient (src/baselines.py)."""
    symptom: Literal["typical", "atypical", "nonanginal", "dyspnoea"]
    scores: list[GuidelineScore]
    esc2019_band: str
    note: str = ""


class PredictResponse(BaseModel):
    patient_id: str
    overall: OverallResult
    vessels: dict[str, VesselResult]
    coherence: Coherence
    explanations: dict[str, Explanation]
    imputed: list[str] = []        # features that were missing and filled by the pipeline
    ood: Optional[OODCheck] = None
    guideline: Optional[Guideline] = None   # None when age, sex or symptom type is unknown
    model_version: str
    disclaimer: str

    @field_validator("vessels")
    @classmethod
    def vessel_keys(cls, v: dict) -> dict:
        if list(v) != config.vessel_ids():
            raise ValueError(f"vessel keys {list(v)} != {config.vessel_ids()}")
        return v

    @field_validator("explanations")
    @classmethod
    def explanation_keys(cls, v: dict) -> dict:
        if set(v) != set(config.all_targets()):
            raise ValueError(f"explanation keys {sorted(v)} != {config.all_targets()}")
        return v

    @field_validator("disclaimer")
    @classmethod
    def disclaimer_present(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("disclaimer must not be empty")
        return v


class WhatIfResponse(BaseModel):
    base: PredictResponse
    whatif: PredictResponse
    deltas: dict[str, float]  # target -> whatif.prob - base.prob
    caption: str = "Shows model sensitivity, not medical advice."


class CounterfactualChange(BaseModel):
    feature: str
    from_: Union[float, int, None] = Field(alias="from")
    to: Union[float, int]

    model_config = ConfigDict(populate_by_name=True)


class CounterfactualOption(BaseModel):
    changes: list[CounterfactualChange]
    new_prob: float = Prob
    effort_sd: float


class CounterfactualResponse(BaseModel):
    target: str
    threshold: float
    current_prob: float = Prob
    already_below: bool
    options: list[CounterfactualOption]
    note: str = ""
    caption: str
    disclaimer: str


class TargetPerTest(BaseModel):
    spread: float
    range: list[float]
    p_definite: float = Prob


class NextBestItem(BaseModel):
    name: str
    label: str
    group: Optional[str] = None
    fills: list[str] = []
    score: float
    per_target: dict[str, TargetPerTest]


class NextBestTestResponse(BaseModel):
    target: Optional[str]
    n_missing: int
    current: dict[str, dict[str, Union[float, str]]] = {}
    tests: list[NextBestItem]
    features: list[NextBestItem]
    caption: str
    disclaimer: str


class SimilarCase(BaseModel):
    rank: int
    distance: float
    summary: str
    outcomes: dict[str, int]


class SimilarResponse(BaseModel):
    k: int
    matched_on: int
    cases: list[SimilarCase]
    outcome_rates: dict[str, float]
    caption: str
    disclaimer: str


class BatchRow(BaseModel):
    patient_id: str
    overall: OverallResult
    vessels: dict[str, VesselResult]
    coherence: Coherence
    imputed: list[str] = []
    ood: Optional[bool] = None


class CohortTarget(BaseModel):
    mean_prob: float = Prob
    likely: int
    uncertain: int
    unlikely: int


class CohortSummary(BaseModel):
    """Aggregate "population heart" for cohort mode (speciality A4)."""
    n: int
    targets: dict[str, CohortTarget]
    coherence_flags: int
    ood_flags: int


class BatchResponse(BaseModel):
    rows: list[BatchRow]
    errors: list[dict] = []
    summary: Optional[CohortSummary] = None
    model_version: str
    disclaimer: str


class ExtractFinding(BaseModel):
    """One value read from an uploaded report (feature 2, src/extract.py). Proposed, never auto-applied."""
    name: str
    value: Union[float, int, str]
    evidence: str
    source: str
    method: Literal["text", "ocr", "claude"]
    confidence: Literal["high", "medium", "low"]
    note: str = ""


class ExtractFile(BaseModel):
    name: str
    method: Optional[str] = None
    lines: Optional[int] = None
    found: Optional[int] = None


class ExtractResponse(BaseModel):
    findings: list[ExtractFinding]
    warnings: list[str] = []
    files: list[ExtractFile]
    claude_used: bool = False
    stored: Literal[False] = False      # uploaded files are processed in memory only
    disclaimer: str
