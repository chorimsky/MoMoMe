/* ============================================================
   Push tokens — the ONE way to reach a sender.

   The account is the device: there is no email, no phone we may text. A sender learns that
   their money landed only while the app is open and polling. A push token registered by
   the app changes that: "Delivered · 10 000 XAF to NANA JEAN PAUL" arrives whether or not
   the app is in the foreground. Tokens are Expo push tokens (the app talks to the Expo
   push service; APNs/FCM sit behind it), keyed by the device sender id, one per device.

   A token is data about a person's device: it goes with the account on deletion, and a
   token the push service reports as dead (DeviceNotRegistered) is dropped on the spot.
   ============================================================ */
import { register, touch } from "./persist.js";

export interface PushToken {
  senderId: string;
  token: string;
  platform: "ios" | "android" | "web" | "unknown";
  lang: "en" | "fr";
  updatedAt: string;
}

const bySender = new Map<string, PushToken>();
register("push_tokens", () => [...bySender.values()], (list: PushToken[]) => { for (const t of list) bySender.set(t.senderId, t); });

const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,}\]$/;
export function validPushToken(t: unknown): t is string { return typeof t === "string" && EXPO_TOKEN.test(t); }

export function setPushToken(senderId: string, token: string, platform: PushToken["platform"], lang: PushToken["lang"]): PushToken {
  const rec: PushToken = { senderId, token, platform, lang, updatedAt: new Date().toISOString() };
  bySender.set(senderId, rec);
  touch("push_tokens");
  return rec;
}
export function clearPushToken(senderId: string): boolean {
  const had = bySender.delete(senderId);
  if (had) touch("push_tokens");
  return had;
}
export function pushTokenFor(senderId: string): PushToken | undefined { return bySender.get(senderId); }
/** The push service said this token is dead — forget it so we stop trying. */
export function dropDeadToken(token: string): void {
  for (const [k, v] of bySender) if (v.token === token) { bySender.delete(k); touch("push_tokens"); }
}
export function pushTokenCount(): number { return bySender.size; }
