"""MoMo›Me API v1 client (https://momome.xyz/developers). Aligned with GET /v1/openapi.json.

    from momome import MoMoMe
    momome = MoMoMe(os.environ["MOMOME_KEY"])   # mm_test_… → sandbox, mm_live_… → production
    quote = momome.quotes.create({"source": {"asset": "USDT", "network": "ETHEREUM"}, "destination": {"country": "CM", "amount": "25000"}})
    payment = momome.payments.create({"quote_id": quote["id"], "reference": "ORDER-1", "recipient": {"phone": "+237670123456"}}, idempotency_key="ORDER-1")

Every method returns the envelope's `data` (a dict) and raises MoMoMeError on `error`.
Standard library only (urllib), so it drops into any stack.
"""
from __future__ import annotations
import hashlib, hmac, json, re, secrets, time, urllib.error, urllib.parse, urllib.request
from typing import Any, Optional

__all__ = ["MoMoMe", "MoMoMeError", "verify_webhook_signature"]
LIVE = "https://api.momome.xyz/v1"
SANDBOX = "https://sandbox.api.momome.xyz/v1"
TERMINAL = {"COMPLETED", "EXPIRED", "FAILED", "CANCELLED", "REFUNDED", "MANUAL_REVIEW"}


class MoMoMeError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Optional[dict] = None, request_id: Optional[str] = None):
        super().__init__(message); self.status, self.code, self.details, self.request_id = status, code, details or {}, request_id


class MoMoMe:
    def __init__(self, credential: str, base_url: Optional[str] = None, sandbox_url: Optional[str] = None, timeout: float = 30.0):
        if not re.fullmatch(r"mm_(live|test)_[0-9a-f]{32}", credential or ""):
            raise MoMoMeError(0, "credential_invalid", "Pass an API credential (mm_live_… or mm_test_…).")
        self._credential, self.timeout = credential, timeout
        self.environment = "live" if credential.startswith("mm_live_") else "test"
        self.base_url = (base_url or (LIVE if self.environment == "live" else (sandbox_url or SANDBOX))).rstrip("/")
        self.quotes, self.payments, self.recipients, self.webhooks, self.settlements, self.account, self.sandbox = _Quotes(self), _Payments(self), _Recipients(self), _Webhooks(self), _Settlements(self), _Account(self), _Sandbox(self)

    def request(self, method: str, path: str, body: Any = None, idempotent: bool = False, idempotency_key: Optional[str] = None, request_id: Optional[str] = None) -> Any:
        headers = {"Authorization": f"Bearer {self._credential}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "momome-python/1.0.0"}
        if idempotent: headers["Idempotency-Key"] = idempotency_key or f"sdk_{secrets.token_hex(8)}"
        if request_id: headers["X-Request-Id"] = request_id
        data = json.dumps(body if body is not None else ({} if method in ("POST", "PATCH") else None)).encode() if (body is not None or method in ("POST", "PATCH")) else None
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r: status, raw = r.status, r.read()
        except urllib.error.HTTPError as e: status, raw = e.code, e.read()
        except urllib.error.URLError as e: raise MoMoMeError(0, "network_error", f"Could not reach MoMo›Me: {e.reason}")
        try: j = json.loads(raw or b"{}")
        except ValueError: raise MoMoMeError(status, "bad_response", f"Non-JSON response ({status}).")
        if status >= 400 or "error" in j:
            err = j.get("error") or {}
            raise MoMoMeError(status, err.get("code", "http_error"), err.get("message", f"HTTP {status}"), err.get("details"), (j.get("meta") or {}).get("request_id"))
        return j.get("data")

    @staticmethod
    def _q(params: dict) -> str:
        p = {k: v for k, v in params.items() if v not in (None, "")}
        return ("?" + urllib.parse.urlencode(p)) if p else ""


class _Quotes:
    def __init__(self, c: MoMoMe): self.c = c
    def create(self, body: dict, idempotency_key: Optional[str] = None): return self.c.request("POST", "/quotes", body, True, idempotency_key)
    def get(self, quote_id: str): return self.c.request("GET", f"/quotes/{quote_id}")


class _Payments:
    def __init__(self, c: MoMoMe): self.c = c
    def create(self, body: dict, idempotency_key: Optional[str] = None): return self.c.request("POST", "/payments", body, True, idempotency_key)
    def get(self, payment_id: str): return self.c.request("GET", f"/payments/{payment_id}")
    def wait(self, payment_id: str, status: str, seconds: int = 25): return self.c.request("GET", f"/payments/{payment_id}" + MoMoMe._q({"wait": seconds, "status": status}))
    def wait_until_settled(self, payment_id: str, timeout_seconds: int = 900) -> dict:
        t0, p = time.time(), self.get(payment_id)
        while p["status"] not in TERMINAL and time.time() - t0 < timeout_seconds: p = self.wait(payment_id, p["status"])
        return p
    def list(self, **params): return self.c.request("GET", "/payments" + MoMoMe._q(params))
    def cancel(self, payment_id: str, idempotency_key: Optional[str] = None): return self.c.request("POST", f"/payments/{payment_id}/cancel", {}, True, idempotency_key)
    def refund(self, payment_id: str, body: dict, idempotency_key: Optional[str] = None): return self.c.request("POST", f"/payments/{payment_id}/refund", body, True, idempotency_key)
    def retry(self, payment_id: str, idempotency_key: Optional[str] = None): return self.c.request("POST", f"/payments/{payment_id}/retry", {}, True, idempotency_key)


class _Recipients:
    def __init__(self, c: MoMoMe): self.c = c
    def validate(self, body: dict): return self.c.request("POST", "/recipients/validate", body)


class _Webhooks:
    def __init__(self, c: MoMoMe): self.c = c
    def create(self, body: dict, idempotency_key: Optional[str] = None): return self.c.request("POST", "/webhooks", body, True, idempotency_key)
    def list(self): return self.c.request("GET", "/webhooks")
    def get(self, wh: str): return self.c.request("GET", f"/webhooks/{wh}")
    def update(self, wh: str, body: dict): return self.c.request("PATCH", f"/webhooks/{wh}", body)
    def delete(self, wh: str): return self.c.request("DELETE", f"/webhooks/{wh}")
    def test(self, wh: str): return self.c.request("POST", f"/webhooks/{wh}/test", {})
    def replay(self, wh: str, event_id: str): return self.c.request("POST", f"/webhooks/{wh}/replay", {"event_id": event_id})
    def deliveries(self, wh: str): return self.c.request("GET", f"/webhooks/{wh}/deliveries")


class _Settlements:
    def __init__(self, c: MoMoMe): self.c = c
    def create(self, body: dict, idempotency_key: Optional[str] = None): return self.c.request("POST", "/settlements", body, True, idempotency_key)
    def list(self): return self.c.request("GET", "/settlements")
    def get(self, sid: str): return self.c.request("GET", f"/settlements/{sid}")
    def cancel(self, sid: str, idempotency_key: Optional[str] = None): return self.c.request("POST", f"/settlements/{sid}/cancel", {}, True, idempotency_key)


class _Account:
    def __init__(self, c: MoMoMe): self.c = c
    def get(self): return self.c.request("GET", "/account")
    def balances(self): return self.c.request("GET", "/account/balances")
    def usage(self, **params): return self.c.request("GET", "/usage" + MoMoMe._q(params))
    def transactions(self, **params): return self.c.request("GET", "/transactions" + MoMoMe._q(params))
    def transaction(self, payment_id: str): return self.c.request("GET", f"/transactions/{payment_id}")


class _Sandbox:
    def __init__(self, c: MoMoMe): self.c = c
    def scenarios(self): return self.c.request("GET", "/sandbox/scenarios")
    def pay(self, payment_id: str): return self.c.request("POST", f"/sandbox/payments/{payment_id}/pay", {})


def verify_webhook_signature(raw_body: bytes, signature_header: Optional[str], secret: str, tolerance_ms: int = 300_000) -> bool:
    """Verify X-MoMoMe-Signature over the RAW request body."""
    if not signature_header: return False
    t, v1 = re.search(r"t=(\d+)", signature_header), re.search(r"v1=([0-9a-f]+)", signature_header)
    if not t or not v1 or abs(int(time.time() * 1000) - int(t.group(1))) > tolerance_ms: return False
    expect = hmac.new(secret.encode(), (t.group(1) + ".").encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expect, v1.group(1))
