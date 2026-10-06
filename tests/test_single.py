"""Single-container deployment (app/single.py): website at /, API at /api, SPA fallback."""
import pytest
from fastapi.testclient import TestClient

from app.single import DIST, app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_api_mounted_under_api(client):
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/model-info").json()["disclaimer"]


@pytest.mark.skipif(not DIST.exists(), reason="web/dist not built (cd web && npm run build)")
def test_site_and_spa_fallback(client):
    assert "<title>CoronaryTwin" in client.get("/").text
    assert "<title>CoronaryTwin" in client.get("/any/deep/link").text   # index.html fallback
    assert client.get("/../requirements.txt").status_code in (200, 404)   # never escapes web/dist
    assert "fastapi" not in client.get("/../requirements.txt").text.lower()


@pytest.mark.skipif(not DIST.exists(), reason="web/dist not built (cd web && npm run build)")
def test_assets_gzipped_and_cached(client):
    """Hosted judges should get the 3D chunk compressed and cached, as with nginx."""
    name = next(p.name for p in (DIST / "assets").glob("*.js") if p.stat().st_size > 100_000)
    r = client.get(f"/assets/{name}", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers["content-encoding"] == "gzip"
    assert "immutable" in r.headers["cache-control"]
    assert client.get("/", headers={"Accept-Encoding": "gzip"}).headers["cache-control"] == "no-cache"
