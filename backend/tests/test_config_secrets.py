from app.core.config import Settings


def test_secret_defaults_are_empty_and_secrets_load_from_private_environment(tmp_path, monkeypatch):
    fields = ["nomvira_internal_api_key", "stayapi_api_key", "geoapify_api_key", "gemini_api_key"]
    for name in fields:
        assert Settings.model_fields[name].default.get_secret_value() == ""
        monkeypatch.delenv(name.upper(), raising=False)
    env = tmp_path / ".env"
    env.write_text(
        "\n".join(f"{name.upper()}=test-only-{name}" for name in fields), encoding="utf-8"
    )
    settings = Settings(_env_file=env)
    for name in fields:
        assert getattr(settings, name).get_secret_value() == f"test-only-{name}"
        assert f"test-only-{name}" not in repr(settings)
