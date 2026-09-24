# NEXAH BulkSMS — phone number verification

NEXAH carries **one-time codes only**. It is deliberately not registered as a general
notification channel: payment notices keep going through the generic `SMS_WEBHOOK_URL`
gateway, WhatsApp and push, exactly as before. Verification is the flow that fails hardest
when SMS fails — merchant verification, "own your number" and account claim all dead-end at
a code that never arrives — so it is the flow that gets a rail able to say whether the code
actually reached the handset.

Spec: *SMS-API Interfaces* (NEXAH). Implementation: [`server/src/adapters/nexah.ts`](../server/src/adapters/nexah.ts).

## What changes

Nothing, until it is configured. Unconfigured, `nexahConfigured()` is false and the OTP path
uses whatever it used before.

Configured, a one-time code sent by SMS goes through NEXAH, and three things follow:

- **The outbox can say "delivered", not just "sent".** NEXAH returns a `messageid` per
  recipient, and later POSTs a delivery receipt naming it. That lands on the existing
  `updateDelivery()`, which the WhatsApp channel has always used and SMS never could. An
  `UNDELIV` marks the code **failed**, because a verification flow that looks fine while the
  code never lands is the failure this exists to expose.
- **Running out of credit is visible before it bites.** Admin → Notifications shows the
  remaining credit and its expiry, and flags it below a floor. A balance that could not be
  read shows as *unknown*, never as zero.
- **Refusals are named.** The documented error codes (`-10019` inactive user, `-10003`
  invalid number, `-10026` client id limit, `-10008` balance not enough) are reported rather
  than collapsed into "send failed".

## Configuration

| Variable | |
|---|---|
| `NEXAH_USER` | NEXAH login. |
| `NEXAH_PASSWORD` | NEXAH password. |
| `NEXAH_SENDER_ID` | The sender name, **registered and approved with the operators**. An unapproved one is refused outright (`Invalid senderid`). |
| `NEXAH_DLR_SECRET` | An unguessable path segment for the delivery-receipt URL. |
| `NEXAH_API_URL` | The **whole base, including the version segment**. The published spec documents `https://smsvas.com/bulk/public/index.php/api/v1`; a hosted instance may serve the same API at `https://<host>/api/v1` instead — on `sms.wandatech.net` the `/bulk/public/index.php` form returns 404. A base with no version segment is completed with `/api/v1` rather than guessed at. |
| `NEXAH_DIAL` | Dialling code prepended to a 9-digit local number. Defaults to `237`. |
| `NEXAH_LOW_CREDIT` | Credit floor for the console warning. Defaults to `200`. |

All three of user, password and sender id must be present, or the rail reports itself
unconfigured rather than failing one message at a time.

## Deployments do not all speak the same dialect

The spec documents one envelope. A hosted instance can answer a rejection with **HTTP 200**
and a different shape entirely:

```
POST https://sms.wandatech.net/api/v1/sendsms  {}
→ HTTP 200  {"errorcode":401,"message":"Unauthorised"}
```

No `responsecode` at all. Read as the documented envelope, that became a bare "NEXAH refused
the request" and threw away the one word that says what is wrong. Both shapes are now
understood, and an **unrecognised** shape is still treated as a failure — never as a success,
which would mean claiming a code was sent when it was not.

## Proving the account works before a customer finds out it does not

`Admin → Notifications → SMS ACCOUNT → Check credentials`
(`GET /admin/notifications/sms-check`, Super Admin) asks the provider for the account's
credit. That authenticates **without sending anything**: no SMS is spent and no customer is
involved. It separates the three states an operator otherwise has to guess between —

- not configured (and it names which variable is missing),
- configured but rejected (wrong user, password or base URL),
- working (with the credit remaining, and a warning if SMS is switched off in
  Settings → Channels, which stops codes just as effectively as a bad password).

It never returns the credential, only what the provider said about it.

## The delivery-receipt URL to register with NEXAH

```
https://<your-host>/webhooks/sms/nexah/<NEXAH_DLR_SECRET>
```

**NEXAH does not sign these callbacks.** Two things stand in a stranger's way, and it is
worth being clear that neither is a signature:

1. the secret in the path, compared in constant time;
2. the fact that a receipt is only ever applied to a message id **we** issued — a receipt
   naming anything else is accepted with `status: 1` (as the spec requires) and changes
   nothing.

A forged receipt can therefore at worst claim delivery for a code we really did send. It
cannot create an outbox row, reveal a code, or move money. If NEXAH will tell you the IP
addresses their callbacks originate from, add them to the egress/ingress allowlist as well.

## Two things the spec offers that this deliberately does not use

- **The GET form of `sendsms` and `smscredit`.** Both carry `password=` in the query string,
  which ends up in proxy logs, access logs and referrer headers. Only POST is implemented, at
  any call site.
- **Bulk send.** `mobiles` accepts a comma-separated list and returns a per-recipient array.
  The adapter sends one number at a time because verification is one number at a time.
  Nothing about the parsing would need to change to fan out later.

## Operator-owned before this sends anything

- A NEXAH account, and its credentials set on the server (never in source).
- A sender ID registered and approved with MTN and Orange.
- The delivery-receipt URL above registered with NEXAH.
- Enough credit. `Admin → Notifications` shows what is left; below the floor, top up.

## Tests

`server/test/nexah.test.ts` (41 assertions): the request shape actually sent (POST, country
code, registered sender id), every documented error code, unknown-not-zero credit, that the
code never reaches the outbox body but its message id does, that the wrong secret changes
nothing, that a malformed body is a 400 rather than a 500, that a receipt for an unknown id
is a no-op, that `DELIVRD` / `UNDELIV` move the record to delivered / failed, that a
200-with-`errorcode` rejection is read as a failure carrying the provider's own word, and
that the credential check separates not-configured from rejected from working without
sending anything.
