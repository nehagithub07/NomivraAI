from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore"
    )

    nomvira_internal_api_key: SecretStr = SecretStr("")
    frontend_origin: str = "http://localhost:3000"
    open_meteo_geocoding_url: AnyHttpUrl = AnyHttpUrl("https://geocoding-api.open-meteo.com/v1")
    overpass_api_url: AnyHttpUrl = AnyHttpUrl("https://overpass-api.de/api/interpreter")
    provider_user_agent: str = Field(default="NomviraAI/0.1", min_length=5, max_length=200)
    default_poi_radius_meters: int = Field(default=10000, ge=100, le=20000)
    max_poi_radius_meters: int = Field(default=20000, ge=100, le=20000)
    app_env: Literal["development", "test", "production"] = "production"
    accommodation_provider: Literal["stayapi", "fixture"] = "stayapi"
    allow_demo_accommodations: bool = False
    stayapi_api_key: SecretStr = SecretStr("")
    stayapi_base_url: AnyHttpUrl = AnyHttpUrl("https://api.stayapi.com")
    accommodation_cache_ttl_seconds: int = Field(default=900, ge=60, le=1800)
    accommodation_cache_max_entries: int = Field(default=128, ge=1, le=256)
    food_provider: Literal["geoapify", "fixture"] = "geoapify"
    geoapify_api_key: SecretStr = SecretStr("")
    geoapify_base_url: AnyHttpUrl = AnyHttpUrl("https://api.geoapify.com")
    default_food_radius_meters: int = Field(default=5000, ge=100, le=15000)
    food_cache_ttl_seconds: int = Field(default=900, ge=60, le=1800)
    food_cache_max_entries: int = Field(default=128, ge=1, le=256)
    llm_provider: Literal["gemini", "fixture"] = "gemini"
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = Field(default="gemini-3.8-flash", pattern=r"^[a-zA-Z0-9._-]{1,100}$")

    @model_validator(mode="after")
    def valid_radius(self):
        if self.default_poi_radius_meters > self.max_poi_radius_meters:
            raise ValueError("Default POI radius exceeds configured maximum")
        if self.stayapi_base_url.scheme != "https":
            raise ValueError("StayAPI requires HTTPS")
        if (
            self.geoapify_base_url.scheme != "https"
            or self.geoapify_base_url.username
            or self.geoapify_base_url.password
        ):
            raise ValueError("Geoapify requires HTTPS without embedded credentials")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
