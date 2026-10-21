from typing import Any, TypedDict


class ProductState(TypedDict):
    item_code: str
    raw_data: Any
    generated_copy: Any
    violations: list[str]
    retry_count: int
    review_status: str
    model_source: str
    model_retry_count: int
    generation_status: str
    generation_error: str | None
