# momome (Python)

```python
from momome import MoMoMe, verify_webhook_signature
momome = MoMoMe(os.environ["MOMOME_KEY"])  # mm_test_… → sandbox, mm_live_… → production
quote = momome.quotes.create({"source": {"asset": "USDT", "network": "ETHEREUM"}, "destination": {"country": "CM", "amount": "25000"}})
payment = momome.payments.create({"quote_id": quote["id"], "reference": "ORDER-1", "recipient": {"phone": "+237670123456"}}, idempotency_key="ORDER-1")
print(payment["payment_instructions"]["uri"])
settled = momome.payments.wait_until_settled(payment["id"])

# Flask webhook
@app.post("/momome")
def hook():
    if not verify_webhook_signature(request.get_data(), request.headers.get("X-MoMoMe-Signature"), os.environ["MOMOME_WEBHOOK_SECRET"]): abort(400)
    event = request.get_json(); ...
    return "", 200
```
Errors raise `MoMoMeError` (`.status`, `.code`, `.details`, `.request_id`). Docs: https://momome.xyz/developers
