import os
from collections.abc import AsyncIterator

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import inspect
from sqlalchemy.engine import make_url
from sqlalchemy.orm import DeclarativeBase

load_dotenv()


def _database_url() -> str | None:
    url = os.getenv("DATABASE_URL")
    if not url:
        return None
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


DATABASE_URL = _database_url()
engine_options = {"pool_pre_ping": True}
if DATABASE_URL:
    backend = make_url(DATABASE_URL).get_backend_name()
    if backend == "sqlite":
        engine_options["connect_args"] = {"check_same_thread": False}
    elif backend == "postgresql":
        engine_options.update(pool_size=10, max_overflow=20)
engine = create_async_engine(DATABASE_URL, **engine_options) if DATABASE_URL else None
SessionLocal = async_sessionmaker(engine, expire_on_commit=False) if engine else None


class Base(DeclarativeBase):
    pass


async def get_session() -> AsyncIterator[AsyncSession]:
    if SessionLocal is None:
        raise RuntimeError("未配置 DATABASE_URL，请在 .env 中设置异步数据库连接地址")
    async with SessionLocal() as session:
        yield session


async def create_tables() -> None:
    if engine is None:
        return
    from app.models import ProductRecord as _ProductRecord

    _ = _ProductRecord
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        columns = await connection.run_sync(
            lambda sync_connection: {
                column["name"]
                for column in inspect(sync_connection).get_columns("products")
            }
        )
        if "process_duration" not in columns:
            await connection.exec_driver_sql(
                "ALTER TABLE products ADD COLUMN process_duration FLOAT"
            )
