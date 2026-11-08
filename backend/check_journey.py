"""Explicit live BFF journey using a new, isolated test trip; never changes infrastructure."""

import argparse
import asyncio
import base64
import getpass
import json
import logging
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID, uuid4

import httpx
from dotenv import dotenv_values


async def journey(account, web_origin):
    env = dotenv_values(Path(__file__).resolve().parents[1] / ".env.local")
    origin = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
    configured = urlsplit(origin)
    if (
        configured.scheme != "https"
        or not configured.hostname
        or configured.username
        or configured.password
        or configured.path not in {"", "/"}
        or configured.query
        or configured.fragment
        or not key.startswith("sb_publishable_")
    ):
        raise ValueError("Invalid Supabase configuration")
    results, created, baseline = [], None, set()

    def record(feature, status, code=None):
        result = {"feature": feature, "status": status, **({"code": code} if code else {})}
        results.append(result)
        print(json.dumps(result), flush=True)

    async with httpx.AsyncClient(
        base_url=origin, headers={"apikey": key}, timeout=20, follow_redirects=False
    ) as db:
        login = await db.post("/auth/v1/token?grant_type=password", json=account)
        if login.status_code != 200:
            record("login", "FAIL", f"http_{login.status_code}")
            return results
        session = login.json()
        owner = str(UUID(session["user"]["id"]))
        db.headers["Authorization"] = f"Bearer {session['access_token']}"
        record("login", "PASS")
        record(
            "existing_account_confirmed",
            "PASS" if session["user"].get("email_confirmed_at") else "NOT_VERIFIED",
        )
        old = await db.get("/rest/v1/trips", params={"select": "id", "owner_id": f"eq.{owner}"})
        if old.status_code != 200:
            record("trip_baseline", "FAIL", f"http_{old.status_code}")
            return results
        baseline = {row["id"] for row in old.json()}
        if "expires_at" not in session:
            session["expires_at"] = int(datetime.now(UTC).timestamp()) + session["expires_in"]
        encoded = "base64-" + base64.urlsafe_b64encode(
            json.dumps(session, separators=(",", ":")).encode()
        ).decode().rstrip("=")
        cookie_name = f"sb-{urlsplit(origin).hostname.split('.')[0]}-auth-token"
        cookie_parts = []
        for index in range(0, len(encoded), 3180):
            name = cookie_name if len(encoded) <= 3180 else f"{cookie_name}.{index // 3180}"
            cookie_parts.append(f"{name}={encoded[index : index + 3180]}")
        async with httpx.AsyncClient(
            base_url=web_origin,
            headers={"Origin": web_origin, "Cookie": "; ".join(cookie_parts)},
            timeout=115,
            follow_redirects=False,
        ) as web:

            async def call(feature, method, path, body=None):
                try:
                    response = await web.request(
                        method, path, **({"json": body} if body is not None else {})
                    )
                    data = response.json()
                    if response.status_code >= 400:
                        record(
                            feature,
                            "FAIL",
                            data.get("error", {}).get("code", f"http_{response.status_code}"),
                        )
                        return None
                    record(feature, "PASS")
                    return data
                except Exception:
                    record(feature, "FAIL", "connection_or_invalid_response")
                    return None

            try:
                destinations = await call(
                    "destination_search_bff",
                    "GET",
                    "/api/destinations/search?q=Berlin&country_code=DE&limit=3",
                )
                if not destinations or not destinations.get("destinations"):
                    return results
                destination = destinations["destinations"][0]
                start = datetime.now(UTC).date() + timedelta(days=2)
                form = {
                    "p_destination_name": destination["name"],
                    "p_start_date": start.isoformat(),
                    "p_end_date": (start + timedelta(days=2)).isoformat(),
                    "p_travelers_count": 1,
                    "p_budget_total": "2500.00",
                    "p_currency": "EUR",
                    "p_budget_style": "balanced",
                    "p_travel_pace": "relaxed",
                    "p_accommodation_preferences": ["hotel"],
                    "p_dietary_preferences": [],
                    "p_special_requests": None,
                    "p_interests": ["history", "culture"],
                    "p_time_zone": "Europe/Berlin",
                }
                saved = await db.post(
                    "/rest/v1/rpc/create_resolved_trip",
                    json={
                        "p_form": form,
                        "p_payload": destination["proof"]["payload"],
                        "p_signature": destination["proof"]["signature"],
                    },
                )
                if saved.status_code != 200:
                    record(
                        "trip_creation_signed_rpc",
                        "FAIL",
                        saved.json().get("code", f"http_{saved.status_code}"),
                    )
                    return results
                candidate = str(UUID(saved.json()))
                if candidate in baseline:
                    record(
                        "trip_creation_signed_rpc",
                        "FAIL",
                        "existing_trip_returned_no_cleanup_attempted",
                    )
                    return results
                created = candidate
                record("trip_creation_signed_rpc", "PASS")
                root = f"/api/trips/{created}"
                await call("places_discovery_bff", "POST", f"{root}/discover-places", {})
                hotels = await call("hotels_search_bff", "POST", f"{root}/hotels", {"demo": False})
                candidates = (hotels or {}).get("results", {}).get("candidates", [])
                if candidates:
                    await call(
                        "hotel_selection_signed_bff",
                        "POST",
                        f"{root}/accommodation-selection",
                        {"proof": candidates[0]["selection_proof"], "expected_selection_id": None},
                    )
                else:
                    record("hotel_selection_signed_bff", "NOT_VERIFIED", "no_candidates")
                food = await call("food_search_bff", "POST", f"{root}/food", {})
                candidates = (food or {}).get("results", {}).get("candidates", [])
                if candidates:
                    await call(
                        "food_selection_signed_bff",
                        "POST",
                        f"{root}/food-selections",
                        {"proof": candidates[0]["selection_proof"]},
                    )
                else:
                    record("food_selection_signed_bff", "NOT_VERIFIED", "no_candidates")
                await call(
                    "itinerary_generation_bff",
                    "POST",
                    f"{root}/itinerary/generate",
                    {"request_id": str(uuid4()), "regenerate": False},
                )
                await call(
                    "budget_entry_bff",
                    "POST",
                    f"{root}/budget/entries",
                    {
                        "id": str(uuid4()),
                        "category": "transport",
                        "entry_type": "planned",
                        "description": "Launch verification entry",
                        "amount": "10.00",
                        "currency": "EUR",
                    },
                )
                await call("budget_summary_bff", "GET", f"{root}/budget")
                await call("weather_refresh_bff", "POST", f"{root}/weather/refresh", {})
                await call(
                    "companion_bff",
                    "POST",
                    f"{root}/companion/messages",
                    {"request_id": str(uuid4()), "message": "Summarize this saved trip."},
                )
                await call("walking_route_bff", "GET", f"{root}/routing?day_number=1&mode=walking")
                memory = await call("preferences_memory_bff", "GET", "/api/memory")
                if memory and not memory.get("available"):
                    record("preferences_rag_storage", "BLOCKED", "migration_unavailable")
                exported = await call("itinerary_export_bff", "GET", f"{root}/export")
                if exported is not None:
                    text = json.dumps(exported)
                    if (
                        created in text
                        or owner in text
                        or any(k in text for k in ("special_requests", "access_token", "memories"))
                    ):
                        record("export_allowlist", "FAIL", "private_field_exposed")
                    else:
                        record("export_allowlist", "PASS")
                share = await call("sharing_state_bff", "GET", f"{root}/share")
                if share and not share.get("available"):
                    record("sharing_storage", "BLOCKED", "migration_unavailable")
            finally:
                if created and created not in baseline:
                    deleted = await db.delete(
                        "/rest/v1/trips",
                        params={"id": f"eq.{created}", "owner_id": f"eq.{owner}"},
                        headers={"Prefer": "return=representation"},
                    )
                    record(
                        "isolated_test_trip_cleanup",
                        "PASS"
                        if deleted.status_code == 200 and len(deleted.json()) == 1
                        else "FAIL",
                    )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--create-test-trip",
        action="store_true",
        help="Authorize creation and cleanup of one new trip and its child records",
    )
    parser.add_argument("--web-origin", default="http://localhost:3116")
    args = parser.parse_args()
    if not args.create_test_trip:
        parser.error("Requires --create-test-trip; existing trips are never deleted")
    parsed = urlsplit(args.web_origin)
    if (
        parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.scheme != "http"
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        parser.error("The journey runner requires a local test server")
    logging.disable(logging.CRITICAL)
    raw = (
        getpass.getpass("Test account JSON (hidden): ")
        if sys.stdin.isatty()
        else sys.stdin.readline()
    )
    account = json.loads(raw)
    try:
        results = asyncio.run(journey(account, args.web_origin))
    except Exception:
        print(
            json.dumps({"feature": "journey", "status": "FAIL", "code": "unexpected_runner_error"})
        )
        return 1
    return 1 if any(r["status"] != "PASS" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
