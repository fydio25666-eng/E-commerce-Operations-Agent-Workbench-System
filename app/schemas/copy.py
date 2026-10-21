from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class GeneratedCopy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=30, max_length=60, description="商品标题，30 到 60 字")
    bullet_points: list[Annotated[str, Field(min_length=30, max_length=50)]] = Field(
        min_length=5,
        max_length=5,
        description="恰好 5 条商品卖点，每条 30 到 50 个字符",
    )
    description: str = Field(
        min_length=120,
        max_length=170,
        description="商品详情描述，120 到 170 个字符",
    )
    keywords: list[str] = Field(
        min_length=3,
        max_length=3,
        description="恰好 3 个搜索关键词",
    )
    unverified_fields: list[str] = Field(
        description="商品资料中未提供、需要核实的参数名称，不得填写猜测值"
    )
