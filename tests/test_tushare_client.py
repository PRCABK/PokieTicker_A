import importlib
import sys
import types
import unittest
from unittest import mock


class FakeFrame:
    def __init__(self, records):
        self._records = [dict(row) for row in records]

    @property
    def empty(self):
        return len(self._records) == 0

    def to_dict(self, orient):
        if orient != "records":
            raise AssertionError(f"Unexpected orient: {orient}")
        return [dict(row) for row in self._records]


def load_tushare_client_module(pro_instance):
    fake_tushare = types.SimpleNamespace(pro_api=lambda _: pro_instance)
    fake_config = types.SimpleNamespace(settings=types.SimpleNamespace(tushare_token="test-token"))

    sys.modules.pop("backend.tushare.client", None)
    with mock.patch.dict(
        sys.modules,
        {
            "tushare": fake_tushare,
            "backend.config": fake_config,
        },
    ):
        return importlib.import_module("backend.tushare.client")


class TushareClientCacheTests(unittest.TestCase):
    def test_stock_basic_records_are_cached_across_search_queries(self):
        pro = mock.Mock()
        pro.stock_basic.return_value = FakeFrame(
            [
                {"ts_code": "000001.SZ", "symbol": "000001", "name": "Ping An Bank", "industry": "Bank"},
                {"ts_code": "600519.SH", "symbol": "600519", "name": "Kweichow Moutai", "industry": "Liquor"},
            ]
        )
        client = load_tushare_client_module(pro)

        first = client.search_tickers("000", limit=10)
        second = client.search_tickers("mout", limit=10)

        self.assertEqual(pro.stock_basic.call_count, 1)
        self.assertEqual(first, [{"symbol": "000001.SZ", "name": "Ping An Bank", "sector": "Bank"}])
        self.assertEqual(second, [{"symbol": "600519.SH", "name": "Kweichow Moutai", "sector": "Liquor"}])

    def test_get_ticker_name_uses_cached_records_before_remote_lookup(self):
        pro = mock.Mock()
        pro.stock_basic.return_value = FakeFrame(
            [
                {"ts_code": "000001.SZ", "symbol": "000001", "name": "Ping An Bank", "industry": "Bank"},
            ]
        )
        client = load_tushare_client_module(pro)

        name = client.get_ticker_name("000001.SZ")

        self.assertEqual(name, "Ping An Bank")
        self.assertEqual(pro.stock_basic.call_count, 1)

    def test_failed_initial_fetch_does_not_poison_cache(self):
        pro = mock.Mock()
        pro.stock_basic.side_effect = [
            RuntimeError("temporary outage"),
            FakeFrame(
                [
                    {"ts_code": "000001.SZ", "symbol": "000001", "name": "Ping An Bank", "industry": "Bank"},
                ]
            ),
        ]
        client = load_tushare_client_module(pro)

        first = client.search_tickers("000", limit=10)
        second = client.search_tickers("000", limit=10)

        self.assertEqual(first, [])
        self.assertEqual(second, [{"symbol": "000001.SZ", "name": "Ping An Bank", "sector": "Bank"}])
        self.assertEqual(pro.stock_basic.call_count, 2)

    def test_empty_match_refreshes_once_before_returning(self):
        pro = mock.Mock()
        pro.stock_basic.side_effect = [
            FakeFrame(
                [
                    {"ts_code": "000001.SZ", "symbol": "000001", "name": "Ping An Bank", "industry": "Bank"},
                ]
            ),
            FakeFrame(
                [
                    {"ts_code": "000001.SZ", "symbol": "000001", "name": "Ping An Bank", "industry": "Bank"},
                    {"ts_code": "688981.SH", "symbol": "688981", "name": "SMIC", "industry": "Semiconductor"},
                ]
            ),
        ]
        client = load_tushare_client_module(pro)

        matches = client.search_tickers("SMIC", limit=10)

        self.assertEqual(matches, [{"symbol": "688981.SH", "name": "SMIC", "sector": "Semiconductor"}])
        self.assertEqual(pro.stock_basic.call_count, 2)


if __name__ == "__main__":
    unittest.main()
