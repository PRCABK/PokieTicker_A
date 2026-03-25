import importlib
import sys
import types
import unittest
from unittest import mock


def load_database_module():
    fake_yaml = types.SimpleNamespace(safe_load=lambda _: {})
    fake_pymysql = types.SimpleNamespace(
        connect=lambda **_: None,
        connections=types.SimpleNamespace(Connection=object),
        cursors=types.SimpleNamespace(DictCursor=object),
        err=types.SimpleNamespace(OperationalError=Exception),
    )
    sys.modules.pop('backend.config', None)
    sys.modules.pop('backend.database', None)
    with mock.patch.dict(sys.modules, {'yaml': fake_yaml, 'pymysql': fake_pymysql}):
        return importlib.import_module('backend.database')


class SqlSplitTests(unittest.TestCase):
    def test_split_sql_statements_ignores_comments_and_embedded_semicolons(self):
        database_module = load_database_module()
        sql_text = """
        -- leading comment with ;
        CREATE TABLE example (
            id INT PRIMARY KEY,
            note TEXT DEFAULT 'semi;colon',
            quoted TEXT DEFAULT \"double;semi\",
            `weird;name` VARCHAR(20)
        );
        # mysql style comment ;
        INSERT INTO example (id, note) VALUES (1, 'value;still here');
        /* block comment ; ; */
        CREATE INDEX idx_example_note ON example (`weird;name`);
        """

        statements = database_module.split_sql_statements(sql_text)

        self.assertEqual(len(statements), 3)
        self.assertTrue(statements[0].startswith('CREATE TABLE example'))
        self.assertIn("'semi;colon'", statements[0])
        self.assertTrue(statements[1].startswith('INSERT INTO example'))
        self.assertIn("'value;still here'", statements[1])
        self.assertTrue(statements[2].startswith('CREATE INDEX idx_example_note'))

    def test_split_sql_statements_handles_escaped_quotes(self):
        database_module = load_database_module()
        sql_text = "INSERT INTO t VALUES ('it''s ok;');\nINSERT INTO t VALUES (\"a\"\"b;c\");"

        statements = database_module.split_sql_statements(sql_text)

        self.assertEqual(
            statements,
            [
                "INSERT INTO t VALUES ('it''s ok;')",
                'INSERT INTO t VALUES (\"a\"\"b;c\")',
            ],
        )


if __name__ == '__main__':
    unittest.main()
