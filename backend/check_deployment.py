"""Check production configuration without printing credentials or contacting providers."""

from urllib.parse import urlsplit

from pydantic import ValidationError

from app.core.config import Settings


def deployment_errors(settings: Settings) -> list[str]:
    errors = []
    if settings.app_env != "production":
        errors.append("APP_ENV must be production.")
    for name in ("nomvira_internal_api_key", "stayapi_api_key", "geoapify_api_key"):
        value = getattr(settings, name).get_secret_value()
        minimum = 32 if name == "nomvira_internal_api_key" else 1
        if (
            len(value) < minimum
            or any(char.isspace() for char in value)
            or any(marker in value.upper() for marker in ("YOUR_", "REPLACE_", "<", ">"))
        ):
            errors.append(f"{name.upper()} must contain a configured private credential.")
    if settings.accommodation_provider != "stayapi" or settings.allow_demo_accommodations:
        errors.append("Use ACCOMMODATION_PROVIDER=stayapi and ALLOW_DEMO_ACCOMMODATIONS=false.")
    if settings.food_provider != "geoapify":
        errors.append("Use FOOD_PROVIDER=geoapify in production.")
    for name in (
        "frontend_origin",
        "open_meteo_geocoding_url",
        "overpass_api_url",
        "stayapi_base_url",
        "geoapify_base_url",
    ):
        url = urlsplit(str(getattr(settings, name)))
        if (
            url.scheme != "https"
            or not url.hostname
            or url.hostname in ("localhost", "127.0.0.1", "::1", "0.0.0.0", "example.com")
            or url.hostname.endswith((".localhost", ".example"))
            or url.username
            or url.password
            or url.query
            or url.fragment
            or (name == "frontend_origin" and url.path not in ("", "/"))
        ):
            errors.append(f"{name.upper()} must use a deployed HTTPS URL without credentials.")
    return errors


def main() -> int:
    try:
        errors = deployment_errors(Settings())
    except (ValidationError, ValueError):
        # Pydantic validation details can include input values; keep them out of build logs.
        errors = [
            "Invalid backend environment. Check the variable names and types in DEPLOYMENT.md."
        ]
    if errors:
        print("Backend deployment configuration needs attention:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Backend deployment environment checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
