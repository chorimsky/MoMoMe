# Message to the Peexit team — Orange disbursements

*Written 30 October 2026. This supersedes the "stuck at `new`" message for the Orange half:
MTN disbursements are now settling on the same account, the same gateway and the same
credentials. Only Orange does not. Fill in your name and the track_ids before sending.*

## What changed since the last message

The earlier report said disbursements were accepted and never executed. That is now true of
**Orange only**. MTN disbursements submitted the same way, to the same endpoint, on the same
account, are reaching a terminal status and paying out.

That asymmetry is the whole message: it rules out our connectivity, our credentials, our
egress IP, our balance and our request shape, because MTN requests travel all of them and
succeed.

## The request we send is operator-agnostic

We call `POST /disbursement/request_payment` with an identical body shape for both
operators. **We never name the operator** — per your documentation the network is detected
from the recipient number, and we send no correspondent or network code:

```
amount, track_id, mobile_phone, currency, country,
sender_first_name, sender_last_name, sender_mobile_phone,
first_name, last_name, purpose, fund_origin
```

The only field that differs between a working MTN payout and a stuck Orange one is
`mobile_phone`. We send a bare 9-digit national number with no `237` prefix and no leading
zero, for both operators alike — e.g. `6XXXXXXXX`. Cameroon allocates `655-659`, `69X` and
`685-689` to Orange, and we classify strictly on that.

## What we observe

| Fact | MTN | Orange |
| --- | --- | --- |
| Submitted | *(fill in)* | *(fill in)* |
| Reached a terminal status | *(fill in)* | **0** |
| Still at `new` | 0 | *(fill in)* |
| Oldest still at `new` | — | *(fill in)* minutes |

Our re-query of `/disbursement/all_requests?track_id=` returns the Orange rows every time,
still `new`. We receive no notification callbacks for them.

Affected Orange track_ids: *(fill in)*
Working MTN track_ids for comparison: *(fill in)*

Account: Umdeny · Gateway: `https://px-gw-c2810.peexit.com/api/v1` · Egress IP:
`152.55.177.87` (allowlisted and working) · Disbursement balance: funded, shared across
operators on our account.

## What we are asking

1. **Is Orange disbursement enabled for our account** on this gateway? MTN clearly is. If
   Orange is a separate permission, product or float, please tell us what to activate.
2. **Does your network auto-detection recognise the Orange prefixes above** from a bare
   9-digit number? If Orange requires a different number format, or an explicit network or
   correspondent field that MTN does not, tell us and we will send it.
3. **Is there a separate Orange float** we need to fund? Our account reports one shared
   `disbursement_solde`, which reads as funded.
4. **What should we expect an Orange disbursement to do** — which terminal statuses, and
   over what period — so we can tell "slow" from "never".
5. Please confirm our callback is registered for this gateway:
   `https://momome-api-production.up.railway.app/webhooks/peexit` (HTTP Basic). We have seen
   no callbacks on either operator and are resolving purely by re-query.

## What we are doing meanwhile

Nothing is double-sent and no customer funds are at risk. An Orange payout with no verdict
is held, never retried blindly, and after 30 minutes it is raised to our operations desk
while your request stays live under the same `track_id`. If you settle any of them later,
our system will record it correctly. We have routed what we can to another rail; Orange
currently has no alternative, which is why this is urgent for us.

---

**Subject: Orange disbursements stay at `new` while MTN settles — same account, same gateway (Umdeny)**

Hello,

Following our earlier report: MTN disbursements are now settling normally on
`px-gw-c2810.peexit.com/api/v1`. **Orange disbursements on the same account, submitted the
same way, never leave status `new`.** The oldest has been there *(fill in)* minutes, and
re-querying `/disbursement/all_requests?track_id=` returns it still `new`.

Because MTN works on the same credentials, the same allowlisted egress IP and the same
balance, this does not look like connectivity, authentication or funding on our side.

We send an identical request body for both operators and never name the network — per your
documentation it is detected from the recipient number. The only difference is the number
itself: a bare 9-digit national number, no `237`, no leading zero, with Orange prefixes
`655-659`, `69X` and `685-689`.

Could you check:

1. whether **Orange disbursement is enabled** for our account on this gateway, as MTN is;
2. whether Orange needs a **different number format or an explicit network field** that MTN
   does not;
3. whether there is a **separate Orange float** to fund — we see one shared
   `disbursement_solde`, which is funded.

Affected Orange track_ids: *(fill in)*. Working MTN track_ids: *(fill in)*.

Also, we still receive **no notification callbacks** on either operator. Our endpoint is
`https://momome-api-production.up.railway.app/webhooks/peexit` (HTTP Basic, the credentials
previously registered). Please confirm it is configured.

Thank you,

[Your name]
MoMo›Me
