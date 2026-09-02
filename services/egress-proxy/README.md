# Egress proxy — a fixed IP for Peexit

Peexit production authenticates on the **source IP**: `server.peexit.com` returns an nginx
403 to any non-allowlisted source *regardless of the SECRETKEY*. The settlement backend runs
on Vercel serverless, which egresses from a large rotating pool — there is no address to
register. That is what silently broke every production payout when the backend moved off
Railway, and it was misreported as "insufficient_rail_balance".

This service is the fixed address. Railway gives it a Static Outbound IP; the backend routes
Peexit calls through it; Peexit allowlists that one address.

    Vercel (rotating IPs) ──► this proxy on Railway (ONE static IP) ──► server.peexit.com

## Why it is not an open relay

It sits on a public host, and anything it forwards arrives at Peexit **from the address they
trust**. Two independent gates:

1. **`Proxy-Authorization` required** on every request (Basic, compared in constant time).
2. **Destination allowlist.** Even with the credential it will only reach `ALLOWED_HOSTS`.
   A leaked credential buys an attacker a tunnel to Peexit's own API — which still needs the
   SECRETKEY they don't have.

It refuses to start at all if `PROXY_USER`/`PROXY_PASS` are unset, so it cannot be deployed
open by accident.

## Deploy

1. **Create the service** in the `momome` Railway project, Root Directory `services/egress-proxy`.
2. **Set variables** (choose a long random password — the app never needs to know it, only
   this service and the Vercel backend):

       PROXY_USER=momome
       PROXY_PASS=<long random string>
       ALLOWED_HOSTS=server.peexit.com

3. **Enable the static IP**: service → Settings → Networking → *Enable Static IPs*
   (Pro plan). Note the IPv4 it gives you. It stays constant across deploys.
4. **Point the backend at it** — on the Vercel **server** project:

       PEEXIT_PROXY_URL=http://momome:<PROXY_PASS>@<STATIC_IP>:8080

5. **Register the static IP with Peexit**, then set on the same Vercel project:

       EGRESS_ALLOWLISTED_IP=<STATIC_IP>

6. **Confirm** in the admin console → Rails. It should read
   *"Peexit egresses through the proxy as \<IP\>, which matches the allowlisted address.
   Correctly configured."*
   If it says the proxy did not answer, the tunnel is not carrying traffic and no Peexit
   call will succeed.

## Notes

- Railway does not guarantee the static IPv4 is *dedicated* — it may be shared with other
  Railway customers. That is fine for allowlisting (we need it stable, not exclusive), but
  it is not an identity control: the SECRETKEY still does the authenticating.
- `ALLOWED_HOSTS` accepts a comma-separated list; a host matches exactly or as a subdomain.
- Health check: `GET /healthz` → `{"ok":true,"allowed":[...]}`.
