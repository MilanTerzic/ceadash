from __future__ import annotations

import pandas as pd


def validate_time_series(
    frame: pd.DataFrame,
    date_col: str,
    value_col: str | None = None,
    allow_negative: bool = True,
) -> pd.DataFrame:
    warnings: list[dict[str, object]] = []
    local = frame.copy()
    local[date_col] = pd.to_datetime(local[date_col], errors="coerce")

    if local[date_col].isna().any():
        warnings.append(
            {
                "check": "missing_dates",
                "count": int(local[date_col].isna().sum()),
                "severity": "warning",
            }
        )

    duplicates = int(local.duplicated(subset=[date_col]).sum())
    if duplicates:
        warnings.append(
            {
                "check": "duplicate_dates",
                "count": duplicates,
                "severity": "warning",
            }
        )

    if value_col and value_col in local.columns:
        negative_count = int((local[value_col].fillna(0) < 0).sum())
        if negative_count and not allow_negative:
            warnings.append(
                {
                    "check": "negative_values",
                    "count": negative_count,
                    "severity": "warning",
                }
            )

        deltas = local[value_col].diff().abs()
        baseline = deltas.median()
        if pd.notna(baseline) and baseline > 0:
            large_jumps = int((deltas > baseline * 5).sum())
            if large_jumps:
                warnings.append(
                    {
                        "check": "large_day_to_day_jumps",
                        "count": large_jumps,
                        "severity": "info",
                    }
                )

    return pd.DataFrame(warnings)
