import json
import traceback
from urllib.error import HTTPError
from urllib.request import Request, urlopen


URL = "http://127.0.0.1:8000/api/products/generate"
PRODUCT = {
    "产品编号": "TEST-AUDIO-001",
    "产品名称": "蓝牙无线耳机",
    "产品特性": "支持蓝牙连接，配备主动降噪功能",
    "产品特性和材质": "ABS 外壳，硅胶耳塞",
    "产品价格": "299",
    "产品的重量": "48g",
    "产品的尺寸": "60 x 45 x 25 mm",
}


def main() -> None:
    body = json.dumps(PRODUCT, ensure_ascii=False).encode("utf-8")
    request = Request(
        URL,
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=90) as response:
            result = response.read().decode("utf-8")
            print(f"接口状态码: {response.status}")
            print(json.dumps(json.loads(result), ensure_ascii=False, indent=2))
    except HTTPError as exc:
        print(f"接口状态码: {exc.code}")
        print("接口错误详情:")
        print(exc.read().decode("utf-8", errors="replace"))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("请求失败，详细信息如下:")
        traceback.print_exc()
