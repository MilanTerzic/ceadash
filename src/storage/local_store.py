from __future__ import annotations

from pathlib import Path

import pandas as pd


class LocalStore:
    def __init__(self, base_dir: str) -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def save(self, name: str, frame: pd.DataFrame) -> Path:
        path = self.base_dir / f"{name}.parquet"
        try:
            frame.to_parquet(path, index=False)
            return path
        except Exception:
            fallback = self.base_dir / f"{name}.csv"
            frame.to_csv(fallback, index=False)
            return fallback

    def load(self, name: str) -> pd.DataFrame:
        path = self.base_dir / f"{name}.parquet"
        if not path.exists():
            return pd.DataFrame()
        return pd.read_parquet(path)
