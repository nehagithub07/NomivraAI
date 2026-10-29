import pytest
from pydantic import ValidationError

import check_deployment
from app.core.config import Settings
from check_deployment import deployment_errors

CONFIGURED = {
    "_env_file": None,
    "app_env": "production",
    "frontend_origin": "https://nomvira-test.vercel.app",
    "nomvira_internal_api_key": "test-internal-application-key-never-real",
    "stayapi_api_key": "test-stayapi-key-never-real",
    "geoapify_api_key": "test-geoapify-key-never-real",
}


def test_complete_production_environment():
    assert deployment_errors(Settings(**CONFIGURED)) == []


@pytest.mark.parametrize(
    "changes,name",
    [
        ({"app_env": "development"}, "APP_ENV"),
        ({"frontend_origin": "http://localhost:3000"}, "FRONTEND_ORIGIN"),
        ({"frontend_origin": "https://user:PRIVATE@example.net"}, "FRONTEND_ORIGIN"),
        ({"overpass_api_url": "http://overpass-api.de/api/interpreter"}, "OVERPASS_API_URL"),
        ({"nomvira_internal_api_key": "PRIVATE"}, "NOMVIRA_INTERNAL_API_KEY"),
        ({"stayapi_api_key": ""}, "STAYAPI_API_KEY"),
        ({"geoapify_api_key": ""}, "GEOAPIFY_API_KEY"),
        ({"food_provider": "fixture"}, "FOOD_PROVIDER"),
        ({"accommodation_provider": "fixture"}, "ACCOMMODATION_PROVIDER"),
        ({"allow_demo_accommodations": True}, "ALLOW_DEMO_ACCOMMODATIONS"),
    ],
)
def test_invalid_production_environment_fails_without_echoing_values(changes, name):
    errors = deployment_errors(Settings(**{**CONFIGURED, **changes}))
    assert any(name in error for error in errors)
    assert "PRIVATE" not in " ".join(errors)


def test_startup_check_masks_pydantic_input_values(monkeypatch, capsys):
    def invalid():
        raise ValidationError.from_exception_data(
            "Settings",
            [{"type": "int_parsing", "loc": ("bad",), "input": "PRIVATE_DO_NOT_LOG"}],
        )

    monkeypatch.setattr(check_deployment, "Settings", invalid)
    assert check_deployment.main() == 1
    assert "PRIVATE_DO_NOT_LOG" not in capsys.readouterr().out
