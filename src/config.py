"""Project paths and settings, loaded once from config/settings.yaml."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
ARTIFACTS_DIR = ROOT / "artifacts"
MODELS_DIR = ARTIFACTS_DIR / "models"
FIXTURES_DIR = ROOT / "fixtures"
WEB_DIR = ROOT / "web"

FEATURES_YAML = ROOT / "features.yaml"
REGISTRY_JSON = ARTIFACTS_DIR / "registry.json"
METRICS_JSON = ARTIFACTS_DIR / "metrics.json"
MANIFEST_JSON = ARTIFACTS_DIR / "feature_manifest.json"
ANATOMY_JSON = WEB_DIR / "src" / "anatomy.json"


@lru_cache(maxsize=1)
def settings() -> dict[str, Any]:
    with open(CONFIG_DIR / "settings.yaml", encoding="utf-8") as f:
        return yaml.safe_load(f)


def seed() -> int:
    return int(settings()["project"]["seed"])


def overall_target() -> str:
    return settings()["targets"]["overall"]


def vessel_ids() -> list[str]:
    return list(settings()["targets"]["vessels"])


def all_targets() -> list[str]:
    return [overall_target(), *vessel_ids()]


def feature_groups() -> list[str]:
    return list(settings()["feature_groups"])


def disclaimer() -> str:
    return " ".join(settings()["disclaimer"].split())
