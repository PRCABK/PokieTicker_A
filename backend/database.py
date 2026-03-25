import logging

import pymysql
from backend.config import settings, PROJECT_ROOT

logger = logging.getLogger(__name__)


def get_conn(database: str | None = None) -> pymysql.connections.Connection:
    target_database = settings.mysql_database if database is None else database
    connect_kwargs = dict(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        charset=settings.mysql_charset,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    if target_database:
        connect_kwargs["database"] = target_database
    return pymysql.connect(**connect_kwargs)


def check_db_connection():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 AS ok")
            cur.fetchone()
    finally:
        conn.close()


def split_sql_statements(sql_text: str) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []

    in_single_quote = False
    in_double_quote = False
    in_backtick = False
    in_line_comment = False
    in_block_comment = False

    i = 0
    while i < len(sql_text):
        ch = sql_text[i]
        nxt = sql_text[i + 1] if i + 1 < len(sql_text) else ""
        prev = sql_text[i - 1] if i > 0 else ""

        if in_line_comment:
            if ch == "\n":
                in_line_comment = False
                buffer.append(ch)
            i += 1
            continue

        if in_block_comment:
            if ch == "*" and nxt == "/":
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue

        if in_single_quote:
            buffer.append(ch)
            if ch == "'" and nxt == "'":
                buffer.append(nxt)
                i += 2
                continue
            if ch == "'":
                in_single_quote = False
            i += 1
            continue

        if in_double_quote:
            buffer.append(ch)
            if ch == '"' and nxt == '"':
                buffer.append(nxt)
                i += 2
                continue
            if ch == '"':
                in_double_quote = False
            i += 1
            continue

        if in_backtick:
            buffer.append(ch)
            if ch == "`" and nxt == "`":
                buffer.append(nxt)
                i += 2
                continue
            if ch == "`":
                in_backtick = False
            i += 1
            continue

        if ch == "#" or (ch == "-" and nxt == "-" and (not prev or prev.isspace())):
            in_line_comment = True
            i += 1 if ch == "#" else 2
            continue

        if ch == "/" and nxt == "*":
            in_block_comment = True
            i += 2
            continue

        if ch == "'":
            in_single_quote = True
            buffer.append(ch)
            i += 1
            continue

        if ch == '"':
            in_double_quote = True
            buffer.append(ch)
            i += 1
            continue

        if ch == "`":
            in_backtick = True
            buffer.append(ch)
            i += 1
            continue

        if ch == ";":
            statement = "".join(buffer).strip()
            if statement:
                statements.append(statement)
            buffer = []
            i += 1
            continue

        buffer.append(ch)
        i += 1

    statement = "".join(buffer).strip()
    if statement:
        statements.append(statement)
    return statements


def init_db():
    """执行 init.sql 初始化数据库（如果表不存在）。"""
    errors = settings.validate_for_startup()
    if errors:
        raise RuntimeError("Cannot initialize database:\n- " + "\n- ".join(errors))

    sql_path = PROJECT_ROOT / "init.sql"
    if not sql_path.exists():
        raise FileNotFoundError(f"init.sql not found at {sql_path}")

    # 先连接无数据库，确保数据库存在
    conn = get_conn(database="")
    try:
        with conn.cursor() as cur:
            sql_text = sql_path.read_text(encoding="utf-8")
            for statement in split_sql_statements(sql_text):
                stmt = statement.strip()
                if stmt:
                    try:
                        cur.execute(stmt)
                    except pymysql.err.OperationalError as e:
                        # 忽略"已存在"类错误（如重复索引、重复表）
                        if e.args[0] in (1061, 1050):
                            pass
                        else:
                            raise
        conn.commit()
    finally:
        conn.close()

    logger.info("Database '%s' initialized successfully.", settings.mysql_database)


if __name__ == "__main__":
    init_db()
