import { config } from "../src/config.js";
async function token(): Promise<string> {
  const r = await fetch(config.ibex.authUrl, { method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", client_id: config.ibex.clientId, client_secret: config.ibex.clientSecret, audience: config.ibex.audience }) });
  return ((await r.json()) as { access_token: string }).access_token;
}
async function get(t: string, path: string): Promise<string> {
  const r = await fetch(`${config.ibex.apiUrl}${path}`, { headers: { Authorization: t } });
  return `${r.status} ${path}\n${(await r.text()).slice(0, 2500)}`;
}
const t = await token();
const usdc = config.ibex.usdcAccountId;
for (const p of [
  "/v2/transaction/24eac4e5-302e-43c2-98b9-1157bc62e91a",
  "/v2/transaction/24eac4e5-302e-43c2-98b9-1157bc62e91a/details",
  `/accounts/${usdc}/crypto/receive-infos/245719fa-b69a-40b7-aeb2-f52ef6185617`,
  `/accounts/${usdc}/webhooks`,
  `/accounts/${config.ibex.accountId}/webhooks`,
  `/transactions?accountId=${usdc}&limit=50&transactionTypeId=9`,
]) console.log(await get(t, p), "\n");
