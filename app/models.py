from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ProductRecord(Base):
    __tablename__ = "products"

    product_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="待审核")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_log: Mapped[str | None] = mapped_column(Text, nullable=True)
    process_duration: Mapped[float | None] = mapped_column(Float, nullable=True)
    versions: Mapped[list["ProductVersion"]] = relationship(
        back_populates="product", cascade="all, delete-orphan"
    )


class ProductVersion(Base):
    __tablename__ = "product_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.product_id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_type: Mapped[str] = mapped_column(String(32), nullable=False)
    copy_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    product: Mapped[ProductRecord] = relationship(back_populates="versions")
