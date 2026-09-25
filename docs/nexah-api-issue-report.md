# NEXAH BulkSMS API — authentication failure on `sms.wandatech.net`

**For:** NEXAH / Wandatech technical support
**From:** momome (Bitbase Technologies Incorporated) — contact `info@momome.xyz`
**Account:** `rimskycho@gmail.com` · sender ID `MoMoMe` · password supplied separately
**Host:** `https://sms.wandatech.net`
**Spec used:** *SMS-API Interfaces* (NEXAH BulkSMS, RESTful), sections 2.1–2.2
**All evidence below captured:** 2026-09-25 13:54 UTC

---

## 1. Summary

Every call to the SMS API on `sms.wandatech.net` is rejected with

```json
{"errorcode":401,"message":"Unauthorised"}
```

We believe this is **not a wrong password**. The decisive evidence is in §3: the API returns
*the exact same response whether credentials are supplied or not*. A request with an empty
JSON body `{}` is answered identically to one carrying the full username and password. That
means the credentials are never evaluated — something rejects the request before the SMS
logic runs.

We would like NEXAH to confirm whether API access is enabled for this account, and if the API
requires a credential separate from the web portal login, to issue it.

**Impact:** we use this API for one thing only — verifying a customer's phone number with a
one-time code. It is currently impossible for a new customer to complete sign-up on our iOS,
Android and web products.

---

## 2. What the specification says a failure should look like

Per §2.1.2 of the spec, a failed request returns:

```json
{"responsecode": 0, "responsedescription": "error", "responsemessage": "<reason>"}
```

with `responsemessage` drawn from the documented list — *Username and password require*,
*Senderid require*, *Balance not enough*, *Invalid senderid*, … — or an `errorcode` from the
documented set: **-10019** (Inactive User), **-10003** (Invalid Mobile Number), **-10026**
(Client SMS ID Max Limit Exceed), **-10008** (Balance not enough).

`errorcode: 401` with `message: "Unauthorised"` appears nowhere in the specification, and the
documented error codes are all negative. So the response we receive is not produced by the
documented API layer.

---

## 3. The decisive test — credentials are never evaluated

Same endpoint, same host, one request with credentials and one with none:

| # | Request | HTTP | Body |
|---|---------|------|------|
| 1 | `POST /api/v1/smscredit` with `{"user":"…","password":"…"}` | 200 | `{"errorcode":401,"message":"Unauthorised"}` |
| 2 | `POST /api/v1/smscredit` with `{}` — **no credentials at all** | 200 | `{"errorcode":401,"message":"Unauthorised"}` |

**Byte-identical.** If this were an incorrect password, request 2 should have returned the
documented *"Username and password require"*. It did not. The two cases are indistinguishable,
which places the rejection **before** credential checking.

Anyone at NEXAH can reproduce this in one line, with no account needed:

```bash
curl -X POST https://sms.wandatech.net/api/v1/smscredit \
     -H 'Content-Type: application/json' -d '{}'
```

---

## 4. Control group — the same credentials on the documented host

The specification documents the base URL `https://smsvas.com/bulk/public/index.php/api/v1`.
Sending the *same credentials* there produces a completely different, **spec-compliant**
response:

| Host | Endpoint | HTTP | Body |
|------|----------|------|------|
| `smsvas.com` | `/smscredit` | 200 | `{"responsecode":0,"responsedescription":"Error","message":"Invalid username or password"}` |
| `smsvas.com` | `/sendsms` | 200 | `{"responsecode":0,"responsedescription":"error","responsemessage":"Invalid Username or Password","sms":[]}` |
| `sms.wandatech.net` | `/smscredit` | 200 | `{"errorcode":401,"message":"Unauthorised"}` |

`smsvas.com` **parses** the credentials and tells us they are not valid *there* — which is
expected, since our account lives on `sms.wandatech.net`. `sms.wandatech.net` never gets that
far. Both hosts report the same server build (`Apache/2.4.29 (Ubuntu)`), so this is the same
platform behaving differently.

---

## 5. Everything else we ruled out

Every documented and undocumented request shape returns the identical 401. The problem is not
encoding, method, or transport.

| Variation tried | HTTP | Body |
|---|---|---|
| `POST /api/v1/smscredit` — JSON body | 200 | `{"errorcode":401,"message":"Unauthorised"}` |
| `POST /api/v1/smscredit` — form-encoded | 200 | identical |
| `GET /api/v1/smscredit?user=…&password=…` — spec allows GET | 200 | identical |
| `POST /api/v1/sendsms` — JSON, `senderid` + `sms` present | 200 | identical |
| `GET /api/v1/smscredit` + `Authorization: Bearer …` | 200 | identical |
| `GET /api/v1/smscredit` + `apikey: …` header | 200 | identical |
| `POST /api/v1/login` | **401** | identical body |

Note on `/sendsms`: we deliberately omitted the `mobiles` parameter. Per the spec that should
return *"Mobile number require"* — which would have proved authentication succeeded, without
sending a message or consuming credit. We never received it. **No SMS was sent during any of
this testing.**

### The endpoints do exist — they are gated, not missing

| Path | HTTP | Body |
|---|---|---|
| `/api/v1/smscredit` | 200 | `{"errorcode":401,…}` |
| `/api/v1/sendsms` | 200 | `{"errorcode":401,…}` |
| `/api/v1/definitely-not-real` | **404** | `{ "message": ""}` |

A path that does not exist answers 404. Ours answer 200 and then refuse. So routing is fine;
authorisation is what fails.

### One inconsistency worth a look

`/api/v1/smscredit` returns **HTTP 200** carrying an authorisation failure, while
`/api/v1/login` returns **HTTP 401** with the same body. An HTTP 200 for a rejected request
makes this hard for any client to handle correctly — a strict client would read 200 as
success. We would suggest the API return 401 consistently.

---

## 6. A base-URL question

The specification documents `/bulk/public/index.php/api/v1`. On `sms.wandatech.net` that path
returns **404** (an HTML error page, in French), while `/api/v1` responds. We have therefore
been using:

```
https://sms.wandatech.net/api/v1/sendsms
https://sms.wandatech.net/api/v1/smscredit
```

Please confirm this is the correct base URL for a reseller instance. If it is not, that alone
could explain everything above.

---

## 7. What we are asking NEXAH to confirm

1. **Is API access enabled** for `rimskycho@gmail.com` on `sms.wandatech.net`? Web-portal
   login and API access are separate permissions on many installations of this platform.
2. **Does the API use a different credential** from the portal login — an API username, API
   key, or token? If so, please issue it, or tell us where in the portal to generate it. We
   could not find an API section.
3. **What is the correct base URL** for this instance — `/api/v1`, or the documented
   `/bulk/public/index.php/api/v1`?
4. **Is the account active and in credit?** The spec models `accountexpdate` and
   `balanceexpdate`, and lists *Inactive User* (-10019) as an error. If this is a demo or
   trial account that has expired, that would be useful to know.
5. **Is sender ID `MoMoMe` approved** for this account? We expect this to be the next
   requirement once authentication works, and would rather resolve both at once.
6. **Please reproduce the §3 test.** The no-credentials request returning the same 401 is
   server-side and reproducible without our account.

---

## 8. What we have already done on our side

- Verified the host resolves and serves the API over TLS; response times 0.8–1.9 s, no
  timeouts or network faults.
- Confirmed credentials are stored exactly as issued (11 characters, verified by checksum, no
  whitespace or truncation).
- Implemented the documented contract for both `/sendsms` and `/smscredit`, including the
  delivery-receipt webhook from §2.3.
- Built handling for the undocumented `errorcode: 401` shape, because the API returns HTTP 200
  alongside it and a naive client would otherwise treat a refusal as a success.
- Tested every documented request variant, plus header-based authentication schemes that are
  not documented, in case this instance differs.

We are ready to test again the moment the account is corrected — the integration is complete
and waiting.
