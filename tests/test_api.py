"""API tests (module 04): schema, ranges, response keys, what-if, batch, mock fallback."""
import io
import time

import pytest
from fastapi.testclient import TestClient

from app import registry
from app.main import app
from app.schemas import PatientInput, PredictResponse
from src import config, data, explain

DEMOS = ["low", "mixed", "high", "discordant"]


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def models(client):
    if registry.mode() != "models":
        pytest.skip("trained models not available")
    return registry.state()


@pytest.fixture(scope="module")
def high(client, models):
    return client.get("/demo-patients").json()["high"]["features"]


# ---------------------------------------------------------------- always available

def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok" and body["mode"] in {"models", "mock"}


def test_model_info(client):
    body = client.get("/model-info").json()
    assert body["targets"] == config.all_targets()
    assert body["vessels"] == config.vessel_ids()
    assert body["disclaimer"]


def test_features_endpoint_builds_form(client):
    body = client.get("/features").json()
    assert [f["name"] for f in body["features"]] == data.feature_names()
    assert body["groups"] == config.feature_groups()
    assert set(body["modifiable"]) <= set(data.feature_names())


def test_openapi_docs(client):
    assert client.get("/docs").status_code == 200
    paths = client.get("/openapi.json").json()["paths"]
    assert {"/predict", "/whatif", "/predict/batch", "/features", "/metrics", "/model-info",
            "/health", "/counterfactual"} <= set(paths)


# ---------------------------------------------------------------- input schema

def test_input_model_mirrors_registry():
    assert list(PatientInput.model_fields) == data.feature_names()


@pytest.mark.parametrize("bad", [{"ldl": 999}, {"age": 5}, {"sex_male": 2},
                                 {"bbb": "middle"}, {"ldl_c": 100}])
def test_invalid_input_rejected(client, bad):
    assert client.post("/predict", json={"features": bad}).status_code == 422


def test_cors_allows_frontend_only(client):
    ok = client.options("/predict", headers={"Origin": "http://localhost:5173",
                                             "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:5173"
    bad = client.options("/predict", headers={"Origin": "http://evil.example",
                                              "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


# ---------------------------------------------------------------- models mode

@pytest.mark.parametrize("demo", DEMOS)
def test_predict_demo_contract(client, models, demo):
    r = client.post("/predict", json={"demo": demo})
    assert r.status_code == 200
    body = PredictResponse.model_validate(r.json())
    assert list(body.vessels) == config.vessel_ids()
    assert body.model_version == models.version
    assert body.disclaimer == config.disclaimer()
    for v in [body.overall, *body.vessels.values()]:
        assert 0 <= v.prob <= 1 and 0 <= v.uncertainty <= 1 and v.threshold is not None
    for exp in body.explanations.values():
        assert sum(exp.groups.values()) == pytest.approx(sum(f.shap for f in exp.features), abs=1e-3)


def test_predict_matches_predictor(client, models, high):
    body = client.post("/predict", json={"features": high, "patient_id": "p1"}).json()
    direct = models.predictor.predict(high)
    assert body["patient_id"] == "p1"
    assert body["overall"]["prob"] == pytest.approx(direct["CAD"]["prob"], abs=1e-4)
    for v in config.vessel_ids():
        assert body["vessels"][v]["prob"] == pytest.approx(direct[v]["prob"], abs=1e-4)


def test_partial_input_is_imputed_and_reported(client, models):
    body = client.post("/predict", json={"features": {"age": 60, "typical_chest_pain": 1}}).json()
    assert "age" not in body["imputed"] and "ldl" in body["imputed"]
    assert len(body["imputed"]) == len(data.feature_names()) - 2


def test_fast_path_matches_sklearn(models):
    """The numpy preprocessing fast path must not change any prediction."""
    import joblib
    from src.inference import to_frame
    X = to_frame(list(models.demos[d]["features"] for d in DEMOS))
    for t, entry in models.predictor.entries.items():
        slow = joblib.load(config.ARTIFACTS_DIR / entry["path"])["calibrated"].predict_proba(X)
        fast = models.predictor.bundles[t]["calibrated"].predict_proba(X)
        assert abs(slow - fast).max() < 1e-10


def test_latency_budget(client, models, high):
    client.post("/predict", json={"features": high})             # warm
    start = time.perf_counter()
    for _ in range(3):
        client.post("/predict", json={"features": high})
    assert (time.perf_counter() - start) / 3 < 1.0                  # target ~0.3 s; generous for CI


def test_whatif_deltas(client, models):
    body = client.post("/whatif", json={"demo": "high", "overrides": {"bp": 110, "ldl": 80}}).json()
    assert set(body["deltas"]) == set(config.all_targets())
    assert body["deltas"]["LAD"] == pytest.approx(
        body["whatif"]["vessels"]["LAD"]["prob"] - body["base"]["vessels"]["LAD"]["prob"], abs=1e-3)
    assert "not medical advice" in body["caption"]


@pytest.mark.parametrize("overrides", [{"age": 30}, {"ldl": 9999}])
def test_whatif_rejects_bad_overrides(client, models, overrides):
    assert client.post("/whatif", json={"demo": "high", "overrides": overrides}).status_code == 422


def test_counterfactual(client, models):
    body = client.post("/counterfactual", json={"demo": "high", "target": "LCX"}).json()
    assert body["target"] == "LCX" and body["disclaimer"]
    assert body["options"] or body["note"] or body["already_below"]
    for opt in body["options"]:
        assert opt["new_prob"] < body["threshold"]
        assert all(ch["feature"] in explain.modifiable_features() for ch in opt["changes"])
        assert all("from" in ch for ch in opt["changes"])
    assert client.post("/counterfactual", json={"demo": "high", "target": "LM"}).status_code == 422


def test_batch_csv(client, models):
    df = data.clean(data.load_raw(data.raw_path())).head(5)[data.feature_names()]
    df.insert(0, "patient_id", [f"p{i}" for i in range(5)])
    df.loc[2, "ldl"] = 9999                                          # invalid row is reported
    csv = df.to_csv(index=False).encode()
    body = client.post("/predict/batch", files={"file": ("p.csv", io.BytesIO(csv), "text/csv")}).json()
    assert [r["patient_id"] for r in body["rows"]] == ["p0", "p1", "p3", "p4"]
    assert body["errors"][0]["row"] == 2
    assert body["disclaimer"]


def test_batch_rejects_unknown_columns(client, models):
    csv = b"age,shoe_size\n60,42\n"
    r = client.post("/predict/batch", files={"file": ("p.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 422


def test_metrics_and_global_explanations(client, models):
    assert set(client.get("/metrics").json()["targets"]) == set(config.all_targets())
    if explain.GLOBAL_JSON.exists():
        assert set(client.get("/explanations/global").json()["targets"]) == set(config.all_targets())


# ---------------------------------------------------------------- mock mode

@pytest.fixture
def mock_mode(monkeypatch):
    monkeypatch.setenv(registry.FORCE_MOCK_ENV, "1")


@pytest.mark.parametrize("demo", DEMOS)
def test_mock_predict(client, mock_mode, demo):
    r = client.post("/predict", json={"demo": demo})
    assert r.status_code == 200
    assert r.json()["model_version"] == "mock-0"


def test_mock_whatif_and_unknown_demo(client, mock_mode):
    body = client.post("/whatif", json={"demo": "high", "overrides": {"bp": 120}}).json()
    assert set(body["deltas"]) == set(config.all_targets())
    assert client.post("/predict", json={"demo": "nope"}).status_code == 404


def test_mock_mode_has_no_counterfactual(client, mock_mode):
    assert client.post("/counterfactual", json={"demo": "high", "target": "LAD"}).status_code == 503
