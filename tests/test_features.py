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

    def test_build_features_backfills_missing_optional_context_columns(self):
        ohlc = pd.DataFrame(
            {
                'symbol': ['000001.SZ'] * 40,
                'date': pd.date_range('2024-01-01', periods=40, freq='D'),
                'open': [10.0 + i * 0.1 for i in range(40)],
                'high': [10.3 + i * 0.1 for i in range(40)],
                'low': [9.7 + i * 0.1 for i in range(40)],
                'close': [10.1 + i * 0.1 for i in range(40)],
                'volume': [1000.0 + i * 10 for i in range(40)],
                'amount': [50000.0 + i * 100 for i in range(40)],
                'turnover_rate': [1.0] * 40,
                'circ_mv': [1_000_000.0] * 40,
                'total_mv': [1_500_000.0] * 40,
                'ticker_name': ['平安银行'] * 40,
                'sector': [None] * 40,
            }
        )
        empty_news = pd.DataFrame()
        benchmark = pd.DataFrame(
            {
                'trade_date': pd.date_range('2024-01-01', periods=40, freq='D'),
                'benchmark_close': [3000.0 + i for i in range(40)],
            }
        )
        market_context = pd.DataFrame(
            {
                'trade_date': pd.date_range('2024-01-01', periods=40, freq='D'),
                'mkt_articles': [1.0] * 40,
                'mkt_positive': [1.0] * 40,
                'mkt_negative': [0.0] * 40,
                'mkt_tickers_active': [1.0] * 40,
                'mkt_sentiment': [1.0] * 40,
                'mkt_positive_ratio': [1.0] * 40,
                'mkt_sentiment_3d': [1.0] * 40,
                'mkt_sentiment_5d': [1.0] * 40,
                'mkt_momentum': [0.0] * 40,
            }
        )

        with patch('backend.ml.features._load_ohlc', return_value=ohlc.copy()), \
                patch('backend.ml.features._load_news_features', return_value=empty_news), \
                patch('backend.ml.features.get_benchmark_symbol_for_equity', return_value='000001.SH'), \
                patch('backend.ml.features._load_benchmark_close', return_value=benchmark.copy()), \
                patch('backend.ml.features._load_market_sentiment_context', return_value=market_context.copy()), \
                patch('backend.ml.features._load_industry_sentiment_context', return_value=pd.DataFrame()):
            df = features.build_features('000001.SZ')

        self.assertFalse(df.empty)
        for col in [
            'industry_articles',
            'industry_positive',
            'industry_negative',
            'industry_tickers_active',
            'industry_sentiment',
            'industry_positive_ratio',
            'industry_sentiment_3d',
            'industry_sentiment_5d',
            'industry_momentum',
        ]:
            self.assertIn(col, df.columns)
            self.assertTrue((df[col] == 0.0).all())


if __name__ == '__main__':
    unittest.main()
