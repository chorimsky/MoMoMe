# Message to the Peexit team

*Updated 29 October 2026, after testing the new gateway end to end and confirming our own
egress address. Fill in your name before sending.*

## What we established on our side

| Layer | Result |
| --- | --- |
| DNS — `px-gw-c2810.peexit.com` | resolves: `18.236.19.78`, `32.190.82.249` |
| TCP + TLS | completes normally |
| HTTP | **403** from `server: awselb/2.0`, on every path |
| With vs without `SECRETKEY` | identical — the refusal is before any application logic |
| GET vs POST, any `Host` header, either ALB IP | identical |
| From our production egress (`152.55.177.87`) | **also 403** |

Our outbound address is `152.55.177.87` — the exact IP Peexit whitelisted for us. It has
not changed. So this is a blanket deny at their load balancer, and nothing on our side
changes it.

One caveat worth stating: we measure our egress address by asking an IP-echo service, and
that is the address a request *to that service* leaves from. If the platform routes to
different destinations through different NAT addresses, the IP Peexit's load balancer sees
could differ. Only their logs can settle it — which is why that is the first question.

---

**Subject: 403 on px-gw-c2810 from the IP you whitelisted (account Umdeny)**

Hello,

We've moved to `https://px-gw-c2810.peexit.com/api` and every request returns **403** from
your load balancer (`server: awselb/2.0`) — on every path, with and without our SECRETKEY,
so it is being refused before it reaches your application.

We've confirmed our outbound address is **152.55.177.87**, the exact IP you whitelisted for
us, and it has not changed.

Three things would unblock us:

1. **Which source IP do you see on the rejected requests?** Your ALB logs will show it.
   That is the one fact we cannot determine from outside, and it settles immediately
   whether the allowlist entry is simply attached to the wrong place.
2. **Please confirm the allowlist for 152.55.177.87 is applied to the new gateway.** We
   suspect it is still attached to the retired `server.peexit.com`.
3. **Please confirm the base path** — should our calls be
   `/api/disbursement/request_payment` or `/api/v1/disbursement/request_payment`? We cannot
   test this ourselves: the 403 happens before routing, so every path looks identical.

Once we are reconnected we will also want to confirm the notification callback credentials
and whether our SECRETKEY is unchanged — but those can wait until traffic flows.

Thank you,

[Your name]
MoMo›Me
