# Peexit API — `server.peexit.com` and `sandbox.peexit.com` do not resolve

**For:** Peexit technical support
**From:** momome (Bitbase Technologies Incorporated) — `contact@bitbasetechnology.com`
**Evidence captured:** 2026-10-20

---

## 1. Summary

Both API hostnames in our integration return **NXDOMAIN** — they are absent from DNS, not
unreachable:

```
server.peexit.com    → NXDOMAIN
sandbox.peexit.com   → NXDOMAIN
```

Every request fails in 30–70 ms, which is resolution failing, not a network timeout and not a
rejected credential. **This is not our SECRETKEY and not our egress IP** — a request that
cannot resolve a hostname never reaches your allowlist to be refused by it.

## 2. The zone itself is healthy

| Name | Result |
|---|---|
| `peexit.com` | `32.188.229.100`, `100.23.42.72` — NOERROR |
| `app.peexit.com` | 4 CloudFront addresses — NOERROR |
| `dashboard.peexit.com` | exists (CloudFront) |
| `server.peexit.com` | **NXDOMAIN** |
| `sandbox.peexit.com` | **NXDOMAIN** |
| `api.peexit.com`, `gateway.peexit.com`, `pay.peexit.com` | NXDOMAIN |

NS and SOA for `peexit.com` answer normally. So the zone is being served; these two records
are simply not in it.

## 2b. Your own documentation still points at one of them

`https://peex-api-docs.peexit.com` resolves and serves normally, and the **Base URL** it
publishes for the sandbox is:

```
https://sandbox.peexit.com/api/v1/
```

That is one of the two hostnames returning NXDOMAIN. So the address in your live
documentation cannot be reached by anybody, which is why we do not think this is our
configuration.

## 3. Confirmed at your own authoritative nameserver

NXDOMAIN is returned by Google Public DNS (`8.8.8.8`) **and** by the authoritative Route 53
nameserver for the zone, `ns-629.awsdns-14.net`. An authoritative NXDOMAIN is definitive: it
is not caching, not a resolver, and not our network.

Reproducible from anywhere, no account needed:

```bash
dig +noall +comments server.peexit.com @ns-629.awsdns-14.net
```

## 4. What this costs us

Peexit is one of our two Mobile Money payout rails, and the only provider that can **name**
the holder of a number. With it unreachable:

- payouts route entirely to the other rail, with no failover left if that one degrades;
- recipient verification falls through to an aggregator that can only confirm a number is
  reachable, so senders are shown "this number can't be verified yet" and keep paying.
  Mobile Money does not reverse.

## 5. What we are asking

1. Were `server.peexit.com` / `sandbox.peexit.com` **retired or renamed?** If there is a new
   base URL, send it — our integration takes it as configuration (`PEEXIT_API_URL`), so we
   can switch with no code change and no release.
2. If they were **not** retired, the DNS records are missing and need restoring.
3. Confirm the current production **and** sandbox base URLs, and whether the IP allowlist
   still applies to them.

Our integration is complete and tested against the documented contract — disbursement,
collection, and the Basic-Auth notification callback. The moment the hostname resolves we can
verify end to end.
