/* Peex auth — verify the API key is live. */
import { config } from "../../config.js";
import { PeexClient } from "./client.js";

export async function verifyKey(): Promise<{ valid: boolean; detail: string }> {
  if (config.peex.mode === "off") return { valid: false, detail: "disabled" };
  if (config.peex.mode === "sandbox") return { valid: true, detail: "sandbox key" };
  // live ---- CONFIRM endpoint against Peex docs (e.g. GET /v3/api-key) ----
  try {
    const res = await new PeexClient().get("/v3/api-key");
    return { valid: res.ok, detail: res.ok ? "active" : `status ${res.status}` };
  } catch (e) {
    return { valid: false, detail: e instanceof Error ? e.message : "unreachable" };
  }
}
