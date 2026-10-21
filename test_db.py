import asyncio
import json
import uuid

from sqlalchemy import select

from app.database import SessionLocal, create_tables
from app.models import ProductRecord, ProductVersion


async def main() -> None:
    if SessionLocal is None:
        raise RuntimeError("请先在 .env 中配置 DATABASE_URL")

    await create_tables()
    batch_id = uuid.uuid4().hex[:10]
    product_ids = [f"DBTEST-{batch_id}-{index}" for index in range(1, 4)]
    async with SessionLocal() as session:
        for product_id in product_ids:
            session.add(ProductRecord(product_id=product_id, status="待审核", retry_count=0))
            for version_type, copy_json in (
                ("RAW", {"产品编号": product_id, "产品名称": "数据库测试商品"}),
                ("AI_GENERATED", {"title": "AI 生成测试文案", "keywords": ["测试", "商品", "数据库"]}),
                ("HUMAN_MODIFIED", {"title": "人工修改测试文案", "keywords": ["测试", "商品", "数据库"]}),
            ):
                session.add(
                    ProductVersion(
                        product_id=product_id,
                        version_type=version_type,
                        copy_json=copy_json,
                    )
                )
        await session.commit()

    async with SessionLocal() as session:
        products = (
            await session.scalars(
                select(ProductRecord).where(ProductRecord.product_id.in_(product_ids))
            )
        ).all()
        versions = (
            await session.scalars(
                select(ProductVersion)
                .where(ProductVersion.product_id.in_(product_ids))
                .order_by(ProductVersion.product_id, ProductVersion.id)
            )
        ).all()

    assert len(products) == len(product_ids), "批量商品插入数量不正确"
    expected_versions = len(product_ids) * 3
    assert len(versions) == expected_versions, "商品多版本查询数量不正确"
    for product_id in product_ids:
        chain = [version for version in versions if version.product_id == product_id]
        assert [version.version_type for version in chain] == [
            "RAW",
            "AI_GENERATED",
            "HUMAN_MODIFIED",
        ], f"商品 {product_id} 的版本链不正确"
        assert isinstance(chain[0].copy_json, dict), "JSON 字段未反序列化为字典"
    print(f"批量插入商品数: {len(products)}")
    print(f"多版本记录数: {len(versions)}")
    print("查询到的版本链:")
    print(
        json.dumps(
            [
                {
                    "product_id": version.product_id,
                    "version_type": version.version_type,
                    "copy_json": version.copy_json,
                    "created_at": version.created_at.isoformat(),
                }
                for version in versions
            ],
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    asyncio.run(main())
