import json
import traceback
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import xlrd


BASE_URL = "http://127.0.0.1:8000"
FIELD_NAMES = [
    "产品编号",
    "产品名称",
    "产品特性",
    "产品特性和材质",
    "产品价格",
    "产品的重量",
    "产品的尺寸",
]


def read_exported_products() -> list[dict[str, str]]:
    request = Request(f"{BASE_URL}/api/export")
    with urlopen(request, timeout=30) as response:
        workbook = xlrd.open_workbook(file_contents=response.read())
    sheet = workbook.sheet_by_index(0)
    return [
        {
            FIELD_NAMES[col]: str(sheet.cell_value(row, col))
            for col in range(min(sheet.ncols, len(FIELD_NAMES)))
        }
        for row in range(1, sheet.nrows)
    ]


def main() -> None:
    source_file = Path(__file__).resolve().parent / "商品表格.xls"
    file_data = source_file.read_bytes()

    previous_products = read_exported_products()

    boundary = f"----CodexUpload{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="商品表格.xls"\r\n'
        "Content-Type: application/vnd.ms-excel\r\n\r\n"
    ).encode("utf-8") + file_data + f"\r\n--{boundary}--\r\n".encode("ascii")
    request = Request(
        f"{BASE_URL}/api/upload",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )

    try:
        with urlopen(request, timeout=60) as response:
            status_code = response.status
            response_text = response.read().decode("utf-8")
    except HTTPError as exc:
        status_code = exc.code
        response_text = exc.read().decode("utf-8", errors="replace")

    print(f"上传接口状态码: {status_code}")
    print("上传接口返回:")
    try:
        print(json.dumps(json.loads(response_text), ensure_ascii=False, indent=2))
    except json.JSONDecodeError:
        print(response_text)

    if not 200 <= status_code < 300:
        return

    products = read_exported_products()
    new_products = products[len(previous_products):]
    print(f"本次清洗入库商品数: {len(new_products)}")
    print("本次清洗入库商品详情:")
    print(json.dumps(new_products, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("上传测试发生错误，详细信息如下:")
        traceback.print_exc()
