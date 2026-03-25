import unittest
from unittest.mock import patch

try:
    import pandas as pd
    from backend.ml import features
except ModuleNotFoundError:
    pd = None
    features = None


@unittest.skipIf(pd is None or features is None, 'pandas-backed feature tests require project dependencies')
class BuildFeaturesMultiTests(unittest.TestCase):
    def test_build_features_multi_sorts_by_trade_date_then_symbol(self):
        aaa = pd.DataFrame(
            {
                'trade_date': pd.to_datetime(['2024-01-03', '2024-01-01']),
                'close': [3.0, 1.0],
            }
        )
        bbb = pd.DataFrame(
            {
                'trade_date': pd.to_datetime(['2024-01-02', '2024-01-01']),
                'close': [2.0, 4.0],
            }
        )

        def fake_build_features(symbol: str) -> pd.DataFrame:
            return {'AAA': aaa, 'BBB': bbb}[symbol].copy()

        with patch('backend.ml.features.build_features', side_effect=fake_build_features):
            combined = features.build_features_multi(['BBB', 'AAA'])

        ordered_pairs = list(zip(combined['trade_date'].dt.strftime('%Y-%m-%d'), combined['symbol']))
        self.assertEqual(
            ordered_pairs,
            [
                ('2024-01-01', 'AAA'),
                ('2024-01-01', 'BBB'),
                ('2024-01-02', 'BBB'),
                ('2024-01-03', 'AAA'),
            ],
        )


if __name__ == '__main__':
    unittest.main()
