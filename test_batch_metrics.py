"""20-item live Qwen benchmark; writes only to a temporary SQLite database."""

import asyncio
import logging
import tempfile
import time
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import ProductRecord, ProductVersion
from app.schemas.csv_row import ProductInput
from app.services.checker import check_violations
from app.services.llm_service import generate_copy


logging.basicConfig(level=logging.WARNING)

SAMPLES = [
    ("折叠露营椅", "可折叠收纳，适合户外休息", "铝合金支架，牛津布", "1.2kg", "55×55×65cm"),
    ("不锈钢保温杯", "双层真空结构，便于日常携带", "304不锈钢内胆", "320g", "7×7×24cm"),
    ("无线蓝牙耳机", "蓝牙连接，支持触控操作", "ABS外壳，硅胶耳塞", "48g", "60×45×25mm"),
    ("硅胶厨房铲", "耐热硅胶铲面，适合翻炒", "食品接触级硅胶，榉木手柄", "120g", "32×8×4cm"),
    ("桌面收纳盒", "分格收纳文具与小物件", "PP塑料", "260g", "24×16×10cm"),
    ("棉麻抱枕套", "棉麻面料，适配常见抱枕芯", "棉麻混纺", "180g", "45×45cm"),
    ("陶瓷咖啡杯", "杯口圆润，适合日常饮用", "高温陶瓷", "310g", "口径8.5×高9cm"),
    ("瑜伽防滑垫", "双面纹理，提供练习时的接触支撑", "TPE材质", "850g", "183×61×0.6cm"),
    ("便携折叠雨伞", "折叠收纳，手动开合", "涤纶伞布，金属伞骨", "350g", "折叠长28cm"),
    ("宠物慢食碗", "凸起分区，帮助放慢进食节奏", "食品接触级PP", "210g", "直径20×高4cm"),
    ("儿童绘画套装", "包含多色画笔与画纸", "木杆画笔，纸质画纸", "420g", "包装30×22×4cm"),
    ("LED书桌台灯", "三档亮度调节，USB供电", "铝合金灯臂，ABS底座", "620g", "灯高38cm"),
    ("旅行洗漱收纳包", "多个分区，便于分类收纳", "防泼水涤纶面料", "190g", "23×16×9cm"),
    ("竹制砧板", "双面可用，适合日常备菜", "天然竹材", "780g", "38×26×1.5cm"),
    ("手机桌面支架", "多角度调节，适配桌面观看", "铝合金支架，硅胶防滑垫", "165g", "底座10×8cm"),
    ("真空压缩收纳袋", "排出袋内空气，节省衣物收纳空间", "PA与PE复合膜", "90g", "70×50cm"),
    ("玻璃调味罐", "透明罐身，方便查看余量", "高硼硅玻璃，PP盖", "240g", "容量300ml"),
    ("户外保温午餐袋", "拉链开合，适合携带餐盒", "牛津布外层，铝膜内衬", "280g", "25×18×20cm"),
    ("记忆棉腰靠垫", "贴合腰背曲线，适合座椅使用", "聚氨酯记忆棉，网布外套", "540g", "40×35×12cm"),
    ("不粘煎锅", "平底锅身，适合煎制食材", "铝合金锅体，不粘涂层", "980g", "直径26cm"),
]


def make_product(index: int, sample: tuple[str, str, str, str, str]) -> ProductInput:
    name, features, material, weight, dimensions = sample
    return ProductInput.model_validate(
        {
            "产品编号": f"BENCH-{index:03d}",
            "产品名称": name,
            "产品特性": features,
            "产品特性和材质": material,
            "产品价格": str(39 + index * 7),
            "产品的重量": weight,
            "产品的尺寸": dimensions,
        }
    )


def _copy_text(data: dict[str, Any]) -> str:
    return "\n".join(
        [str(data.get("title", "")), *map(str, data.get("bullet_points", [])),
         str(data.get("description", "")), *map(str, data.get("keywords", []))]
    )


async def main() -> None:
    products = [make_product(index, sample) for index, sample in enumerate(SAMPLES, 1)]
    semaphore = asyncio.Semaphore(2)
    records: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="ecommerce-benchmark-") as temp_dir:
        db_path = Path(temp_dir) / "benchmark.sqlite3"
        engine = create_async_engine(f"sqlite+aiosqlite:///{db_path.as_posix()}")
        session_factory = async_sessionmaker(engine, expire_on_commit=False)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)

        async def process_one(product: ProductInput) -> None:
            started = time.perf_counter()
            result: dict[str, Any] = {"item_code": product.product_id, "copy": None, "error": None}
            async with semaphore:
                try:
                    copy = await generate_copy(product)
                    violations = check_violations(copy)
                    async with session_factory() as session:
                        record = await session.get(ProductRecord, product.product_id)
                        if record is None:
                            record = ProductRecord(product_id=product.product_id)
                            session.add(record)
                        record.status = "质检待审核" if violations else "待审核"
                        record.retry_count = 0
                        record.error_log = None
                        session.add_all(
                            [
                                ProductVersion(
                                    product_id=product.product_id,
                                    version_type="RAW",
                                    copy_json=product.model_dump(by_alias=True),
                                ),
                                ProductVersion(
                                    product_id=product.product_id,
                                    version_type="AI_GENERATED",
                                    copy_json=copy.model_dump(),
                                ),
                            ]
                        )
                        await session.commit()
                    result.update(copy=copy, violations=violations, status="ok")
                except Exception as exc:
                    result.update(error=f"{type(exc).__name__}: {exc}", status="failed")
                    try:
                        async with session_factory() as session:
                            record = await session.get(ProductRecord, product.product_id)
                            if record is None:
                                record = ProductRecord(product_id=product.product_id)
                                session.add(record)
                            record.status = "失败"
                            record.error_log = result["error"]
                            await session.commit()
                    except Exception as db_exc:
                        result["error"] += f"; benchmark DB write failed: {db_exc}"
            result["seconds"] = time.perf_counter() - started
            records.append(result)

        await asyncio.gather(*(process_one(product) for product in products))
        async with session_factory() as session:
            saved_versions = (await session.scalars(select(ProductVersion))).all()
        await engine.dispose()

    by_code = {record["item_code"]: record for record in records}
    valid = [record for record in records if record.get("copy") is not None]
    required_fields = ("product_name", "product_features", "material_and_features", "price", "weight", "dimensions")
    covered = 0
    expected = 0
    for product in products:
        result = by_code[product.product_id]
        if result.get("copy") is None:
            continue
        text = _copy_text(result["copy"].model_dump())
        source = product.model_dump()
        for field in required_fields:
            expected += 1
            value = str(source[field]).strip()
            covered += bool(value and value in text)

    # Each sample omits brand information; count detection only when the model explicitly flags it.
    unverified_detected = sum(
        any("品牌" in field for field in record["copy"].unverified_fields)
        for record in valid
    )
    violations_found = sum(bool(record.get("violations")) for record in valid)
    failure_count = len(records) - len(valid)
    average_seconds = sum(record["seconds"] for record in records) / len(records)

    print("\n20 条商品文案评测报告（独立临时 SQLite）")
    print("=" * 68)
    print(f"{'指标':<30} {'结果':>16} {'口径'}")
    print("-" * 68)
    print(f"{'合法结构成功率 / 准确率':<30} {len(valid) / len(products):>15.1%}  合法 GeneratedCopy 数 / 20")
    print(f"{'关键规格字段召回率':<30} {covered / expected if expected else 0:>15.1%}  原文规格精确出现在文案中的字段数 / 有效商品规格字段数")
    print(f"{'单条平均生成入库耗时':<30} {average_seconds:>14.2f}s  包含生成、质检和独立会话提交")
    print(f"{'质检违规触发商品数':<30} {violations_found:>16}  已生成文案中被 checker 标记的商品数")
    print(f"{'待核实品牌信息检出率':<30} {unverified_detected / len(valid) if valid else 0:>15.1%}  明确缺少品牌的商品中标记“品牌”的比例")
    print(f"{'数据库写入版本数':<30} {len(saved_versions):>16}  RAW 与 AI_GENERATED 版本")
    print(f"{'失败商品数':<30} {failure_count:>16}  失败项不阻断其他商品")
    print("\n逐条结果")
    print("-" * 68)
    for record in sorted(records, key=lambda item: item["item_code"]):
        if record.get("copy"):
            print(
                f"{record['item_code']} | {record['status']} | {record['seconds']:.2f}s | "
                f"违规 {len(record['violations'])} | 待核实 {len(record['copy'].unverified_fields)} | "
                f"{record['copy'].title}"
            )
        else:
            print(f"{record['item_code']} | 失败 | {record['seconds']:.2f}s | {record['error']}")


if __name__ == "__main__":
    asyncio.run(main())
