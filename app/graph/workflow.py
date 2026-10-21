from typing import Any

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

try:
    from langgraph.checkpoint.memory import MemorySaver
except ImportError:  # Older/newer LangGraph versions expose this as InMemorySaver.
    from langgraph.checkpoint.memory import InMemorySaver as MemorySaver

from app.schemas.csv_row import ProductInput
from app.services.checker import check_violations
from app.services.llm_service import generate_copy_with_metadata
from app.graph.state import ProductState


async def generate_node(state: ProductState) -> dict[str, Any]:
    raw_data = state["raw_data"]
    product = raw_data if isinstance(raw_data, ProductInput) else ProductInput.model_validate(raw_data)
    result = await generate_copy_with_metadata(product)
    return {
        "item_code": product.product_id,
        "generated_copy": result.copy,
        "model_source": result.model_source,
        "model_retry_count": state.get("model_retry_count", 0) + result.retry_count,
        "generation_status": result.status,
        "generation_error": result.error_log,
        "review_status": "fallback_draft" if result.status == "FALLBACK_DRAFT" else "generated",
    }


def check_node(state: ProductState) -> dict[str, Any]:
    violations = check_violations(state["generated_copy"])
    retry_count = state.get("retry_count", 0)
    if violations and retry_count < 2:
        retry_count += 1
    return {
        "violations": violations,
        "retry_count": retry_count,
        "review_status": "retrying" if violations and retry_count < 2 else "pending_review",
    }


def human_review_node(state: ProductState) -> dict[str, Any]:
    """Pause for a review decision and apply an optional edited copy."""
    decision = interrupt({"item_code": state["item_code"], "review_status": "pending_review"})
    updates: dict[str, Any] = {"review_status": "APPROVED"}
    if decision.get("generated_copy") is not None:
        updates["generated_copy"] = decision["generated_copy"]
    return updates


def route_after_check(state: ProductState) -> str:
    if state.get("violations") and state.get("retry_count", 0) < 2:
        return "generate_node"
    return "human_review_node"


def build_workflow():
    builder = StateGraph(ProductState)
    builder.add_node("generate_node", generate_node)
    builder.add_node("check_node", check_node)
    builder.add_node("human_review_node", human_review_node)
    builder.add_edge(START, "generate_node")
    builder.add_edge("generate_node", "check_node")
    builder.add_conditional_edges(
        "check_node",
        route_after_check,
        {
            "generate_node": "generate_node",
            "human_review_node": "human_review_node",
        },
    )
    builder.add_edge("human_review_node", END)
    return builder.compile(checkpointer=MemorySaver())


workflow = build_workflow()
