import re
from pathlib import Path

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


def test_environment_examples_have_blank_private_keys_and_public_placeholders():
    root = Path(__file__).resolve().parents[2]
    for relative in (".env.example", "backend/.env.example"):
        text = (root / relative).read_text(encoding="utf-8-sig")
        for number, line in enumerate(text.splitlines(), 1):
            match = re.match(r"\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$", line)
            if not match:
                continue
            name, value = match.groups()
            value = value.strip("\"'")
            private = not name.startswith("NEXT_PUBLIC_") and re.search(
                r"KEY|SECRET|TOKEN|PASSWORD", name
            )
            if private and value:
                # Explicit failure messages must never echo the credential.
                raise AssertionError(f"{relative}:{number}: {name} must be blank in templates")
            if name == "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" and value:
                if not re.search(r"YOUR_|REPLACE_|EXAMPLE|PLACEHOLDER", value, re.I):
                    raise AssertionError(
                        f"{relative}:{number}: {name} must use a public example placeholder"
                    )
