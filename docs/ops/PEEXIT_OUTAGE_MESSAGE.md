# Message to the Peexit team — migration follow-up

*Updated 28 October 2026, after receiving the new connection parameters. Replaces the
earlier outage report: the question is no longer "what happened" but "confirm these four
details so we can reconnect cleanly."*

---

**Subject: New gateway received — four confirmations needed to complete our cutover
(account Umdeny)**

Hello,

Thank you for the new connection parameters. We have received:

- New server endpoint: `https://px-gw-c2810.peexit.com/api/`
- Whitelisted IP: `152.55.177.87`

We have repointed our integration at the new gateway and confirmed it resolves and responds.
Four things would let us complete the cutover without a round of avoidable failures.

**1. The exact base path — `/api` or `/api/v1`?**

Our previous production base was `https://server.peexit.com/api/v1`, so our calls were:

```
POST  /api/v1/disbursement/request_payment
GET   /api/v1/disbursement/all_requests?track_id=...
GET   /api/v1/disbursement/me
GET   /api/v1/collection/me
```

The new endpoint is written as `/api/` without a version segment. Should our calls now be
`/api/disbursement/request_payment`, or is the version still present as
`/api/v1/disbursement/request_payment`? We cannot determine this ourselves — the gateway
correctly returns 403 to any non-allowlisted source before routing, so every path looks
identical from outside your allowlist.

**2. The API Secret Key**

You noted the access key will arrive through a separate channel. Please confirm:

- which channel it will come from, so we can recognise it and reject anything else;
- whether our existing SECRETKEY is now revoked, or remains valid against the new gateway.

We will not send live traffic using a key that arrives by any route we have not confirmed
with you directly.

**3. Allowlist coverage**

Please confirm `152.55.177.87` is allowlisted for **all** the surfaces we use, not only
disbursement:

- disbursement (`request_payment`, `all_requests`, `me`)
- collection (`me`, and collection requests)
- `holder_info` — the account-name lookup

Our senders see the registered name behind a recipient's number before they confirm a
payment, so `holder_info` is part of the customer path, not just an internal call.

**4. Callbacks**

Our notification callback is authenticated with HTTP Basic credentials we registered with
you. Please confirm the callback URL and those credentials carried over to the new gateway,
or tell us if they must be re-registered.

**One request for the future**

The previous hostnames (`server.peexit.com`, `sandbox.peexit.com`) were removed from DNS
before we had the replacement, so our first indication was payouts failing. If you have a
status page or an incident/migration mailing list, please add us. If there is a sandbox
equivalent of the new gateway, we would like that endpoint too — we rehearse against sandbox
before sending live money.

Thank you for getting this to us.

[Your name]
MoMo›Me
