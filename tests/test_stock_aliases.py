import importlib
import sys
import types
import unittest
from unittest import mock


class FakeRouter:
    def get(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator

    def post(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator

    def delete(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator


class FakeHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class FakeBaseModel:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def load_stocks_module():
    fake_fastapi = types.SimpleNamespace(
        APIRouter=lambda: FakeRouter(),
        BackgroundTasks=object,
        HTTPException=FakeHTTPException,
        Query=lambda *args, **kwargs: None,
    )
    fake_pydantic = types.SimpleNamespace(BaseModel=FakeBaseModel)
    fake_database = types.SimpleNamespace(
        get_conn=lambda: None,
        ensure_ticker_alias_table=lambda: None,
    )
    fake_tushare = types.SimpleNamespace(search_tickers=lambda *args, **kwargs: [])

    sys.modules.pop("backend.api.routers.stocks", None)
    with mock.patch.dict(
        sys.modules,
        {
            "fastapi": fake_fastapi,
            "pydantic": fake_pydantic,
            "backend.database": fake_database,
            "backend.tushare.client": fake_tushare,
        },
    ):
        return importlib.import_module("backend.api.routers.stocks")


class FakeCursor:
    def __init__(self, state):
        self.state = state
        self.result = None
        self.rowcount = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        params = params or ()
        self.rowcount = 0

        if normalized.startswith("SELECT t.symbol, t.name, t.sector,"):
            needle = str(params[1]).strip("%").lower()
            rows = []
            for symbol, meta in self.state["tickers"].items():
                alias_rows = [row for row in self.state["aliases"] if row["symbol"] == symbol]
                matched_aliases = sorted(
                    row["alias"] for row in alias_rows
                    if needle in row["alias"].lower()
                )
                if (
                    needle in symbol.lower()
                    or needle in str(meta.get("name") or "").lower()
                    or matched_aliases
                ):
                    rows.append(
                        {
                            "symbol": symbol,
                            "name": meta.get("name"),
                            "sector": meta.get("sector"),
                            "alias_hits": " / ".join(matched_aliases) if matched_aliases else None,
                        }
                    )
            rows.sort(key=lambda row: row["symbol"])
            self.result = rows[:10]
            return

        if normalized == "SELECT symbol, name, sector FROM tickers WHERE symbol = %s":
            symbol = params[0]
            ticker = self.state["tickers"].get(symbol)
            self.result = {
                "symbol": symbol,
                "name": ticker.get("name"),
                "sector": ticker.get("sector"),
            } if ticker else None
            return

        if normalized.startswith("SELECT symbol, alias, alias_type FROM ticker_aliases"):
            symbol = params[0]
            aliases = [
                dict(row)
                for row in self.state["aliases"]
                if row["symbol"] == symbol
            ]
            aliases.sort(key=lambda row: ((row.get("alias_type") or "~"), row["alias"]))
            self.result = aliases
            return

        if normalized.startswith("SELECT alias, alias_type FROM ticker_aliases"):
            symbol = params[0]
            aliases = [
                {"alias": row["alias"], "alias_type": row.get("alias_type")}
                for row in self.state["aliases"]
                if row["symbol"] == symbol
            ]
            aliases.sort(key=lambda row: ((row.get("alias_type") or "~"), row["alias"]))
            self.result = aliases
            return

        if normalized.startswith("INSERT INTO ticker_aliases"):
            symbol, alias, alias_type = params
            for row in self.state["aliases"]:
                if row["symbol"] == symbol and row["alias"] == alias:
                    row["alias_type"] = alias_type
                    self.rowcount = 1
                    return
            self.state["aliases"].append({"symbol": symbol, "alias": alias, "alias_type": alias_type})
            self.rowcount = 1
            return

        if normalized.startswith("DELETE FROM ticker_aliases"):
            symbol, alias = params
            before = len(self.state["aliases"])
            self.state["aliases"] = [
                row for row in self.state["aliases"]
                if not (row["symbol"] == symbol and row["alias"] == alias)
            ]
            self.rowcount = before - len(self.state["aliases"])
            return

        raise AssertionError(f"Unexpected SQL: {normalized}")

    def fetchall(self):
        return list(self.result or [])

    def fetchone(self):
        if isinstance(self.result, list):
            return self.result[0] if self.result else None
        return self.result


class FakeConnection:
    def __init__(self, state):
        self.state = state
        self.committed = False

    def cursor(self):
        return FakeCursor(self.state)

    def commit(self):
        self.committed = True

    def close(self):
        return None


class StockAliasApiTests(unittest.TestCase):
    def setUp(self):
        self.stocks = load_stocks_module()
        self.state = {
            "tickers": {
                "000001.SZ": {"name": "平安银行", "sector": "银行"},
                "600519.SH": {"name": "贵州茅台", "sector": "白酒"},
            },
            "aliases": [
                {"symbol": "000001.SZ", "alias": "平安", "alias_type": "简称"},
                {"symbol": "000001.SZ", "alias": "深发展", "alias_type": "历史简称"},
            ],
        }

    def _conn(self):
        return FakeConnection(self.state)

    def test_search_matches_aliases_without_duplicate_remote_rows(self):
        remote_results = [
            {"symbol": "000001.SZ", "name": "平安银行", "sector": "银行"},
            {"symbol": "600519.SH", "name": "贵州茅台", "sector": "白酒"},
        ]

        with mock.patch.object(self.stocks, "ensure_ticker_alias_table"), \
                mock.patch.object(self.stocks, "get_conn", side_effect=self._conn), \
                mock.patch.object(self.stocks, "search_tickers", return_value=remote_results):
            results = self.stocks.search("平安")

        self.assertEqual(results[0]["symbol"], "000001.SZ")
        self.assertEqual(results[0]["alias_hits"], "平安")
        self.assertEqual(sum(1 for row in results if row["symbol"] == "000001.SZ"), 1)
        self.assertEqual(results[1]["symbol"], "600519.SH")

    def test_add_alias_normalizes_and_invalidates_cache(self):
        with mock.patch.object(self.stocks, "ensure_ticker_alias_table"), \
                mock.patch.object(self.stocks, "get_conn", side_effect=self._conn), \
                mock.patch.object(self.stocks, "_invalidate_layer1_keyword_cache") as invalidate_mock:
            result = self.stocks.add_ticker_alias(
                "000001.sz",
                self.stocks.TickerAliasRequest(alias="  平安 银行  ", alias_type="  产品线  "),
            )

        self.assertEqual(result["symbol"], "000001.SZ")
        self.assertEqual(result["alias"], "平安 银行")
        self.assertEqual(result["alias_type"], "产品线")
        self.assertIn(
            {"symbol": "000001.SZ", "alias": "平安 银行", "alias_type": "产品线"},
            self.state["aliases"],
        )
        invalidate_mock.assert_called_once_with("000001.SZ")

    def test_delete_alias_removes_entry_and_raises_when_missing(self):
        with mock.patch.object(self.stocks, "ensure_ticker_alias_table"), \
                mock.patch.object(self.stocks, "get_conn", side_effect=self._conn), \
                mock.patch.object(self.stocks, "_invalidate_layer1_keyword_cache") as invalidate_mock:
            result = self.stocks.delete_ticker_alias("000001.sz", alias="深发展")

        self.assertEqual(result, {"symbol": "000001.SZ", "alias": "深发展", "status": "deleted"})
        self.assertNotIn(
            {"symbol": "000001.SZ", "alias": "深发展", "alias_type": "历史简称"},
            self.state["aliases"],
        )
        invalidate_mock.assert_called_once_with("000001.SZ")

        with mock.patch.object(self.stocks, "ensure_ticker_alias_table"), \
                mock.patch.object(self.stocks, "get_conn", side_effect=self._conn):
            with self.assertRaises(FakeHTTPException) as ctx:
                self.stocks.delete_ticker_alias("000001.SZ", alias="不存在")

        self.assertEqual(ctx.exception.status_code, 404)

    def test_keyword_snapshot_exposes_builtin_alias_and_merged_keywords(self):
        fake_layer1 = types.SimpleNamespace(
            TICKER_KEYWORDS={"000001.SZ": ["平安银行", "000001"]},
            get_keywords=lambda symbol: ["000001.sz", "000001", "平安银行", "平安", "深发展"],
        )

        with mock.patch.object(self.stocks, "ensure_ticker_alias_table"), \
                mock.patch.object(self.stocks, "get_conn", side_effect=self._conn), \
                mock.patch.dict(sys.modules, {"backend.pipeline.layer1": fake_layer1}):
            result = self.stocks.get_ticker_keywords("000001.sz")

        self.assertEqual(result["symbol"], "000001.SZ")
        self.assertEqual(result["builtin_keywords"], ["平安银行", "000001"])
        self.assertCountEqual(
            result["aliases"],
            [
                {"alias": "平安", "alias_type": "简称"},
                {"alias": "深发展", "alias_type": "历史简称"},
            ],
        )
        self.assertIn("平安", result["keywords"])


if __name__ == "__main__":
    unittest.main()
