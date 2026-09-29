from __future__ import annotations

import logging
from dataclasses import dataclass

import pandas as pd
import requests


LOGGER = logging.getLogger(__name__)


@dataclass
class OpenMeteoConnector:
    base_url: str
    timeout_seconds: int = 20

    def fetch_daily_temperature(
        self,
        city: str,
        latitude: float,
        longitude: float,
        start_date: str,
        end_date: str,
    ) -> pd.DataFrame:
        params = {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "daily": "temperature_2m_mean,temperature_2m_max,temperature_2m_min",
            "timezone": "Europe/Belgrade",
        }
        try:
            response = requests.get(self.base_url, params=params, timeout=self.timeout_seconds)
            response.raise_for_status()
            payload = response.json()
            daily = payload.get("daily", {})
            frame = pd.DataFrame(
                {
                    "date": daily.get("time", []),
                    "city": city,
                    "avg_temp_c": daily.get("temperature_2m_mean", []),
                    "max_temp_c": daily.get("temperature_2m_max", []),
                    "min_temp_c": daily.get("temperature_2m_min", []),
                    "source": "open_meteo",
                    "quality_flag": "actual",
                }
            )
            if not frame.empty:
                frame["date"] = pd.to_datetime(frame["date"]).dt.normalize()
            return frame
        except Exception as exc:
            LOGGER.warning("Open-Meteo fetch failed for %s: %s", city, exc)
            return pd.DataFrame()
