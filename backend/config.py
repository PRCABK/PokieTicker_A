import yaml
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config.yml"


def _load_yaml() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}


_cfg = _load_yaml()


class Settings:
    # Tushare
    tushare_token: str = _cfg.get("tushare", {}).get("token", "")

    # DeepSeek
    deepseek_api_key: str = _cfg.get("deepseek", {}).get("api_key", "")
    _deepseek_raw_base_url: str = _cfg.get("deepseek", {}).get("base_url", "https://api.deepseek.com")
    deepseek_base_url: str = _deepseek_raw_base_url.replace("/chat/completions", "").rstrip("/")
    deepseek_model: str = _cfg.get("deepseek", {}).get("model", "deepseek-reasoner")
    polygon_api_key: str = _cfg.get("polygon", {}).get("api_key", "")

    # MySQL
    mysql_host: str = _cfg.get("mysql", {}).get("host", "127.0.0.1")
    mysql_port: int = _cfg.get("mysql", {}).get("port", 3306)
    mysql_user: str = _cfg.get("mysql", {}).get("user", "root")
    mysql_password: str = _cfg.get("mysql", {}).get("password", "313131")
    mysql_database: str = _cfg.get("mysql", {}).get("database", "pokieticker")
    mysql_charset: str = _cfg.get("mysql", {}).get("charset", "utf8mb4")


settings = Settings()
