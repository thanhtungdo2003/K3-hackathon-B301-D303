"""Khởi tạo SQLAlchemy engine + session factory."""
from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


class Base(DeclarativeBase):
    pass


# Cột thêm sau khi đã có DB chạy thật. `create_all` chỉ tạo bảng mới, không sửa
# bảng cũ, nên phải tự thêm — dự án không dùng Alembic.
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("slides", "page_image", "VARCHAR(255) NOT NULL DEFAULT ''"),
]


def ensure_added_columns() -> None:
    """Thêm các cột mới vào DB đã tồn tại. Chạy được nhiều lần, không phá dữ liệu."""
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    with engine.begin() as conn:
        for table, column, ddl in _ADDED_COLUMNS:
            if table not in tables:
                continue
            existing = {c["name"] for c in inspector.get_columns(table)}
            if column in existing:
                continue
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
