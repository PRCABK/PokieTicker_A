import unittest

from backend.news_events import classify_event_types, parse_event_types


class NewsEventTypingTests(unittest.TestCase):
    def test_classifies_multiple_event_types_from_text(self):
        event_types = classify_event_types(
            "公司发布业绩预增公告并披露回购计划",
            "预计净利润增长，同时董事会审议股份回购方案",
        )

        self.assertEqual(event_types, ["earnings", "buyback_increase", "management"])

    def test_returns_other_when_no_rule_matches(self):
        event_types = classify_event_types("公司参加地方展会", "介绍企业文化活动")

        self.assertEqual(event_types, ["other"])

    def test_parse_event_types_prefers_stored_json(self):
        event_types = parse_event_types('["policy","product_tech"]', "无关文本")

        self.assertEqual(event_types, ["policy", "product_tech"])


if __name__ == "__main__":
    unittest.main()
