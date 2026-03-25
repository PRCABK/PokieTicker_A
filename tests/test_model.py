import importlib
import sys
import types
import unittest
from unittest import mock

try:
    import pandas as pd
except ModuleNotFoundError:
    pd = None


def load_model_module():
    fake_features = types.SimpleNamespace(
        build_features=lambda *_: None,
        build_features_multi=lambda *_: None,
        FEATURE_COLS=["feature_a", "feature_b", "feature_c"],
    )
    fake_joblib = types.SimpleNamespace(dump=lambda *_, **__: None, load=lambda *_, **__: None)
    fake_xgboost = types.SimpleNamespace(XGBClassifier=object)

    sys.modules.pop("backend.ml.model", None)
    with mock.patch.dict(
        sys.modules,
        {
            "backend.ml.features": fake_features,
            "joblib": fake_joblib,
            "xgboost": fake_xgboost,
        },
    ):
        return importlib.import_module("backend.ml.model")


@unittest.skipIf(pd is None, "pandas-backed model tests require project dependencies")
class PrepareTrainingDatasetTests(unittest.TestCase):
    def setUp(self):
        self.model = load_model_module()

    def test_rejects_single_class_targets(self):
        df = pd.DataFrame(
            {
                "trade_date": pd.date_range("2024-01-01", periods=30, freq="D"),
                "feature_a": range(30),
                "feature_b": range(1, 31),
                "feature_c": range(2, 32),
                "target_t1": [1] * 30,
            }
        )

        prepared, error = self.model._prepare_training_dataset(
            df,
            target_col="target_t1",
            min_rows=20,
            sort_cols=["trade_date"],
        )

        self.assertIsNone(prepared)
        self.assertEqual(error, "Target has only one class")

    def test_rejects_empty_feature_columns(self):
        df = pd.DataFrame(
            {
                "trade_date": pd.date_range("2024-01-01", periods=30, freq="D"),
                "feature_a": range(30),
                "feature_b": [None] * 30,
                "feature_c": range(2, 32),
                "target_t1": ([0, 1] * 15),
            }
        )

        prepared, error = self.model._prepare_training_dataset(
            df,
            target_col="target_t1",
            min_rows=20,
            sort_cols=["trade_date"],
        )

        self.assertIsNone(prepared)
        self.assertIn("feature_b", error)

    def test_sorts_rows_and_returns_split_metadata(self):
        df = pd.DataFrame(
            {
                "trade_date": pd.to_datetime(
                    [
                        "2024-01-05",
                        "2024-01-01",
                        "2024-01-03",
                        "2024-01-02",
                        "2024-01-04",
                        "2024-01-06",
                        "2024-01-07",
                        "2024-01-08",
                        "2024-01-09",
                        "2024-01-10",
                        "2024-01-11",
                        "2024-01-12",
                        "2024-01-13",
                        "2024-01-14",
                        "2024-01-15",
                        "2024-01-16",
                        "2024-01-17",
                        "2024-01-18",
                        "2024-01-19",
                        "2024-01-20",
                    ]
                ),
                "feature_a": range(20),
                "feature_b": range(20, 40),
                "feature_c": range(40, 60),
                "target_t1": [0, 1] * 10,
            }
        )

        prepared, error = self.model._prepare_training_dataset(
            df,
            target_col="target_t1",
            min_rows=20,
            sort_cols=["trade_date"],
        )

        self.assertIsNone(error)
        self.assertEqual(prepared["dates"][0], "2024-01-01")
        self.assertEqual(prepared["dates"][-1], "2024-01-20")
        self.assertEqual(prepared["split_idx"], 16)


if __name__ == "__main__":
    unittest.main()
