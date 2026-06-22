from __future__ import annotations

from pathlib import Path

import pandas as pd


def export_report(output_path: str | Path, datasets: dict[str, pd.DataFrame]) -> Path:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        for sheet_name, frame in datasets.items():
            safe_name = sheet_name[:31]
            frame.to_excel(writer, sheet_name=safe_name, index=False)
    return output
