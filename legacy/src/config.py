from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass
class AppConfig:
    raw: dict[str, Any]

    @property
    def app(self) -> dict[str, Any]:
        return self.raw["app"]

    @property
    def assumptions(self) -> dict[str, Any]:
        return self.raw["assumptions"]

    @property
    def connectors(self) -> dict[str, Any]:
        return self.raw["connectors"]

    @property
    def paths(self) -> dict[str, Any]:
        return self.raw["paths"]


def _deep_update(base: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = _deep_update(base[key], value)
        else:
            base[key] = value
    return base


def load_config(path: str | Path = "config/default_config.yaml") -> AppConfig:
    path = os.getenv("APP_CONFIG_PATH", path)
    with open(path, "r", encoding="utf-8") as handle:
        raw = yaml.safe_load(handle)
    config_dir = Path(path).resolve().parent

    workbook_path = Path(raw["app"]["workbook_path"])
    if not workbook_path.is_absolute():
        raw["app"]["workbook_path"] = str((config_dir.parent / workbook_path).resolve())

    for key in ("processed_data_dir", "exports_dir"):
        configured = Path(raw["app"][key])
        if not configured.is_absolute():
            raw["app"][key] = str((config_dir.parent / configured).resolve())

    for key in ("default_price_seed", "domestic_production_seed", "manual_upload_template_dir"):
        if key in raw["paths"]:
            configured = Path(raw["paths"][key])
            if not configured.is_absolute():
                raw["paths"][key] = str((config_dir.parent / configured).resolve())

    workbook_override = os.getenv("WORKBOOK_PATH")
    if workbook_override:
        raw["app"]["workbook_path"] = workbook_override

    entsoe_api_key = os.getenv("ENTSOE_API_KEY")
    if entsoe_api_key:
        raw["connectors"]["entsoe"]["api_key"] = entsoe_api_key

    return AppConfig(raw=raw)


def ensure_directories(config: AppConfig) -> None:
    folders = [
        config.app["processed_data_dir"],
        config.app["exports_dir"],
        "data/raw",
        "data/templates",
    ]
    for folder in folders:
        Path(folder).mkdir(parents=True, exist_ok=True)
