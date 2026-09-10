/* Read-only IBEX inspection: accounts + balances, the stablecoin receive addresses and the
   most recent transactions on each account. Prints no credentials. Run with the service's
   env injected:  railway run --service momome-api -- npx tsx scripts/ibex-inspect.ts */
import { config } from "../src/config.js";

async function token(): Promise<string> {
  const r = await fetch(config.ibex.authUrl, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.ibex.clientId, client_secret: config.ibex.clientSecret, audience: config.ibex.audience }),
  });
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error(`auth failed ${r.status}`);
  return j.access_token;
}
async function get(t: string, path: string): Promise<string> {
  const r = await fetch(`${config.ibex.apiUrl}${path}`, { headers: { Authorization: t } });
  const body = await r.text();
  return `${r.status} ${path}\n${body.slice(0, 1800)}`;
}
const t = await token();
console.log(await get(t, "/v2/account"));
for (const [label, acct] of [["USDC", config.ibex.usdcAccountId], ["USDT", config.ibex.usdtAccountId], ["BTC", config.ibex.accountId]] as const) {
  if (!acct) { console.log(`${label}: not configured`); continue; }
  console.log(`\n===== ${label} account ${acct.slice(0, 8)}…`);
  for (const p of [`/accounts/${acct}/crypto/receive-infos`, `/v2/transaction?accountId=${acct}&limit=20`, `/transactions?accountId=${acct}&limit=20`, `/v2/account/${acct}/transactions?limit=20`]) {
    console.log(await get(t, p));
  }
}
