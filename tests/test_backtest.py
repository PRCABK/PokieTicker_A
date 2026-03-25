import importlib
import sys
import types
import unittest
from unittest import mock


def load_backtest_module():
    fake_features = types.SimpleNamespace(
        build_features=lambda *_: None,
        build_features_multi=lambda *_: None,
        FEATURE_COLS=["feature_a"],
    )
    fake_numpy = types.SimpleNamespace(mean=lambda values: sum(values) / len(values) if values else 0.0)

    sys.modules.pop("backend.ml.backtest", None)
    with mock.patch.dict(
        sys.modules,
        {
            "backend.ml.features": fake_features,
            "numpy": fake_numpy,
        },
    ):
        return importlib.import_module("backend.ml.backtest")


class BacktestConstraintTests(unittest.TestCase):
    def setUp(self):
        self.backtest = load_backtest_module()
        self.constraints = self.backtest.BacktestConstraints()

    def test_extract_horizon_days(self):
        self.assertEqual(self.backtest._extract_horizon_days("t5"), 5)

    def test_limit_up_entry_detection(self):
        blocked = self.backtest._is_limit_up_entry(10.0, 11.0, 0.1)
        self.assertTrue(blocked)

    def test_limit_down_exit_detection(self):
        blocked = self.backtest._is_limit_down_exit(10.0, 9.0, 0.1)
        self.assertTrue(blocked)

    def test_low_liquidity_detection(self):
        self.assertTrue(self.backtest._is_low_liquidity(10000, 0.8, self.constraints))
        self.assertTrue(self.backtest._is_low_liquidity(50000, 0.1, self.constraints))
        self.assertFalse(self.backtest._is_low_liquidity(50000, 1.2, self.constraints))

    def test_halt_resume_detection(self):
        self.assertTrue(self.backtest._is_resumed_after_halt(15, self.constraints))
        self.assertFalse(self.backtest._is_resumed_after_halt(5, self.constraints))

    def test_summarize_trade_returns(self):
        summary = self.backtest._summarize_trade_returns([0.1, -0.05])

        self.assertEqual(summary["trades"], 2)
        self.assertEqual(summary["win_rate"], 0.5)
        self.assertEqual(summary["avg_return_pct"], 2.5)
        self.assertEqual(summary["total_return_pct"], 4.5)


if __name__ == "__main__":
    unittest.main()
