"""CoronaryTwin API (module 04).

    uvicorn app.main:app --reload        # docs at http://127.0.0.1:8000/docs

Serves calibrated probabilities, conformal sets, uncertainty, coherence and per-vessel
SHAP explanations. When trained artifacts are missing (or CORONARYTWIN_MOCK=1), the
prediction endpoints serve the fixtures in fixtures/responses/ instead, with the same
response contract, so the frontend works either way.

Privacy: patient inputs are never stored or logged. The SQLite database (app/db.py) keeps reference
data and an anonymous log of prediction OUTPUTS only: no input values, no patient IDs.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from src import config, data, experiments, explain, extract

from . import db
from . import predict as flow
from . import registry
from .schemas import (BatchResponse, CounterfactualRequest, CounterfactualResponse, ExtractResponse,
                      NextBestTestRequest, NextBestTestResponse, PredictRequest, PredictResponse,
                      SimilarRequest, SimilarResponse, WhatIfRequest, WhatIfResponse)

log = logging.getLogger("coronarytwin")
RESPONSES_DIR = config.FIXTURES_DIR / "responses"
DEFAULT_DEMO = "mixed"


@asynccontextmanager
async def lifespan(_: FastAPI):
    if registry.mode() == "models":
        st = registry.state()                       # load models + SHAP explainers once
        if st.demos:                                # warm the code paths before the first user
            rec, pid = flow.resolve(st, next(iter(st.demos)), None)
            flow.predict(st, rec, pid)
        metrics = json.loads(config.METRICS_JSON.read_text(encoding="utf-8")) if config.METRICS_JSON.exists() else None
        path = db.init(st.registry, metrics)
    else:
        path = db.init()
    log.info("database: %s", path or "disabled")
    # Load the OCR models in the background so the first report reads fast. Small hosts (e.g. Render's free 512 MB)
    # set CORONARYTWIN_OCR_WARMUP=0 to load them only when a report is actually read.
    if os.environ.get("CORONARYTWIN_OCR_WARMUP", "1") != "0":
        threading.Thread(target=extract.ocr_engine, daemon=True).start()
    yield


app = FastAPI(
    title="CoronaryTwin API",
    description="Coronary risk estimates with uncertainty and explanations. " + config.disclaimer(),
    version="1.0.0",
    lifespan=lifespan,
)
# Allowed web origins: settings.yaml, plus CORONARYTWIN_CORS_ORIGINS (comma-separated, e.g. your Vercel URL) and
# optionally CORONARYTWIN_CORS_REGEX (e.g. https://coronarytwin.*\.vercel\.app for preview deployments).
_origins = list(config.settings()["api"]["cors_origins"]) + [
    o.strip().rstrip("/") for o in os.environ.get("CORONARYTWIN_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=os.environ.get("CORONARYTWIN_CORS_REGEX") or None,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def timing(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    ms = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time-ms"] = f"{ms:.0f}"
    log.info("%s %s %d %.0fms", request.method, request.url.path, response.status_code, ms)
    return response


# ---------------------------------------------------------------- mock mode

@lru_cache(maxsize=None)
def _fixture(demo: str) -> PredictResponse:
    path = RESPONSES_DIR / f"demo-{demo}.json"
    if not path.exists():
        options = sorted(p.stem.removeprefix("demo-") for p in RESPONSES_DIR.glob("demo-*.json"))
        raise HTTPException(404, f"Unknown demo '{demo}'. Options: {options}")
    return PredictResponse.model_validate_json(path.read_text(encoding="utf-8"))


def _models_or_503() -> registry.ServingState:
    if registry.mode() != "models":
        raise HTTPException(503, "Trained models are not available (mock mode). Run `python tasks.py train`.")
    return registry.state()


def _read_json(path, what: str) -> Any:
    if not path.exists():
        raise HTTPException(503, f"{what} not available yet ({path.name} missing).")
    return json.loads(path.read_text(encoding="utf-8"))


# ---------------------------------------------------------------- info endpoints

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "mode": registry.mode()}


@app.get("/model-info")
def model_info() -> dict:
    info = {
        "mode": registry.mode(),
        "targets": config.all_targets(),
        "vessels": config.vessel_ids(),
        "data_source": "Extension of Z-Alizadeh Sani dataset (UCI id 411, DOI 10.24432/C5461K)",
        "disclaimer": config.disclaimer(),
    }
    if registry.mode() == "models":
        reg = registry.state().registry
        info.update(version=reg["version"], trained=reg["created"], alpha=reg["alpha"],
                    models={t: {k: e[k] for k in ("family", "threshold", "qhat")}
                            for t, e in reg["targets"].items()})
    else:
        info["version"] = "mock-0"
    return info


@app.get("/features")
def features() -> dict:
    """Feature registry for the auto-built form, plus data ranges for sliders."""
    stats = explain.load_stats() if explain.STATS_JSON.exists() else {}
    return {
        "groups": config.feature_groups(),
        "modifiable": explain.modifiable_features(),
        "features": [{**f, "stats": stats.get(f["name"])} for f in data.features()],
    }


@app.get("/log/summary")
def log_summary() -> dict:
    """Aggregate counts from the privacy-safe prediction log (nothing per patient)."""
    return db.summary()


@app.get("/metrics")
def metrics() -> Any:
    return _read_json(config.METRICS_JSON, "Model metrics")


@app.get("/explanations/global")
def global_explanations() -> Any:
    """Mean |SHAP| per feature and group for each model (also used by browser-only mode)."""
    return _read_json(explain.GLOBAL_JSON, "Global SHAP importance")


@app.get("/experiments")
def experiment_results() -> Any:
    """Paired model comparison, decision curves, ablation, learning curves, robustness, OOD and
    next-best-test checks (src/experiments.py)."""
    res = _read_json(experiments.EXPERIMENTS_JSON, "Experiment results")
    lime_path = config.ARTIFACTS_DIR / "lime_check.json"
    if lime_path.exists():
        res["lime"] = json.loads(lime_path.read_text(encoding="utf-8"))
    return res


@app.get("/demo-patients")
def demo_patients() -> dict:
    if registry.mode() == "models":
        return {k: {kk: v[kk] for kk in ("patient_id", "description", "features")}
                for k, v in registry.state().demos.items()}
    return {p.stem.removeprefix("demo-"): {"patient_id": p.stem, "description": "mock fixture",
                                           "features": None}
            for p in sorted(RESPONSES_DIR.glob("demo-*.json"))}


# ---------------------------------------------------------------- prediction endpoints

@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest) -> Any:
    if registry.mode() == "mock":
        return _fixture(req.demo or DEFAULT_DEMO)
    st = registry.state()
    record, pid = flow.resolve(st, req.demo, req.features)
    with db.Timer() as t:
        out = flow.predict(st, record, req.patient_id or pid)
    db.log_predictions("predict", out["model_version"], [out], t.ms)   # outputs only
    return out


@app.post("/whatif", response_model=WhatIfResponse)
def whatif(req: WhatIfRequest) -> Any:
    if registry.mode() == "mock":
        base = _fixture(req.demo or DEFAULT_DEMO)
        deltas = {t: 0.0 for t in config.all_targets()}  # no model to re-run in mock mode
        return WhatIfResponse(base=base, whatif=base, deltas=deltas)
    st = registry.state()
    record, pid = flow.resolve(st, req.demo, req.features)
    return flow.whatif(st, record, req.overrides, req.patient_id or pid)


@app.post("/counterfactual", response_model=CounterfactualResponse, response_model_by_alias=True)
def counterfactual(req: CounterfactualRequest) -> Any:
    st = _models_or_503()
    record, _ = flow.resolve(st, req.demo, req.features)
    return flow.counterfactual(st, record, req.target)


@app.post("/next-best-test", response_model=NextBestTestResponse)
def next_best_test(req: NextBestTestRequest) -> Any:
    """Which missing measurement (or whole test) would most change the estimate. Ranks by model
    uncertainty, not clinical necessity."""
    st = _models_or_503()
    record, _ = flow.resolve(st, req.demo, req.features)
    return flow.next_best_test(st, record, req.target)


@app.post("/similar", response_model=SimilarResponse)
def similar(req: SimilarRequest) -> Any:
    """The k most similar training patients as coarse, de-identified summaries with outcomes."""
    st = _models_or_503()
    record, _ = flow.resolve(st, req.demo, req.features)
    return flow.similar(st, record, req.k)


@app.post("/predict/batch", response_model=BatchResponse)
async def predict_batch(file: UploadFile = File(..., description="CSV, one patient per row")) -> Any:
    st = _models_or_503()
    content = await file.read()
    with db.Timer() as t:
        out = flow.batch(st, content)
    db.log_predictions("batch", out["model_version"], out["rows"], t.ms)   # outputs only
    return out


# ---------------------------------------------------------------- report upload (feature 2)

@app.get("/extract/capabilities")
def extract_capabilities() -> dict:
    return extract.capabilities()


@app.post("/extract", response_model=ExtractResponse)
async def extract_reports(files: list[UploadFile] = File(..., description="Lab, ECG, echo or referral reports: PDF, image or text"),
                          use_claude: bool = Form(False, description="Read with Claude vision (sends the files to Anthropic)")) -> Any:
    """Read reports into proposed patient values. Files are processed in memory, never stored or logged."""
    if use_claude and not extract.claude_available():
        raise HTTPException(400, "Claude reading is not enabled on this server (set CORONARYTWIN_CLAUDE_EXTRACT=1 "
                                 "and Anthropic credentials). Local reading needs no setup.")
    payload = [(f.filename or "report", await f.read()) for f in files]
    try:
        out = await run_in_threadpool(extract.extract, payload, use_claude)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from None
    return {**out, "disclaimer": config.disclaimer()}


# ---------------------------------------------------------------- demo set (md/final.md part 2)

DEMO_MANIFEST = config.ROOT / "csv" / "demo.json"


@app.get("/demo-set")
def demo_set() -> dict:
    """The sample patients behind the CSV button: csv/demo.json plus each file's CSV text. A missing or
    unreadable file is reported in `errors` and skipped, so the demo still loads the others."""
    if not DEMO_MANIFEST.exists():
        raise HTTPException(404, "Demo manifest csv/demo.json not found.")
    manifest = json.loads(DEMO_MANIFEST.read_text(encoding="utf-8"))
    out, errors = [], []
    for d in manifest.get("demo", []):
        name = str(d.get("file", ""))
        path = DEMO_MANIFEST.parent / name
        if not re.fullmatch(r"[\w.-]+\.csv", name) or not path.is_file():
            errors.append(f"{name or '(no file name)'}: not found in csv/")
            continue
        out.append({"file": name, "label": d.get("label", name), "description": d.get("description", ""),
                    "csv": path.read_text(encoding="utf-8-sig")})
    return {"demo": out, "errors": errors, "disclaimer": config.disclaimer()}
