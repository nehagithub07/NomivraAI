"""Offline guardrails for live probes; every HTTP request uses MockTransport."""

import io
import json
from functools import partial

import httpx
import pytest

import check_journey
import check_live
from app.core.config import Settings


@pytest.mark.parametrize(
    "runner,arguments",
    [
        (check_live, []),
        (check_journey, []),
        (check_journey, ["--create-test-trip", "--web-origin", "https://example.com"]),
        (check_journey, ["--create-test-trip", "--web-origin", "http://user:password@localhost"]),
    ],
)
def test_live_runner_requires_explicit_local_scope(runner, arguments, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["probe", *arguments])
    with pytest.raises(SystemExit) as stopped:
        runner.main()
    assert stopped.value.code == 2
    assert "Traceback" not in capsys.readouterr().err


@pytest.mark.parametrize(
    "runner,arguments",
    [
        (check_live, ["--live", "--credentials-stdin"]),
        (check_journey, ["--create-test-trip"]),
    ],
)
def test_invalid_credentials_never_echo_input(runner, arguments, monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["probe", *arguments])
    monkeypatch.setattr("sys.stdin", io.StringIO("NEVER_LOG private input"))
    monkeypatch.setattr(runner.logging, "disable", lambda *_: None)
    with pytest.raises(SystemExit) as stopped:
        runner.main()
    assert stopped.value.code == 2
    assert "NEVER_LOG" not in capsys.readouterr().err


def test_unknown_probe_is_not_a_success_and_sends_no_requests(monkeypatch, capsys):
    def no_network(*_, **__):
        raise AssertionError("Unexpected request")

    client = httpx.AsyncClient
    monkeypatch.setattr(
        check_live.httpx, "AsyncClient", partial(client, transport=httpx.MockTransport(no_network))
    )
    monkeypatch.setattr(check_live, "dotenv_values", lambda *_: {})
    monkeypatch.setattr(check_live, "Settings", lambda: Settings(_env_file=None, app_env="test"))
    monkeypatch.setattr(check_live.logging, "disable", lambda *_: None)
    monkeypatch.setattr("sys.argv", ["probe", "--live", "--providers", "unknown"])
    assert check_live.main() == 2
    assert json.loads(capsys.readouterr().out.splitlines()[-1])["code"] == "not_executed"


@pytest.mark.asyncio
@pytest.mark.parametrize("returns_existing", [False, True])
async def test_journey_cleanup_cannot_delete_preexisting_trip(
    returns_existing, monkeypatch, capsys
):
    owner = "11111111-1111-4111-8111-111111111111"
    existing = "22222222-2222-4222-8222-222222222222"
    created = existing if returns_existing else "33333333-3333-4333-8333-333333333333"
    deleted = []

    def respond(request):
        path = request.url.path
        if request.url.host == "db.example":
            assert "Cookie" not in request.headers
            if path == "/auth/v1/token":
                return httpx.Response(
                    200,
                    json={
                        "access_token": "test-only-token",
                        "expires_in": 3600,
                        "user": {"id": owner, "email_confirmed_at": "2026-01-01"},
                    },
                )
            if path == "/rest/v1/rpc/create_resolved_trip":
                return httpx.Response(200, json=created)
            assert path == "/rest/v1/trips"
            if request.method == "DELETE":
                deleted.append(dict(request.url.params))
                return httpx.Response(200, json=[{"id": created}])
            return httpx.Response(200, json=[{"id": existing}])
        assert request.url.host == "localhost"
        if path == "/api/destinations/search":
            return httpx.Response(
                200,
                json={
                    "destinations": [
                        {"name": "Berlin", "proof": {"payload": "test", "signature": "test"}}
                    ]
                },
            )
        # Exercise cleanup after all downstream feature requests fail safely.
        return httpx.Response(503, json={"error": {"code": "provider_unavailable"}})

    client = httpx.AsyncClient
    monkeypatch.setattr(
        check_journey.httpx, "AsyncClient", partial(client, transport=httpx.MockTransport(respond))
    )
    monkeypatch.setattr(
        check_journey,
        "dotenv_values",
        lambda *_: {
            "NEXT_PUBLIC_SUPABASE_URL": "https://db.example",
            "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test_only",
        },
    )
    results = await check_journey.journey(
        {"email": "test@example.com", "password": "test-only"}, "http://localhost:3116"
    )
    if returns_existing:
        assert not deleted
        assert results[-1]["code"] == "existing_trip_returned_no_cleanup_attempted"
    else:
        assert deleted == [{"id": f"eq.{created}", "owner_id": f"eq.{owner}"}]
        assert results[-1]["feature"] == "isolated_test_trip_cleanup"
        assert results[-1]["status"] == "PASS"
    output = capsys.readouterr().out
    assert all(value not in output for value in (owner, created, "test-only-token"))
