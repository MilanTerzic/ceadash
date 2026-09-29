from __future__ import annotations

import pandas as pd


def load_manual_generation(frame: pd.DataFrame) -> pd.DataFrame:
    output = frame.copy()
    output["date"] = pd.to_datetime(output["date"], errors="coerce").dt.normalize()
    if "generation_gwh" not in output.columns and "generation_mwh" in output.columns:
        output["generation_gwh"] = output["generation_mwh"] / 1000.0
    if "generation_mwh" not in output.columns and "generation_gwh" in output.columns:
        output["generation_mwh"] = output["generation_gwh"] * 1000.0
    output["country"] = output.get("country", "Serbia")
    output["source"] = "manual_upload"
    output["quality_flag"] = "manual_upload"
    return output[["date", "country", "generation_mwh", "generation_gwh", "source", "quality_flag"]]
