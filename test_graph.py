import asyncio
import uuid

from app.graph.state import ProductState
from app.graph.workflow import workflow


INITIAL_PRODUCT = {
    "产品编号": "GRAPH-TEST-001",
    "产品名称": "蓝牙无线耳机",
    "产品特性": "支持蓝牙连接和主动降噪",
    "产品特性和材质": "ABS 外壳，硅胶耳塞",
    "产品价格": "299",
    "产品的重量": "48g",
    "产品的尺寸": "60 x 45 x 25 mm",
}


async def main() -> None:
    config = {"configurable": {"thread_id": f"graph-test-{uuid.uuid4().hex}"}}
    initial_state: ProductState = {
        "item_code": "GRAPH-TEST-001",
        "raw_data": INITIAL_PRODUCT,
        "generated_copy": None,
        "violations": [],
        "retry_count": 0,
        "review_status": "pending",
    }

    result = await workflow.ainvoke(initial_state, config=config)
    snapshot = await workflow.aget_state(config)
    next_nodes = tuple(snapshot.next or ())
    print("当前状态:", result)
    print("下一节点:", next_nodes)
    if next_nodes != ("human_review_node",):
        raise AssertionError(f"流程未在 human_review_node 前暂停：{next_nodes}")
    print("验证通过：流程已在 human_review_node 前自动暂停。")


if __name__ == "__main__":
    asyncio.run(main())
