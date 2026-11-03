"""Browser-mediated Better Auth device authorization for LiveTrial."""

from __future__ import annotations

import json
import re
import time
from typing import Callable
from urllib import parse

from livetrial_https import (
    DEVICE_CODE_PATH,
    DEVICE_TOKEN_PATH,
    EMAIL_APPROVAL_PATH,
    EMAIL_APPROVAL_VERIFY_PATH,
    MAX_AUTH_RESPONSE_BYTES,
    NATIVE_BOOTSTRAP_PATH,
    SIGN_OUT_PATH,
    compact_json,
)
from livetrial_session import SESSION_SCHEMA_VERSION, parse_native_session


DESKTOP_AUTH_CLIENT_ID = "mk8dx.timetrials.desktop.v1"
DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code"
_TOKEN = re.compile(r"^[A-Za-z0-9_-]{20,255}$")
_DEVICE_CODE = re.compile(r"^[A-Za-z0-9_-]{20,255}$")
_USER_CODE = re.compile(r"^[A-Za-z0-9-]{4,32}$")
_PLAYER = re.compile(r"^player\.[a-z0-9]+(?:[._-][a-z0-9]+)*$")
_USERNAME = re.compile(r"^[a-z0-9_-]{3,16}$")


class LiveTrialAuthenticationError(RuntimeError):
    """Bounded native-authentication failure."""


def _fail() -> None:
    raise LiveTrialAuthenticationError("LiveTrial authentication failed.") from None


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _document(response: object, status: int) -> dict:
    try:
        if (
            not isinstance(response, dict)
            or set(response) != {"statusCode", "contentType", "body"}
            or response["statusCode"] != status
            or not isinstance(response["contentType"], str)
            or re.fullmatch(
                r"application/json(?:\s*;.*)?",
                response["contentType"],
                re.IGNORECASE,
            )
            is None
            or not isinstance(response["body"], bytes)
            or not response["body"]
            or len(response["body"]) > MAX_AUTH_RESPONSE_BYTES
        ):
            _fail()
        parsed = json.loads(
            response["body"].decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
        )
    except LiveTrialAuthenticationError:
        raise
    except Exception:
        _fail()
    if not isinstance(parsed, dict):
        _fail()
    return parsed


def _integer(document: dict, name: str, minimum: int, maximum: int) -> int:
    value = document.get(name)
    if (
        not isinstance(value, int)
        or isinstance(value, bool)
        or not minimum <= value <= maximum
    ):
        _fail()
    return value


class LiveTrialDeviceAuthorizationClient:
    def __init__(self, https, clock_ms: Callable[[], int] | None = None) -> None:
        if not callable(getattr(https, "request", None)):
            _fail()
        self._https = https
        self._clock_ms = clock_ms or (lambda: time.time_ns() // 1_000_000)
        if not callable(self._clock_ms):
            _fail()

    def request_device_authorization(self) -> dict:
        response = self._https.request(
            "POST",
            DEVICE_CODE_PATH,
            compact_json({"client_id": DESKTOP_AUTH_CLIENT_ID}),
        )
        document = _document(response, 200)
        if set(document) != {
            "device_code",
            "user_code",
            "verification_uri",
            "verification_uri_complete",
            "expires_in",
            "interval",
        }:
            _fail()
        device_code = document.get("device_code")
        user_code = document.get("user_code")
        if (
            not isinstance(device_code, str)
            or _DEVICE_CODE.fullmatch(device_code) is None
            or not isinstance(user_code, str)
            or _USER_CODE.fullmatch(user_code) is None
        ):
            _fail()
        verification_uri = self._verification_uri(document.get("verification_uri"), None)
        complete_uri = self._verification_uri(
            document.get("verification_uri_complete"), user_code
        )
        return {
            "deviceCode": device_code,
            "userCode": user_code,
            "verificationUri": verification_uri,
            "verificationUriComplete": complete_uri,
            "expiresInSeconds": _integer(document, "expires_in", 60, 1800),
            "pollingIntervalSeconds": _integer(document, "interval", 1, 60),
        }

    def _verification_uri(self, value: object, user_code: str | None) -> str:
        try:
            parsed = parse.urlsplit(value)
            origin = parse.urlsplit(self._https.origin)
            query = parse.parse_qs(
                parsed.query,
                keep_blank_values=True,
                strict_parsing=True,
            )
        except Exception:
            _fail()
        expected_query = {} if user_code is None else {"user_code": [user_code]}
        if (
            not isinstance(value, str)
            or parsed.scheme != origin.scheme
            or parsed.netloc != origin.netloc
            or parsed.path != "/device"
            or parsed.fragment
            or query != expected_query
        ):
            _fail()
        return value

    def poll(self, device_code: str) -> dict:
        if not isinstance(device_code, str) or _DEVICE_CODE.fullmatch(device_code) is None:
            _fail()
        response = self._https.request(
            "POST",
            DEVICE_TOKEN_PATH,
            compact_json(
                {
                    "grant_type": DEVICE_GRANT_TYPE,
                    "device_code": device_code,
                    "client_id": DESKTOP_AUTH_CLIENT_ID,
                }
            ),
        )
        if not isinstance(response, dict):
            _fail()
        if response.get("statusCode") == 200:
            document = _document(response, 200)
            if set(document) != {"access_token", "token_type", "expires_in", "scope"}:
                _fail()
            token = document.get("access_token")
            if (
                not isinstance(token, str)
                or _TOKEN.fullmatch(token) is None
                or document.get("token_type") != "Bearer"
                or not isinstance(document.get("scope"), str)
            ):
                _fail()
            return {
                "state": "authorized",
                "bearerToken": token,
                "expiresInSeconds": _integer(document, "expires_in", 60, 604_800),
            }
        document = _document(response, 400)
        error_code = document.get("error")
        if error_code == "authorization_pending":
            return {"state": "pending"}
        if error_code == "slow_down":
            return {"state": "slow_down", "additionalDelaySeconds": 5}
        if error_code == "access_denied":
            return {"state": "denied"}
        if error_code in {"expired_token", "invalid_grant"}:
            return {"state": "expired"}
        _fail()

    # -- ADR-0209: an email with a link and a code approves the pending device code --

    def request_email_approval(self, user_code: str, email: str) -> None:
        """Ask the site to email a link and a code for this pending sign-in.

        The answer is the same whether or not the address has an account, so
        the app always says "if this email has an account, we sent it"."""
        if (
            not isinstance(user_code, str) or _USER_CODE.fullmatch(user_code) is None
            or not isinstance(email, str) or not 3 <= len(email.strip()) <= 320 or "@" not in email
        ):
            _fail()
        document = _document(
            self._https.request(
                "POST", EMAIL_APPROVAL_PATH,
                compact_json({"userCode": user_code, "email": email.strip()}),
            ),
            202,
        )
        if document != {"schemaVersion": "mk8dx.native-email-approval.v1", "status": "sent_if_eligible"}:
            _fail()

    def verify_email_code(self, user_code: str, code: str) -> dict:
        """Hand the six-digit code from the email to the site; the pending
        device code is then approved and the normal poll picks up the session."""
        digits = code.replace(" ", "") if isinstance(code, str) else ""
        if (
            not isinstance(user_code, str) or _USER_CODE.fullmatch(user_code) is None
            or re.fullmatch(r"[0-9]{6}", digits) is None
        ):
            _fail()
        document = _document(
            self._https.request(
                "POST", EMAIL_APPROVAL_VERIFY_PATH,
                compact_json({"userCode": user_code, "code": digits}),
            ),
            200,
        )
        status = document.get("status")
        if document.get("schemaVersion") != "mk8dx.native-email-approval.v1" or status not in {
            "approved", "invalid", "expired", "locked",
        } or not set(document) <= {"schemaVersion", "status", "attemptsLeft"}:
            _fail()
        result = {"status": status}
        if status == "invalid":
            result["attemptsLeft"] = _integer(document, "attemptsLeft", 0, 5)
        return result

    def establish_session(self, bearer_token: str, expires_in_seconds: int) -> dict:
        if (
            not isinstance(bearer_token, str)
            or _TOKEN.fullmatch(bearer_token) is None
            or not isinstance(expires_in_seconds, int)
            or isinstance(expires_in_seconds, bool)
            or not 60 <= expires_in_seconds <= 604_800
        ):
            _fail()
        response = self._https.request(
            "GET",
            NATIVE_BOOTSTRAP_PATH,
            None,
            bearer_token,
        )
        document = _document(response, 200)
        player_id = document.get("playerId")
        username = document.get("username")
        display_name = document.get("displayName")
        if (
            set(document) != {"schemaVersion", "playerId", "username", "displayName"}
            or document.get("schemaVersion") != "mk8dx.native-time-trial-bootstrap.v2"
            or not isinstance(player_id, str)
            or len(player_id) > 135
            or _PLAYER.fullmatch(player_id) is None
            or not isinstance(username, str)
            or _USERNAME.fullmatch(username) is None
            or not isinstance(display_name, str)
            or not 1 <= len(display_name) <= 64
            or any(ord(char) < 0x20 or ord(char) == 0x7F for char in display_name)
        ):
            _fail()
        now_ms = self._clock_ms()
        if not isinstance(now_ms, int) or isinstance(now_ms, bool) or now_ms < 0:
            _fail()
        expires_at_ms = now_ms + expires_in_seconds * 1000
        return parse_native_session(
            {
                "schemaVersion": SESSION_SCHEMA_VERSION,
                "bearerToken": bearer_token,
                "expiresAtMs": expires_at_ms,
                "playerId": player_id,
                "username": username,
                "displayName": display_name,
            }
        )

    def revoke(self, bearer_token: str) -> None:
        if not isinstance(bearer_token, str) or _TOKEN.fullmatch(bearer_token) is None:
            _fail()
        document = _document(
            self._https.request(
                "POST",
                SIGN_OUT_PATH,
                b"{}",
                bearer_token,
            ),
            200,
        )
        if set(document) != {"success"} or document.get("success") is not True:
            _fail()


def complete_device_sign_in(
    client: LiveTrialDeviceAuthorizationClient,
    session_store,
    open_browser: Callable[[str], object],
    notify: Callable[[dict], None],
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> dict:
    if not all(callable(value) for value in (open_browser, notify, sleep, monotonic)):
        _fail()
    pending = client.request_device_authorization()
    notify(dict(pending))
    try:
        open_browser(pending["verificationUriComplete"])
    except Exception:
        pass
    started = monotonic()
    deadline = started + pending["expiresInSeconds"]
    delay = pending["pollingIntervalSeconds"]
    while True:
        now = monotonic()
        if not isinstance(now, (int, float)) or isinstance(now, bool) or now < started:
            _fail()
        if now + delay > deadline:
            _fail()
        sleep(delay)
        result = client.poll(pending["deviceCode"])
        if result["state"] == "pending":
            continue
        if result["state"] == "slow_down":
            delay = min(60, delay + result["additionalDelaySeconds"])
            continue
        if result["state"] != "authorized":
            _fail()
        session = client.establish_session(
            result["bearerToken"],
            result["expiresInSeconds"],
        )
        try:
            session_store.save(session)
        except Exception:
            try:
                client.revoke(result["bearerToken"])
            except Exception:
                pass
            _fail()
        return session


def revoke_current_session(
    client: LiveTrialDeviceAuthorizationClient,
    session_store,
    now_ms: int,
) -> bool:
    try:
        session = session_store.load(now_ms)
        if session is None:
            return False
        client.revoke(session["bearerToken"])
        session_store.clear()
        return True
    except Exception:
        _fail()
