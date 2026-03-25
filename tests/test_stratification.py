import unittest

from backend.ml.stratification import (
    derive_row_stratification,
    summarize_prediction_stratification,
    summarize_sample_stratification,
    summarize_trade_stratification,
)


class StratificationHelperTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {
                "board_bucket_id": 0.0,
                "cap_bucket_id": 0.0,
                "amount": 10_000.0,
                "turnover_rate": 0.3,
            },
            {
                "board_bucket_id": 1.0,
                "cap_bucket_id": 1.0,
                "amount": 60_000.0,
                "turnover_rate": 1.2,
            },
            {
                "board_bucket_id": 2.0,
                "cap_bucket_id": 2.0,
                "amount": 200_000.0,
                "turnover_rate": 4.0,
            },
        ]

    def test_derive_row_stratification_maps_board_cap_and_liquidity(self):
        low = derive_row_stratification(self.rows[0])
        mid = derive_row_stratification(self.rows[1])
        high = derive_row_stratification(self.rows[2])

        self.assertEqual(low, {"board": "main_board", "cap": "small_cap", "liquidity": "illiquid"})
        self.assertEqual(mid, {"board": "chinext", "cap": "mid_cap", "liquidity": "mid_liquidity"})
        self.assertEqual(high, {"board": "star_market", "cap": "large_cap", "liquidity": "high_liquidity"})

    def test_summarize_sample_stratification_returns_count_and_ratio(self):
        summary = summarize_sample_stratification(self.rows)

        self.assertEqual(summary["board"]["main_board"]["count"], 1)
        self.assertEqual(summary["board"]["main_board"]["ratio"], 0.3333)
        self.assertEqual(summary["liquidity"]["high_liquidity"]["count"], 1)

    def test_summarize_prediction_stratification_reports_accuracy_per_bucket(self):
        summary = summarize_prediction_stratification(
            self.rows,
            positions=[0, 1, 2],
            y_true=[1, 0, 1],
            y_pred=[1, 1, 0],
        )

        self.assertEqual(summary["board"]["main_board"]["accuracy"], 1.0)
        self.assertEqual(summary["board"]["chinext"]["accuracy"], 0.0)
        self.assertEqual(summary["cap"]["large_cap"]["predicted_up_ratio"], 0.0)

    def test_summarize_trade_stratification_reports_skips_and_returns(self):
        summary = summarize_trade_stratification(
            [
                {
                    "board": "main_board",
                    "cap": "small_cap",
                    "liquidity": "illiquid",
                    "theoretical_return": 0.05,
                    "tradable_return": None,
                    "skipped_reason": "low_liquidity",
                },
                {
                    "board": "chinext",
                    "cap": "mid_cap",
                    "liquidity": "mid_liquidity",
                    "theoretical_return": 0.04,
                    "tradable_return": 0.03,
                    "skipped_reason": None,
                },
                {
                    "board": "chinext",
                    "cap": "mid_cap",
                    "liquidity": "mid_liquidity",
                    "theoretical_return": -0.02,
                    "tradable_return": -0.01,
                    "skipped_reason": None,
                },
            ]
        )

        self.assertEqual(summary["liquidity"]["illiquid"]["skipped_trades"], 1)
        self.assertEqual(summary["liquidity"]["illiquid"]["skipped_ratio"], 1.0)
        self.assertEqual(summary["liquidity"]["illiquid"]["skipped_reason_counts"], {"low_liquidity": 1})
        self.assertEqual(summary["board"]["chinext"]["tradable_trades"], 2)
        self.assertEqual(summary["board"]["chinext"]["tradable_ratio"], 1.0)
        self.assertEqual(summary["board"]["chinext"]["avg_tradable_return_pct"], 1.0)


if __name__ == "__main__":
    unittest.main()
