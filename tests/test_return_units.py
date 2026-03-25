import importlib
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


class FakeRouter:
    def get(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator


def load_news_module():
    fake_fastapi = types.SimpleNamespace(APIRouter=lambda: FakeRouter(), Query=lambda *args, **kwargs: None)
    fake_database = types.SimpleNamespace(get_conn=lambda: None)

    sys.modules.pop("backend.api.routers.news", None)
    with mock.patch.dict(
        sys.modules,
        {
            "fastapi": fake_fastapi,
            "backend.database": fake_database,
        },
    ):
        return importlib.import_module("backend.api.routers.news")


def load_similarity_module():
    fake_config = types.SimpleNamespace(PROJECT_ROOT=Path("."))
    fake_database = types.SimpleNamespace(get_conn=lambda: None)
    fake_feature_text = types.SimpleNamespace(TfidfVectorizer=object)
    fake_pairwise = types.SimpleNamespace(cosine_similarity=lambda *args, **kwargs: None)
    fake_numpy = types.SimpleNamespace(median=lambda values: values[0] if values else 0)

    sys.modules.pop("backend.pipeline.similarity", None)
    with mock.patch.dict(
        sys.modules,
        {
            "backend.config": fake_config,
            "backend.database": fake_database,
            "sklearn.feature_extraction.text": fake_feature_text,
            "sklearn.metrics.pairwise": fake_pairwise,
            "numpy": fake_numpy,
        },
    ):
        return importlib.import_module("backend.pipeline.similarity")


class ReturnUnitNormalizationTests(unittest.TestCase):
    def test_news_normalize_return_fields_converts_ratios_to_percent(self):
        news_module = load_news_module()

        normalized = news_module._normalize_return_fields(
            {
                "ret_t0": 0.01234,
                "ret_t1": -0.055,
                "ret_t3": None,
                "title": "demo",
            }
        )

        self.assertEqual(normalized["ret_t0"], 1.23)
        self.assertEqual(normalized["ret_t1"], -5.5)
        self.assertIsNone(normalized["ret_t3"])
        self.assertEqual(normalized["title"], "demo")

    def test_similarity_ratio_to_percent_matches_api_contract(self):
        similarity_module = load_similarity_module()

        self.assertEqual(similarity_module._ratio_to_percent(0.0456), 4.56)
        self.assertEqual(similarity_module._ratio_to_percent(-0.0789), -7.89)
        self.assertIsNone(similarity_module._ratio_to_percent(None))


if __name__ == "__main__":
    unittest.main()
