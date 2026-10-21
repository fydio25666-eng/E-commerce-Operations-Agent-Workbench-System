from pydantic import BaseModel, ConfigDict, Field


class ProductInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    product_id: str = Field(alias="产品编号", min_length=1)
    product_name: str = Field(alias="产品名称", min_length=1)
    product_features: str = Field(alias="产品特性", min_length=1)
    material_and_features: str = Field(alias="产品特性和材质", min_length=1)
    price: str = Field(alias="产品价格", min_length=1)
    weight: str = Field(alias="产品的重量", min_length=1)
    dimensions: str = Field(alias="产品的尺寸", min_length=1)
