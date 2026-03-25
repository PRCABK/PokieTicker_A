import importlib
import sys
import types
import unittest
from unittest import mock


def load_alignment_module():
    fake_database = types.SimpleNamespace(get_conn=lambda: None)
    sys.modules.pop("backend.pipeline.alignment", None)
    with mock.patch.dict(sys.modules, {"backend.database": fake_database}):
        return importlib.import_module("backend.pipeline.alignment")


class AlignmentAttributionTests(unittest.TestCase):
    def setUp(self):
        self.alignment = load_alignment_module()
        self.trade_idx = {
            "2024-01-15": 0,
            "2024-01-16": 1,
            "2024-01-17": 2,
        }

    def test_pre_market_news_stays_on_same_trade_day(self):
        attribution = self.alignment._classify_published_attribution(
            "2024-01-15 08:45:00",
            self.trade_idx,
        )

        self.assertEqual(
            attribution,
            {
                "trade_date": "2024-01-15",
                "session_bucket": "pre_market",
                "label_anchor": "same_day_open",
            },
        )

    def test_midday_break_news_keeps_same_day_anchor(self):
        attribution = self.alignment._classify_published_attribution(
            "2024-01-15 12:05:00",
            self.trade_idx,
        )

        self.assertEqual(
            attribution,
            {
                "trade_date": "2024-01-15",
                "session_bucket": "midday_break",
                "label_anchor": "afternoon_open",
            },
        )

    def test_post_market_news_rolls_to_next_trade_day(self):
        attribution = self.alignment._classify_published_attribution(
            "2024-01-15 18:20:00",
            self.trade_idx,
        )

        self.assertEqual(
            attribution,
            {
                "trade_date": "2024-01-16",
                "session_bucket": "post_market",
                "label_anchor": "next_open",
            },
        )

    def test_non_trading_day_news_rolls_to_next_trade_day(self):
        attribution = self.alignment._classify_published_attribution(
            "2024-01-13 10:00:00",
            self.trade_idx,
        )

        self.assertEqual(
            attribution,
            {
                "trade_date": "2024-01-15",
                "session_bucket": "non_trading",
                "label_anchor": "next_open",
            },
        )

    def test_utc_timestamp_is_converted_to_china_session_before_classifying(self):
        attribution = self.alignment._classify_published_attribution(
            "2024-01-15T00:30:00Z",
            self.trade_idx,
        )

        self.assertEqual(
            attribution,
            {
                "trade_date": "2024-01-15",
                "session_bucket": "pre_market",
                "label_anchor": "same_day_open",
            },
        )


if __name__ == "__main__":
    unittest.main()
