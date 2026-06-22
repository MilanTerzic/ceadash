from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd
import requests


LOGGER = logging.getLogger(__name__)


@dataclass
class EntsogConnector:
    base_url: str
    timeout_seconds: int = 20

    def fetch_allocations(
        self,
        start_date: str,
        end_date: str,
        points: list[str] | None = None,
    ) -> pd.DataFrame:
        params = {
            "limit": 10000,
            "from": start_date,
            "to": end_date,
            "indicator": "Allocation",
            "periodType": "day",
        }
        if points:
            params["pointDirection"] = ",".join(points)
        try:
            response = requests.get(
                f"{self.base_url}/operationaldata.json",
                params=params,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            payload = response.json()
            data = payload.get("operationalData", payload)
            frame = pd.DataFrame(data)
            if frame.empty:
                return frame
            frame["date"] = pd.to_datetime(frame.get("periodFrom"), errors="coerce").dt.normalize()
            frame["source"] = "entsog"
            frame["quality_flag"] = "actual"
            return frame
        except Exception as exc:
            LOGGER.warning("ENTSOG fetch failed: %s", exc)
            return pd.DataFrame()
