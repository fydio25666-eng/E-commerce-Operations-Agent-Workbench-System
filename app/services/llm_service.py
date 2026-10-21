import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from openai import APIStatusError, APIConnectionError, APITimeoutError, AsyncOpenAI, OpenAIError
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_random_exponential,
)

from app.schemas.copy import GeneratedCopy
from app.schemas.csv_row import ProductInput

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(ENV_FILE, override=True)
logger = logging.getLogger(__name__)
REQUEST_TIMEOUT_SECONDS = 45.0
CONNECT_TIMEOUT_SECONDS = 15.0
DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"


@dataclass(frozen=True)
class GenerationResult:
    copy: GeneratedCopy
    status: str
    model_source: str
    retry_count: int
    error_log: str | None = None


def _response_content(response: Any) -> str:
    if isinstance(response, str):
        return response
    choices = (
        response.get("choices")
        if isinstance(response, dict)
        else response.choices if hasattr(response, "choices") else None
    )
    if not choices:
        raise ValueError("模型响应中没有 choices 或文案内容")
    choice = choices[0]
    message = choice.get("message") if isinstance(choice, dict) else getattr(choice, "message", None)
    content = message.get("content") if isinstance(message, dict) else getattr(message, "content", None)
    if not isinstance(content, str) or not content:
        raise ValueError("模型响应中没有有效的文案内容")
    return content


def _extract_json(content: str) -> str:
    cleaned = re.sub(r"```\s*(?:json)?", "", content, flags=re.IGNORECASE).strip()
    match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    if not match:
        raise ValueError("模型返回内容中没有找到 JSON 对象")
    return match.group(0)


def _retryable_model_error(exc: BaseException) -> bool:
    return isinstance(exc, (APITimeoutError, APIConnectionError)) or (
        isinstance(exc, APIStatusError) and exc.status_code >= 500
    )


def _client(model: str) -> AsyncOpenAI:
    api_key = os.getenv("QIANWEN_API_KEY")
    if not api_key:
        raise RuntimeError("请在项目根目录 .env 中配置 QIANWEN_API_KEY")
    http_client = httpx.AsyncClient(
        trust_env=False,
        timeout=httpx.Timeout(REQUEST_TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS),
    )
    return AsyncOpenAI(
        api_key=api_key,
        base_url=os.getenv("QIANWEN_BASE_URL") or DEFAULT_BASE_URL,
        timeout=REQUEST_TIMEOUT_SECONDS,
        max_retries=0,
        http_client=http_client,
    )


@retry(
    retry=retry_if_exception(_retryable_model_error),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    stop=stop_after_attempt(3),
    wait=wait_random_exponential(min=2, max=6),
    reraise=True,
)
async def _generate_with_model(
    product: ProductInput, model: str, attempt_log: list[int]
) -> GeneratedCopy:
    attempt_log.append(1)
    client = _client(model)
    try:
        response = await client.chat.completions.create(
            model=model,
            timeout=REQUEST_TIMEOUT_SECONDS,
            max_tokens=800,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你是严谨的电商商品文案编辑。只能使用用户提供的商品资料，不得推测、补造或夸大。"
                        "缺少且相关的消费者关注参数列入 unverified_fields，只写参数名称。严格只返回合法 JSON，"
                        "不输出思考、Markdown 或解释。字段为 title、bullet_points、description、keywords、unverified_fields。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "生成商品文案：标题 30-60 字，恰好 5 条卖点且每条 30-50 字，"
                        "详情描述 120-170 字，恰好 3 个关键词。"
                        "仅输出 JSON 对象。商品资料："
                        + str(product.model_dump(by_alias=True))
                    ),
                },
            ],
        )
        return GeneratedCopy.model_validate_json(_extract_json(_response_content(response)))
    finally:
        await client.close()


def _fit_text(text: str, minimum: int, maximum: int) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > maximum:
        text = text[:maximum]
    if len(text) < minimum:
        suffix = "，具体信息以商品规格为准"
        text = (text + suffix * ((minimum - len(text)) // len(suffix) + 1))[:minimum]
    return text


def _template_fallback(product: ProductInput) -> GeneratedCopy:
    name = product.product_name.strip()
    features = product.product_features.strip()
    material = product.material_and_features.strip()
    specs = [
        ("商品特点", features),
        ("材质信息", material),
        ("商品重量", product.weight.strip()),
        ("商品尺寸", product.dimensions.strip()),
        ("商品价格", product.price.strip()),
    ]
    title = _fit_text(
        f"{name}{features}{material}{product.dimensions}{product.weight}", 30, 60
    )
    bullets = [
        _fit_text(f"{label}：{value}，下单前可结合页面参数核对", 30, 50)
        for label, value in specs
    ]
    details = "；".join(f"{label}为{value}" for label, value in specs)
    description = _fit_text(
        f"{name}的基础信息如下：{details}。文案根据已提供的商品资料整理，未提供的信息不作推断；"
        "购买前请核对商品页面展示的规格、适用情况及其他详细参数。",
        120,
        170,
    )
    keywords = [name, features[:12] or name, material[:12] or name]
    return GeneratedCopy(
        title=title,
        bullet_points=bullets,
        description=description,
        keywords=keywords,
        unverified_fields=["品牌", "保修信息", "认证信息"],
    )


async def generate_copy_with_metadata(product: ProductInput) -> GenerationResult:
    primary_model = os.getenv("QIANWEN_MODEL") or "qwen3.8-flash"
    attempt_log: list[int] = []
    try:
        copy = await _generate_with_model(product, primary_model, attempt_log)
        return GenerationResult(
            copy=copy,
            status="AI_GENERATED",
            model_source="qwen_primary",
            retry_count=max(0, len(attempt_log) - 1),
        )
    except Exception as exc:
        retry_count = max(0, len(attempt_log) - 1)
        logger.warning(
            "商品 %s 主模型调用失败，直接使用模板兜底：%s: %s",
            product.product_id,
            type(exc).__name__,
            exc,
            exc_info=True,
        )
        error_log = f"主模型调用失败，已使用模板兜底：{type(exc).__name__}: {exc}"

    return GenerationResult(
        copy=_template_fallback(product),
        status="FALLBACK_DRAFT",
        model_source="template_fallback",
        retry_count=retry_count,
        error_log=error_log,
    )


async def generate_copy(product: ProductInput) -> GeneratedCopy:
    """Compatibility wrapper for callers that only need the validated copy."""
    return (await generate_copy_with_metadata(product)).copy
