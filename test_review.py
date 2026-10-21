import json
import traceback
from urllib.error import HTTPError
from urllib.request import Request, urlopen


BASE_URL = "http://127.0.0.1:8000/api/products"
PRODUCT = {
    "产品编号": "REVIEW-TEST-001",
    "产品名称": "蓝牙无线耳机",
    "产品特性": "支持蓝牙连接和主动降噪",
    "产品特性和材质": "ABS 外壳，硅胶耳塞",
    "产品价格": "299",
    "产品的重量": "48g",
    "产品的尺寸": "60 x 45 x 25 mm",
}


def post_json(url: str, payload: dict) -> dict:
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urlopen(request, timeout=120) as response:
        body = response.read().decode("utf-8")
        print(f"接口状态码: {response.status}")
        return json.loads(body)


def main() -> None:
    process_result = post_json(f"{BASE_URL}/process", PRODUCT)
    thread_id = process_result["thread_id"]
    print("审核前结果:")
    print(json.dumps(process_result, ensure_ascii=False, indent=2))

    final_result = post_json(
        f"{BASE_URL}/{thread_id}/review",
        {"action": "approve"},
    )
    print("恢复后的最终结果:")
    print(json.dumps(final_result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except HTTPError as exc:
        print(f"接口状态码: {exc.code}")
        print("接口错误详情:")
        print(exc.read().decode("utf-8", errors="replace"))
    except Exception:
        print("请求失败，详细信息如下:")
        traceback.print_exc()
