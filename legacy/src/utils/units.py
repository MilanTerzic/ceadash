from __future__ import annotations

from typing import Iterable

import pandas as pd


def energy_to_mwh(value: float | int | None, unit: str | None) -> float | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, str) and value.startswith("#"):
        return None
    normalized = (unit or "").strip().lower()
    try:
        numeric_value = float(value)
    except (TypeError, ValueError):
        return None
    if normalized in {"mwh", "mwh/d"}:
        return numeric_value
    if normalized in {"kwh", "kwh/d"}:
        return numeric_value / 1000.0
    if normalized in {"gwh", "gwh/d"}:
        return numeric_value * 1000.0
    return numeric_value


def mwh_to_mcm(value_mwh: float | int | None, mcm_to_gwh: float) -> float | None:
    if value_mwh is None or pd.isna(value_mwh):
        return None
    return float(value_mwh) / (mcm_to_gwh * 1000.0)


def mcm_to_mwh(value_mcm: float | int | None, mcm_to_gwh: float) -> float | None:
    if value_mcm is None or pd.isna(value_mcm):
        return None
    return float(value_mcm) * mcm_to_gwh * 1000.0


def ensure_datetime(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce").dt.tz_localize(None)


def first_non_null(values: Iterable[object]) -> object | None:
    for value in values:
        if value is not None and not pd.isna(value):
            return value
    return None
