from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config.yml"


def _load_yaml() -> tuple[dict[str, Any], list[str]]:
    if not CONFIG_PATH.exists():
        return {}, [f"Config file not found: {CONFIG_PATH}"]

    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except yaml.YAMLError as exc:
        return {}, [f"Config file is invalid YAML: {exc}"]

    if data is None:
        return {}, []
    if not isinstance(data, dict):
        return {}, [f"Config file must contain a YAML object at the root: {CONFIG_PATH}"]
    return data, []


def _section(cfg: dict[str, Any], key: str) -> dict[str, Any]:
    value = cfg.get(key, {})
    return value if isinstance(value, dict) else {}


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


@dataclass(slots=True)
class Settings:
    config_path: Path
    config_errors: list[str] = field(default_factory=list)

    tushare_token: str = ""

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-reasoner"
    polygon_api_key: str = ""

    mysql_host: str = "127.0.0.1"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = ""
    mysql_database: str = "pokieticker"
    mysql_charset: str = "utf8mb4"

    @classmethod
    def from_config(cls, cfg: dict[str, Any], errors: list[str]) -> "Settings":
        tushare_cfg = _section(cfg, "tushare")
        deepseek_cfg = _section(cfg, "deepseek")
        polygon_cfg = _section(cfg, "polygon")
        mysql_cfg = _section(cfg, "mysql")

        raw_base_url = str(deepseek_cfg.get("base_url", "https://api.deepseek.com") or "https://api.deepseek.com")
        return cls(
            config_path=CONFIG_PATH,
            config_errors=list(errors),
            tushare_token=str(tushare_cfg.get("token", "") or ""),
            deepseek_api_key=str(deepseek_cfg.get("api_key", "") or ""),
            deepseek_base_url=raw_base_url.replace("/chat/completions", "").rstrip("/"),
            deepseek_model=str(deepseek_cfg.get("model", "deepseek-reasoner") or "deepseek-reasoner"),
            polygon_api_key=str(polygon_cfg.get("api_key", "") or ""),
            mysql_host=str(mysql_cfg.get("host", "127.0.0.1") or "127.0.0.1"),
            mysql_port=_as_int(mysql_cfg.get("port", 3306), 3306),
            mysql_user=str(mysql_cfg.get("user", "root") or "root"),
            mysql_password=str(mysql_cfg.get("password", "") or ""),
            mysql_database=str(mysql_cfg.get("database", "pokieticker") or "pokieticker"),
            mysql_charset=str(mysql_cfg.get("charset", "utf8mb4") or "utf8mb4"),
        )

    def validate_for_startup(self) -> list[str]:
        errors = list(self.config_errors)
        if not self.mysql_host.strip():
            errors.append("mysql.host must not be empty")
        if not self.mysql_user.strip():
            errors.append("mysql.user must not be empty")
        if not self.mysql_database.strip():
            errors.append("mysql.database must not be empty")
        return errors


_cfg, _cfg_errors = _load_yaml()
settings = Settings.from_config(_cfg, _cfg_errors)
