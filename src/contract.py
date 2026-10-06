"""Shared rules that the ML code, the API and the tests must agree on.

Keeping these in one place means the conformal-set wording, the risk state shown
on cards and the coherence flag cannot drift apart between modules.
"""
from __future__ import annotations

from . import config

POSITIVE = "CAD"
NEGATIVE = "No CAD"

LIKELY = "Likely"
UNLIKELY = "Unlikely"
UNCERTAIN = "Uncertain"


def state_from_set(pred_set: list[str]) -> str:
    """Map a conformal prediction set to the card state: Likely / Unlikely / Uncertain."""
    s = set(pred_set)
    if s == {POSITIVE}:
        return LIKELY
    if s == {NEGATIVE}:
        return UNLIKELY
    return UNCERTAIN  # both labels, or the rare empty set


def overall_label(pred_set: list[str]) -> str:
    state = state_from_set(pred_set)
    if state == UNCERTAIN:
        return UNCERTAIN
    return f"CAD {state.lower()}"


def coherence(p_overall: float, p_vessels: dict[str, float]) -> dict:
    """Flag disagreement between the overall CAD model and the vessel models."""
    th = config.settings()["coherence"]
    hi, lo = th["high"], th["low"]
    top_id = max(p_vessels, key=p_vessels.get)
    top = p_vessels[top_id]
    if p_overall >= hi and top <= lo:
        return {"flag": True, "note": (
            f"Overall CAD estimate is high ({p_overall:.0%}) but no single vessel is "
            f"(highest: {top_id} {top:.0%}). Interpret with caution.")}
    if p_overall <= lo and top >= hi:
        return {"flag": True, "note": (
            f"Overall CAD estimate is low ({p_overall:.0%}) but {top_id} is high "
            f"({top:.0%}). Interpret with caution.")}
    return {"flag": False, "note": ""}
