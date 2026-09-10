#!/usr/bin/env node
/* ============================================================
   Upload an Android App Bundle to a Google Play track with a USER login instead of a
   service-account key.

   Why this exists: the usebitbank.com organisation forbids service-account keys
   (iam.disableServiceAccountKeyCreation), so `eas submit -p android` cannot be used.
   The Play Developer API also accepts OAuth user credentials, and a Play Console user
   with release rights (cho@usebitbank.com) can upload through it. This script does the
   OAuth "installed app" flow once, keeps the refresh token in a gitignored file, and
   then drives the edits API: insert edit → upload bundle → set track → commit.

   Files (all gitignored, never printed):
     mobile/google-play-oauth-client.json  — the OAuth client downloaded from Google Cloud
     mobile/google-play-oauth-token.json   — refresh token written after the first consent

   Usage:
     node scripts/play-upload.mjs --aab path/to/app.aab [--track internal] [--package momome.app]
     node scripts/play-upload.mjs --version-code 4 --track production   # bundle already uploaded: only move the track
     node scripts/play-upload.mjs --version-code 4 --track internal --notes-en "..." --notes-fr "..."   # (re)set release notes
     node scripts/play-upload.mjs --auth-only          # just obtain/refresh the token
     node scripts/play-upload.mjs --status             # what each track currently holds
   ============================================================ */
import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setDefaultResultOrder } from "node:dns";

// This Mac resolves Google hosts to IPv6 addresses that then time out ("fetch failed",
// UND_ERR_SOCKET). curl is fine; Node needs to be told to try IPv4 first.
setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_FILE = resolve(here, "../google-play-oauth-client.json");
const TOKEN_FILE = resolve(here, "../google-play-oauth-token.json");
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const AAB = opt("--aab");
const TRACK = opt("--track", "internal");
const PACKAGE = opt("--package", "momome.app");
const AUTH_ONLY = args.includes("--auth-only");
const STATUS = args.includes("--status");    // print every track's releases and exit
const VERSION_CODE = opt("--version-code"); // set the track to a bundle Play already holds
const NOTES_EN = opt("--notes-en");        // release notes shown to testers / on the store listing
const NOTES_FR = opt("--notes-fr");

async function readJson(p) { return JSON.parse(await readFile(p, "utf8")); }

async function loadClient() {
  const raw = await readJson(CLIENT_FILE).catch(() => { throw new Error(`Missing ${CLIENT_FILE}. Download the OAuth client JSON from Google Cloud → Clients and save it there.`); });
  const c = raw.installed ?? raw.web ?? raw;
  if (!c.client_id) throw new Error("OAuth client file has no client_id.");
  return { id: c.client_id, secret: c.client_secret ?? "" };
}

/* One-time consent. Opens a loopback listener, prints the URL to open, receives the code. */
async function obtainRefreshToken(client) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(8).toString("hex");
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const redirect = `http://127.0.0.1:${port}/`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: client.id, redirect_uri: redirect, response_type: "code", scope: SCOPE,
    access_type: "offline", prompt: "consent", code_challenge: challenge, code_challenge_method: "S256", state,
  }).toString();
  console.log("\nOpen this URL in the browser that is signed in to Play Console, and approve:\n\n" + url.toString() + "\n");
  const code = await new Promise((resolveCode, reject) => {
    server.on("request", (req, res) => {
      const u = new URL(req.url, redirect);
      if (u.searchParams.get("state") !== state) { res.statusCode = 400; res.end("bad state"); return; }
      const err = u.searchParams.get("error");
      if (err) { res.end("Authorisation refused. You can close this tab."); reject(new Error(err)); return; }
      res.end("MoMo›Me: authorised. You can close this tab.");
      resolveCode(u.searchParams.get("code"));
    });
    setTimeout(() => reject(new Error("Timed out waiting for consent (10 min).")), 10 * 60_000);
  });
  server.close();
  const body = new URLSearchParams({ client_id: client.id, client_secret: client.secret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const j = await r.json();
  if (!j.refresh_token) throw new Error(`Token exchange failed: ${JSON.stringify({ error: j.error, description: j.error_description })}`);
  await writeFile(TOKEN_FILE, JSON.stringify({ refresh_token: j.refresh_token, obtained_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`Refresh token saved to ${TOKEN_FILE} (never commit it).`);
  return j.refresh_token;
}

async function accessToken(client) {
  const saved = await readJson(TOKEN_FILE).catch(() => null);
  const refresh = saved?.refresh_token ?? await obtainRefreshToken(client);
  const body = new URLSearchParams({ client_id: client.id, client_secret: client.secret, refresh_token: refresh, grant_type: "refresh_token" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  const j = await r.json();
  if (!j.access_token) throw new Error(`Could not refresh access token: ${j.error} ${j.error_description ?? ""}. Delete ${TOKEN_FILE} and run again to re-consent.`);
  return j.access_token;
}

async function api(token, path, init = {}) {
  const r = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await r.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${r.status}: ${j.error?.message ?? text.slice(0, 300)}`);
  return j;
}

async function main() {
  const client = await loadClient();
  const token = await accessToken(client);
  if (AUTH_ONLY) { console.log("Authorised."); return; }
  if (STATUS) {
    const e = await api(token, "edits", { method: "POST", body: "{}" });
    const tracks = await api(token, `edits/${e.id}/tracks`);
    for (const tr of tracks.tracks ?? []) for (const r of tr.releases ?? []) console.log(`${tr.track}: v${(r.versionCodes ?? []).join(",")} ${r.status}${r.name ? ` (${r.name})` : ""}`);
    await api(token, `edits/${e.id}`, { method: "DELETE" }).catch(() => {});
    return;
  }
  if (!AAB && !VERSION_CODE) throw new Error("--aab <file> or --version-code <n> is required.");

  const edit = await api(token, "edits", { method: "POST", body: "{}" });
  let versionCode = VERSION_CODE;
  if (AAB) {
    const size = (await stat(AAB)).size;
    console.log(`Edit ${edit.id} opened. Uploading ${AAB} (${(size / 1e6).toFixed(1)} MB)…`);
    const up = await fetch(`https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`, {
      method: "POST", duplex: "half",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Content-Length": String(size) },
      body: createReadStream(AAB),
    });
    const bundle = await up.json();
    if (!up.ok) throw new Error(`Bundle upload failed ${up.status}: ${bundle.error?.message ?? JSON.stringify(bundle).slice(0, 300)}`);
    console.log(`Uploaded. versionCode ${bundle.versionCode}, sha256 ${bundle.sha256}`);
    versionCode = String(bundle.versionCode);
  } else {
    console.log(`Edit ${edit.id} opened. Using already-uploaded versionCode ${versionCode}.`);
  }

  await api(token, `edits/${edit.id}/tracks/${TRACK}`, {
    method: "PUT",
    body: JSON.stringify({ track: TRACK, releases: [{
      versionCodes: [String(versionCode)], status: "completed",
      ...(NOTES_EN || NOTES_FR ? { releaseNotes: [
        ...(NOTES_EN ? [{ language: "en-US", text: NOTES_EN }] : []),
        ...(NOTES_FR ? [{ language: "fr-FR", text: NOTES_FR }] : []),
      ] } : {}),
    }] }),
  });
  console.log(`Track "${TRACK}" set to versionCode ${versionCode} (completed).`);

  const done = await api(token, `edits/${edit.id}:commit`, { method: "POST", body: "{}" });
  console.log(`Committed edit ${done.id}. Play Console should now show ${versionCode} on ${TRACK}.`);
}

main().catch((e) => { console.error("play-upload:", e.message); process.exit(1); });
