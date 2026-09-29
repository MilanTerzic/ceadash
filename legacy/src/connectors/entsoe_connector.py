from __future__ import annotations

import logging
from dataclasses import dataclass
from io import StringIO
import xml.etree.ElementTree as ET

import pandas as pd
import requests


LOGGER = logging.getLogger(__name__)


@dataclass
class EntsoeConnector:
    api_key: str
    area_code: str
    timeout_seconds: int = 30
    base_url: str = "https://web-api.tp.entsoe.eu/api"

    def fetch_gas_generation(self, start_date: str, end_date: str) -> pd.DataFrame:
        if not self.api_key:
            return pd.DataFrame()
        params = {
            "securityToken": self.api_key,
            "documentType": "A75",
            "processType": "A16",
            "in_Domain": self.area_code,
            "psrType": "B04",
            "periodStart": start_date.replace("-", "") + "0000",
            "periodEnd": end_date.replace("-", "") + "2300",
        }
        try:
            response = requests.get(self.base_url, params=params, timeout=self.timeout_seconds)
            response.raise_for_status()
            return self._parse_generation_xml(response.text)
        except Exception as exc:
            LOGGER.warning("ENTSO-E fetch failed: %s", exc)
            return pd.DataFrame()

    def _parse_generation_xml(self, xml_text: str) -> pd.DataFrame:
        namespace = {"ns": "urn:iec62325.351:tc57wg16:451-6:generationloaddocument:3:0"}
        root = ET.parse(StringIO(xml_text)).getroot()
        records: list[dict[str, object]] = []
        for series in root.findall(".//ns:TimeSeries", namespace):
            period = series.find(".//ns:Period", namespace)
            if period is None:
                continue
            start = period.findtext(".//ns:start", default=None, namespaces=namespace)
            resolution = period.findtext(".//ns:resolution", default="PT60M", namespaces=namespace)
            points = period.findall(".//ns:Point", namespace)
            start_ts = pd.to_datetime(start, utc=True) if start else None
            for point in points:
                position = int(point.findtext("ns:position", default="1", namespaces=namespace))
                quantity = point.findtext("ns:quantity", default=None, namespaces=namespace)
                if start_ts is None or quantity is None:
                    continue
                timestamp = start_ts + pd.to_timedelta(position - 1, unit="h")
                records.append(
                    {
                        "date": timestamp.tz_convert("Europe/Belgrade").tz_localize(None).normalize(),
                        "country": "Serbia",
                        "generation_mwh": float(quantity),
                        "generation_gwh": float(quantity) / 1000.0,
                        "source": "entsoe",
                        "quality_flag": "actual",
                        "resolution": resolution,
                    }
                )
        frame = pd.DataFrame(records)
        if frame.empty:
            return frame
        return frame.groupby(["date", "country", "source", "quality_flag"], as_index=False)[
            ["generation_mwh", "generation_gwh"]
        ].sum()
