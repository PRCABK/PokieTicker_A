import pymysql
from backend.config import settings, PROJECT_ROOT


def get_conn() -> pymysql.connections.Connection:
    conn = pymysql.connect(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        database=settings.mysql_database,
        charset=settings.mysql_charset,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    return conn


def init_db():
    """执行 init.sql 初始化数据库（如果表不存在）。"""
    sql_path = PROJECT_ROOT / "init.sql"
    if not sql_path.exists():
        print(f"init.sql not found at {sql_path}")
        return

    # 先连接无数据库，确保数据库存在
    conn = pymysql.connect(
        host=settings.mysql_host,
        port=settings.mysql_port,
        user=settings.mysql_user,
        password=settings.mysql_password,
        charset=settings.mysql_charset,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            sql_text = sql_path.read_text(encoding="utf-8")
            # 按语句分割执行
            for statement in sql_text.split(";"):
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

    print(f"Database '{settings.mysql_database}' initialized successfully.")


if __name__ == "__main__":
    init_db()
