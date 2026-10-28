from functools import lru_cache
from pathlib import Path

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

    @model_validator(mode="after")
    def valid_radius(self):
        if self.default_poi_radius_meters > self.max_poi_radius_meters:
            raise ValueError("Default POI radius exceeds configured maximum")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
