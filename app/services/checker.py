import re
from pathlib import Path
from typing import Any

RULES_PATH = Path(__file__).resolve().parents[2] / "data" / "manual" / "ecommerce_rules.md"
REQUIRED_BANNED_TERMS = ("国家级", "第一", "顶级", "100%有效", "同款", "平替")
RULE_TERM_SECTIONS = (
    "一级绝对化禁用词库",
    "二级夸大效果禁用词库",
    "严禁引用的高仿词汇",
)


def _read_rules() -> tuple[int, int, list[str]]:
    rules_text = RULES_PATH.read_text(encoding="utf-8")
    length_match = re.search(r"(\d+)\s*到\s*(\d+)\s*个中文字符", rules_text)
    if not length_match:
        raise ValueError("规则手册中未找到标题字数范围")
    min_length, max_length = map(int, length_match.groups())

    banned_terms = set(REQUIRED_BANNED_TERMS)
    for section in RULE_TERM_SECTIONS:
        match = re.search(rf"{re.escape(section)}：([^。\n]+)", rules_text)
        if not match:
            continue
        for raw_term in re.split(r"[、，,；;]", match.group(1)):
            term = re.split(r"[（(]", raw_term.strip(), maxsplit=1)[0]
            term = term.replace("XX大牌", "").replace("XX", "").strip()
            if term:
                banned_terms.add(term)
    return min_length, max_length, sorted(banned_terms, key=len, reverse=True)


def check_violations(copy: Any) -> list[str]:
    if hasattr(copy, "model_dump"):
        data = copy.model_dump()
    elif isinstance(copy, dict):
        data = copy
    else:
        raise TypeError("copy 必须是 Pydantic 模型或字典")

    min_length, max_length, banned_terms = _read_rules()
    title = str(data.get("title", ""))
    violations: list[str] = []
    if not min_length <= len(title) <= max_length:
        violations.append(
            f"标题长度为 {len(title)} 字，不符合 {min_length}-{max_length} 字要求"
        )

    fields = {
        "title": title,
        "bullet_points": "\n".join(map(str, data.get("bullet_points", []))),
        "description": str(data.get("description", "")),
        "keywords": " ".join(map(str, data.get("keywords", []))),
        "unverified_fields": " ".join(map(str, data.get("unverified_fields", []))),
    }
    for field_name, content in fields.items():
        for term in banned_terms:
            if term and term in content:
                violations.append(f"字段 {field_name} 包含违禁词“{term}”")
    return violations
