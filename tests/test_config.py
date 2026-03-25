import importlib
import sys
import types
import unittest
from unittest import mock


def load_config_module():
    fake_yaml = types.SimpleNamespace(safe_load=lambda _: {})
    sys.modules.pop('backend.config', None)
    with mock.patch.dict(sys.modules, {'yaml': fake_yaml}):
        return importlib.import_module('backend.config')


class SettingsTests(unittest.TestCase):
    def test_from_config_normalizes_deepseek_base_url_and_mysql_port(self):
        config_module = load_config_module()
        cfg = {
            'deepseek': {
                'api_key': 'k',
                'base_url': 'https://api.deepseek.com/chat/completions',
                'model': 'deepseek-chat',
            },
            'mysql': {
                'host': 'db.local',
                'port': '3307',
                'user': 'tester',
                'password': 'secret',
                'database': 'pokie',
            },
        }

        settings = config_module.Settings.from_config(cfg, [])

        self.assertEqual(settings.config_path, config_module.CONFIG_PATH)
        self.assertEqual(settings.deepseek_base_url, 'https://api.deepseek.com')
        self.assertEqual(settings.deepseek_model, 'deepseek-chat')
        self.assertEqual(settings.mysql_port, 3307)
        self.assertEqual(settings.mysql_password, 'secret')

    def test_validate_for_startup_reports_missing_required_mysql_fields(self):
        config_module = load_config_module()
        settings = config_module.Settings(
            config_path=config_module.CONFIG_PATH,
            config_errors=['Config file not found'],
            mysql_host=' ',
            mysql_user='',
            mysql_database='',
        )

        errors = settings.validate_for_startup()

        self.assertIn('Config file not found', errors)
        self.assertIn('mysql.host must not be empty', errors)
        self.assertIn('mysql.user must not be empty', errors)
        self.assertIn('mysql.database must not be empty', errors)


if __name__ == '__main__':
    unittest.main()
