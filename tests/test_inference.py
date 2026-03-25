import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

try:
    import pandas as pd
    import numpy as np
    from backend.ml import inference
    from backend.ml.features import FEATURE_COLS, LEGACY_FEATURE_COLS
except ModuleNotFoundError:
    pd = None
    np = None
    inference = None
    FEATURE_COLS = []
    LEGACY_FEATURE_COLS = []


@unittest.skipIf(pd is None or np is None or inference is None, 'inference tests require project dependencies')
class ForecastInferenceTests(unittest.TestCase):
    def test_generate_forecast_keeps_similarity_vector_on_full_feature_space(self):
        rows = 25
        data = {
            'trade_date': pd.date_range('2024-01-01', periods=rows, freq='D'),
            'close': np.linspace(10.0, 20.0, rows),
            'amount': np.full(rows, 50000.0),
            'turnover_rate': np.full(rows, 1.2),
            'board_bucket_id': np.zeros(rows),
            'cap_bucket_id': np.ones(rows),
            'n_articles': np.ones(rows),
            'sentiment_score': np.full(rows, 0.1),
        }
        for idx, col in enumerate(FEATURE_COLS):
            if col not in data:
                data[col] = np.full(rows, float(idx + 1))
        df = pd.DataFrame(data)

        class FakeModel:
            feature_importances_ = np.ones(len(LEGACY_FEATURE_COLS), dtype=float)

            def predict_proba(self, X):
                return np.array([[0.4, 0.6]])

        captured = {}

        def fake_find_similar_periods(feature_df, window_vec, window_days, top_k=10):
            captured['window_vec_len'] = len(window_vec)
            captured['feature_cols_len'] = len(FEATURE_COLS)
            return []

        with tempfile.TemporaryDirectory() as tmpdir:
            model_dir = Path(tmpdir)
            (model_dir / 'UNIFIED_t1.joblib').write_bytes(b'fake')
            (model_dir / 'UNIFIED_t1_meta.json').write_text(json.dumps({
                'feature_cols': LEGACY_FEATURE_COLS,
                'accuracy': 0.6,
                'baseline': 0.5,
                'target_definition': 'absolute_direction',
                'benchmark_symbol': None,
            }))

            with mock.patch.object(inference, 'MODELS_DIR', model_dir), \
                    mock.patch.object(inference, 'build_features', return_value=df), \
                    mock.patch.object(inference, '_load_recent_news', return_value=[]), \
                    mock.patch.object(inference, '_find_similar_periods', side_effect=fake_find_similar_periods), \
                    mock.patch.object(inference.joblib, 'load', return_value=FakeModel()):
                result = inference.generate_forecast('000001.SZ', window_days=7)

        self.assertIn('prediction', result)
        self.assertEqual(captured['window_vec_len'], captured['feature_cols_len'])


if __name__ == '__main__':
    unittest.main()
