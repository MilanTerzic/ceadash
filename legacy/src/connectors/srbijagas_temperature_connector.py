from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd
import requests


LOGGER = logging.getLogger(__name__)


@dataclass
class SrbijagasTemperatureConnector:
    url: str
    timeout_seconds: int = 20

    def fetch(self) -> pd.DataFrame:
        try:
            response = requests.get(self.url, timeout=self.timeout_seconds)
            response.raise_for_status()
            tables = pd.read_html(response.text)
            if not tables:
                return pd.DataFrame()
            frame = tables[0].copy()
            frame["source"] = "srbijagas_page"
            frame["quality_flag"] = "actual"
            return frame
        except Exception as exc:
            LOGGER.warning("Srbijagas temperature fetch failed: %s", exc)
            return pd.DataFrame()
