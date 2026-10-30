# Message to the Peexit team

*Updated 30 October 2026. The gateway question is settled; this is about disbursements
that are accepted and never executed. Fill in your name before sending.*

## What we observe

Our disbursement requests are **accepted** by the new gateway and then stay at status
`new` indefinitely. Our own re-query of `/disbursement/all_requests?track_id=` returns the
row with `status: "new"` every time, for hours.

| Fact | Value |
| --- | --- |
| Gateway | `https://px-gw-c2810.peexit.com/api/v1` |
| Our egress IP | `152.55.177.87` (the one you whitelisted — allowlist now working) |
| Disbursement balance we can read | **224 832 XAF** — funded |
| Longest request stuck at `new` | **358 minutes** (~6 hours) |
| Affected track_ids | `MMM-2026-418965`, `MMM-2026-418966`, `MMM-2026-418968` |

This is not a connectivity, credential or balance problem on our side, and we have ruled
each out rather than assuming:

- the allowlist works — requests reach your application (403 became 404, then 200)
- the base path is correct — `/api/v1` resolves; `/disbursement/me` returns our balance
- the SECRETKEY is accepted — the balance read authenticates
- the account is funded — 224 832 XAF available, each request is 500 XAF
- we are not mis-reading the status — `new` is a pending state in our mapping, and we
  deliberately hold rather than guess

## What we are asking

1. **Why do accepted disbursements remain at `new`?** Is execution enabled for our account
   on the new gateway, or did that permission not carry over from `server.peexit.com`?
2. **Is there an activation or approval step** on the new platform that we have not
   completed?
3. **What are the terminal statuses** we should expect, and roughly how long should a
   disbursement take to leave `new`?
4. **Please confirm our notification callback** is registered for the new gateway:
   `https://momome-api-production.up.railway.app/webhooks/peexit` (HTTP Basic). We have
   seen no callbacks; we are resolving purely by re-query.

## What we are doing meanwhile

Nothing is double-sent and no customer funds are at risk: a payout with no verdict is held,
never retried blindly, and after 30 minutes it is raised to our operations desk while your
request remains live under the same `track_id`. If you settle any of the above later, our
system will still record it correctly.

---

**Subject: Disbursements accepted but stuck at status `new` for 6 hours (account Umdeny)**

Hello,

Since reconnecting to `px-gw-c2810.peexit.com/api/v1`, our disbursement requests are
accepted by the gateway and then remain at status **`new`** indefinitely — the longest is
now **358 minutes**. Re-querying `/disbursement/all_requests?track_id=` returns the row
each time, still `new`.

Affected track_ids: **MMM-2026-418965, MMM-2026-418966, MMM-2026-418968** (500 XAF each).

We have ruled out our side: the allowlist works (we reach your application), `/api/v1` is
correct, the SECRETKEY authenticates, and our disbursement balance reads **224 832 XAF**.

Could you check whether **disbursement execution is enabled for our account on the new
gateway** — or whether there is an activation step we have missed? If there is an expected
delay before a request leaves `new`, please tell us what it is.

Separately, we have received **no notification callbacks** on the new gateway. Our endpoint
is `https://momome-api-production.up.railway.app/webhooks/peexit` (HTTP Basic, the
credentials previously registered). Please confirm it is configured.

Thank you,

[Your name]
MoMo›Me
