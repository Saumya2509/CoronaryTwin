"""Single-container deployment: the API under /api and the built website at /.

    uvicorn app.single:app --port 7860        # after `cd web && npm run build`

Same URLs as the two-container setup (nginx proxies /api), so the frontend needs no change.
Used by Dockerfile.single for one-service hosts (Hugging Face Spaces, Render, Fly.io, a VM).
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from src import config

from .main import app as api

DIST = Path(__file__).resolve().parents[1] / "web" / "dist"


class ImmutableAssets(StaticFiles):
    """Hashed build assets never change: let browsers cache them for a year (as nginx.conf does)."""

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


app = FastAPI(title="CoronaryTwin", docs_url=None, redoc_url=None, lifespan=api.router.lifespan_context)
# Same as nginx's `gzip on`: the 3D chunk is ~950 KB raw but ~250 KB gzipped.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.mount("/api", api)

if DIST.exists():
    app.mount("/assets", ImmutableAssets(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        """Static files when they exist, otherwise index.html (single-page app)."""
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST in f.parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html", headers={"Cache-Control": "no-cache"})
else:  # pragma: no cover - only when the web build is missing
    @app.get("/", include_in_schema=False)
    def missing() -> dict:
        return {"error": "web/dist not built", "disclaimer": config.disclaimer()}
