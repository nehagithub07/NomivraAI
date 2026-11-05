from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import (
    AnyHttpUrl,
    Field,
    SecretStr,
    model_validator,
)
from pydantic_settings import (
    BaseSettings,
    SettingsConfigDict,
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # =====================================================
    # Application
    # =====================================================

    app_env: Literal[
        "development",
        "test",
        "production",
    ] = "production"

    frontend_origin: str = "http://localhost:3000"

    nomvira_internal_api_key: SecretStr = SecretStr("")

    provider_user_agent: str = Field(
        default="NomivraAI/0.1",
        min_length=5,
        max_length=200,
    )

    # =====================================================
    # Destination / Geocoding
    # =====================================================

    open_meteo_geocoding_url: AnyHttpUrl = AnyHttpUrl("https://geocoding-api.open-meteo.com/v1")

    # =====================================================
    # Places / Overpass
    # =====================================================
    #
    # Ordered provider strategy:
    #
    # 1. Private.coffee
    # 2. VK Maps
    # 3. overpass-api.de
    #
    # The provider implementation performs failover.
    # =====================================================

    overpass_api_url: AnyHttpUrl = AnyHttpUrl("https://overpass.private.coffee/api/interpreter")

    overpass_fallback_url: AnyHttpUrl | None = AnyHttpUrl(
        "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
    )

    overpass_last_resort_url: AnyHttpUrl | None = AnyHttpUrl(
        "https://overpass-api.de/api/interpreter"
    )

    default_poi_radius_meters: int = Field(
        default=30_000,
        ge=100,
        le=30_000,
    )

    max_poi_radius_meters: int = Field(
        default=30_000,
        ge=100,
        le=30_000,
    )

    # =====================================================
    # Hotels / StayAPI
    # =====================================================

    accommodation_provider: Literal[
        "stayapi",
        "fixture",
    ] = "stayapi"

    allow_demo_accommodations: bool = False

    stayapi_api_key: SecretStr = SecretStr("")

    stayapi_base_url: AnyHttpUrl = AnyHttpUrl("https://api.stayapi.com")

    accommodation_cache_ttl_seconds: int = Field(
        default=900,
        ge=60,
        le=1800,
    )

    accommodation_cache_max_entries: int = Field(
        default=128,
        ge=1,
        le=256,
    )

    # =====================================================
    # Food
    # =====================================================

    food_provider: Literal[
        "google_maps",
        "geoapify",
        "fixture",
    ] = "google_maps"

    geoapify_api_key: SecretStr = SecretStr("")

    geoapify_base_url: AnyHttpUrl = AnyHttpUrl("https://api.geoapify.com")

    # Updated from 5 km → 10 km.
    #
    # We want city-level food recommendations,
    # not only restaurants immediately around the
    # destination center.
    default_food_radius_meters: int = Field(
        default=10_000,
        ge=100,
        le=15_000,
    )

    food_cache_ttl_seconds: int = Field(
        default=900,
        ge=60,
        le=1800,
    )

    food_cache_max_entries: int = Field(
        default=128,
        ge=1,
        le=256,
    )

    # =====================================================
    # LLM / Gemini
    # =====================================================

    llm_provider: Literal[
        "gemini",
        "fixture",
    ] = "gemini"

    gemini_api_key: SecretStr = SecretStr("")

    # Used by the AI Travel Companion.
    gemini_model: str = Field(
        default="gemini-3.8-flash",
        pattern=r"^[a-zA-Z0-9._-]{1,100}$",
    )

    # Separate model for structured itinerary
    # generation.
    gemini_itinerary_model: str = Field(
        default="gemini-3.6-flash",
        pattern=r"^[a-zA-Z0-9._-]{1,100}$",
    )

    # =====================================================
    # Weather
    # =====================================================

    weather_provider: Literal["open_meteo",] = "open_meteo"

    open_meteo_forecast_url: AnyHttpUrl = AnyHttpUrl("https://api.open-meteo.com/v1")

    # =====================================================
    # Routing
    # =====================================================

    routing_provider: Literal["openrouteservice",] = "openrouteservice"

    openrouteservice_api_key: SecretStr = SecretStr("")

    openrouteservice_base_url: AnyHttpUrl = AnyHttpUrl("https://api.heigit.org/openrouteservice/v2")

    routing_cache_ttl_seconds: int = Field(
        default=21_600,
        ge=60,
        le=86_400,
    )

    routing_cache_max_entries: int = Field(
        default=256,
        ge=1,
        le=1024,
    )

    # =====================================================
    # Validation
    # =====================================================

    @model_validator(mode="after")
    def validate_settings(
        self,
    ):
        # ---------------------------------------------
        # POI radius
        # ---------------------------------------------

        if self.default_poi_radius_meters > self.max_poi_radius_meters:
            raise ValueError("Default POI radius exceeds configured maximum.")

        # ---------------------------------------------
        # Open-Meteo geocoding
        # ---------------------------------------------

        self._validate_safe_https_url(
            self.open_meteo_geocoding_url,
            "Open-Meteo geocoding",
        )

        # ---------------------------------------------
        # Open-Meteo forecast
        # ---------------------------------------------

        self._validate_safe_https_url(
            self.open_meteo_forecast_url,
            "Open-Meteo forecast",
        )

        # ---------------------------------------------
        # Overpass endpoints
        # ---------------------------------------------

        for endpoint in (
            self.overpass_api_url,
            self.overpass_fallback_url,
            self.overpass_last_resort_url,
        ):
            if endpoint is None:
                continue

            self._validate_safe_https_url(
                endpoint,
                "Overpass",
            )

        # ---------------------------------------------
        # StayAPI
        # ---------------------------------------------

        self._validate_safe_https_url(
            self.stayapi_base_url,
            "StayAPI",
        )

        # ---------------------------------------------
        # Geoapify
        # ---------------------------------------------

        self._validate_safe_https_url(
            self.geoapify_base_url,
            "Geoapify",
        )

        # ---------------------------------------------
        # openrouteservice / HeiGIT
        # ---------------------------------------------

        self._validate_safe_https_url(
            self.openrouteservice_base_url,
            "openrouteservice",
        )

        # ---------------------------------------------
        # Production safety
        # ---------------------------------------------

        # Individual services reject fixture requests in production; keeping
        # validation there also lets deployment checks report the variable name.

        return self

    @staticmethod
    def _validate_safe_https_url(
        url: AnyHttpUrl,
        provider_name: str,
    ) -> None:
        if url.scheme != "https" or url.username or url.password or url.query or url.fragment:
            raise ValueError(
                (
                    f"{provider_name} requires HTTPS "
                    "without embedded credentials, "
                    "query parameters, or fragments."
                )
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
