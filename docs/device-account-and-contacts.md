# Device-as-Account & Encrypted Contacts — Design Spec

Status: **Draft for review** (no code yet)
Owner: MoMo›Me
Decisions locked with product: device + phone-anchor recovery · signed device keypair · E2E-encrypted contacts.

---

## 1. Purpose

Give customers a **contact book** (save / manage / retrieve the people they pay) and a
**device-is-the-account** identity: no email, no password, no signup screen — the credential
lives on the device and *is* the account, with the **phone number** as the durable recovery anchor.

This spec is written to be reviewed and argued with **before** implementation.

---

## 2. Where we are today (grounded in code)

Two identities already exist; they're just not cryptographic, not durable, and not connected.

**Sender identity — device, anonymous**
- `mm_sender_id` = a random UUID in `localStorage`, sent as `X-MM-Sender` on every request.
  - Client: [`ensureSenderId()` / header](../app/src/api/client.ts) (`SENDER_KEY`, lines ~37–63).
  - Server: [`senderOf()`](../server/src/routes/api.ts) (~line 230), scoping in
    [`mayViewPayment`](../server/src/routes/api.ts) (~244) and payment attribution (~492).
- **Weaknesses**: bearer-only (anyone with the value is you); lost on cleared storage / new device;
  private mode collapses everyone into a single shared `"anon"` bucket (client.ts ~line 44).

**Recipient identity — phone, custodial**
- On first inbound payment a custodial financial identity is provisioned, keyed by phone number
  ([`identity.ts`](../server/src/core/identity.ts): "the number IS the account"); claimable by OTP
  ([claim endpoints](../server/src/routes/api.ts) ~384–405; UI [`Claim.tsx`](../app/src/pages/Claim.tsx)).
- Holds value (custodial Lightning wallet) → already gated by OTP.

**Contacts today = a projection of payment history (no real book)**
- "Recent recipients" are derived by scanning the sender's own payments, deduped by phone, newest 5:
  [`GET /me/recipients`](../server/src/routes/api.ts) (~594).
- Device contact **picker**: [`pickContact`](../app/src/pages/send/steps.tsx) (~67) uses the Web
  Contacts API on Android/Chrome; iOS/desktop falls back to focusing the field for OS tel-autofill.
  Nothing is stored.
- **No** add-without-paying, rename, delete, favorite, note, or cross-device retrieval.

---

## 3. Goals / non-goals

**Goals**
1. Real contact book: add (manual + device picker), edit, delete, favorite, note, reorder.
2. Device = account: frictionless, no signup/login screens, proof-of-possession (not bearer).
3. Portability: a phone-anchor lets a new device reclaim the account (history + contacts).
4. E2E-encrypted contacts: the server cannot read contact labels/notes.
5. Reach: must work on cheap Android + patchy 2G/3G; degrade gracefully, no hard biometric requirement.

**Non-goals (for v1)**
- Passwords / email accounts. - Social login. - Passkeys (kept as optional future polish).
- E2E-encrypting the *payment ledger* (the server necessarily processes payments; see §6.1).

---

## 4. Model overview — three layers, cleanly separated

| Layer | What it is | Auth | Recoverable by | E2E? |
|---|---|---|---|---|
| **Device credential** | keypair on this device | signs requests | re-issued after phone-OTP | n/a |
| **Account** (payments, history) | server-side records | device credential + phone-anchor | **phone OTP** | No (server processes payments) |
| **Contact vault** (names, notes, unpaid contacts) | encrypted blobs | vault key (VMK) | device-transfer **or** recovery code | **Yes** |

The mental model: **Device = the daily key. Phone = the account anchor. Vault key = the privacy key.**
The account/history recover with your phone; the *private labels/notes* recover with a device or a
recovery code — deliberately **not** with the phone alone (§6.4 explains why).

---

## 5. Identity & auth spec

### 5.1 Device credential
On first launch ("signup", silent):
- Generate **two** non-extractable keypairs in **IndexedDB** (survives better than localStorage; holds `CryptoKey`s):
  - `authKey`: ECDSA P-256 — signs requests / a login challenge.
  - `wrapKey`: ECDH P-256 — receives the wrapped vault key (§6.3). (WebCrypto needs a separate key for ECDH.)
- POST the two **public** keys → server mints a `DeviceAccount { deviceId, authPub, wrapPub, createdAt, phoneAnchorId? }`.

### 5.2 Login = automatic, proof-of-possession
- Option A (simplest): each request carries `X-MM-Device: <deviceId>` + `X-MM-Sig: <ECDSA(sig over method+path+body-hash+timestamp)>`. Server verifies against `authPub`. Replaces today's bearer header.
- Option B: exchange one signed challenge for a short-lived session token; send the token per request. Fewer signatures on 2G. **Recommend B** for battery/latency, with A as fallback.
- Fixes the bearer weakness: stealing the id is useless without the private key (non-extractable, never leaves the device).

### 5.3 Phone-anchor (portability) — reuses existing OTP
- Optional, offered as "**Make this my account**" (or prompted after first successful payment).
- Verify the user's **own** number via the existing OTP path ([claim endpoints](../server/src/routes/api.ts) ~384).
- Server links `DeviceAccount.phoneAnchorId = identity(phone)`. This **unifies** the two identities: the
  sender's device-account and the recipient's phone-identity become the *same* account when it's your number.
- Multiple devices can anchor to one phone → multi-device.

### 5.4 The `anon` fix (do regardless)
- If IndexedDB/localStorage is blocked, generate an **in-memory session credential** instead of the shared
  global `"anon"` bucket, so private-mode users never see each other's data. History simply won't persist.

### 5.5 Migration from today's UUID (don't orphan anyone)
- On upgrade, if `mm_sender_id` exists: generate keypairs, register the device, and pass the **old UUID** in
  registration so the server **re-attributes** existing payments (`senderId == oldUuid`) to the new `deviceId`.
  Existing "recents" keep working seamlessly.

---

## 6. Contacts spec (E2E)

### 6.1 Right-size the encryption — what's actually private?
Contacts hold `{ name/label, phone, country, provider, note, favorite }`. Crucially:
- **Phone numbers of people you've paid are already known to the server** (they're in the payment ledger).
  E2E-encrypting *those* numbers is largely theatre.
- Genuinely private and **not otherwise known** to the server: **custom labels/notes**, and **contacts you
  saved but never paid**.

→ **Decision:** the encrypted vault protects **labels, notes, and unpaid contacts**. Numbers you've
transacted remain visible to the server via payments (unavoidable). This right-sizes the crypto and keeps
the "send again" projection working without decryption on the server.

### 6.2 Data model
```
Contact (client-side plaintext) {
  id: uuid, name, e164, country, provider,
  favorite: bool, note?: string,
  source: 'manual' | 'picker' | 'payment',
  lastPaidAt?: iso, createdAt: iso, updatedAt: iso
}

VaultRecord (what the server stores — opaque) {
  recordId: uuid,            // random, not derived from phone (no leakage)
  deviceAccountId,           // owner scope
  ciphertext: base64,        // AES-256-GCM(VMK, JSON(Contact))
  iv: base64, ver: int,      // per-record IV + schema version
  updatedAt: iso, deleted: bool   // tombstones for sync
}
```
Server sees only ciphertext + timestamps. Ordering/favorite/search happen **client-side** after decrypt.

### 6.3 Vault key (VMK) management — envelope encryption
- **VMK** = AES-256-GCM key, generated once on the first device. Encrypts every `Contact` record.
- **At rest on the device**, VMK is stored **wrapped** by a non-extractable device key (so IndexedDB never
  holds a plaintext exportable VMK); unwrapped into memory at app start.
- **Sync to another device**: an existing device unwraps VMK in memory, does ECDH(existing.wrapKey,
  newDevice.wrapPub) → HKDF → KEK → wraps VMK → uploads `wrappedVMK[newDevice]` (ciphertext) to the server.
  The server relays ciphertext only; it never holds an unwrapped VMK.

### 6.4 Recovery — the honest part (E2E ⟂ "phone-only" recovery)
**A phone OTP is verified by the server. If an OTP alone could release your vault key, the server (or anyone
who intercepts the OTP) could read your contacts — that is *not* E2E.** So we split recovery by asset:

- **Account + payment history** → recover with **phone OTP** (server already holds these; not E2E). Your
  account, balances, and the *numbers* you've paid all come back.
- **Encrypted labels/notes/unpaid contacts** → recover with **one of**:
  1. **Device transfer (primary):** you still have another verified device → it re-wraps VMK to the new one
     (phone-OTP proves same owner). Zero secrets to remember. Covers the common "new phone, old phone still
     works" and "two devices" cases.
  2. **Recovery code (fallback):** at vault setup we generate a one-time recovery code; a KEK derived from it
     (Argon2id if we add the WASM lib, else PBKDF2-SHA256 high-iteration + salt) wraps VMK →
     `recoveryWrappedVMK` stored server-side as ciphertext. New device + code → unwrap. Server never sees the code.
  3. **Total loss (no device, no code):** encrypted labels/notes are **unrecoverable** (true E2E tradeoff,
     like Signal without cloud backup). The account and history still return via OTP. This must be stated to
     the user at setup: *"Save your recovery code or keep a second device — otherwise your private labels
     can't be restored."*

This is the crux to confirm (see §11-Q1). If the market can't manage recovery codes, we bias to
**device-transfer-only** E2E, accepting label loss on total-device-loss.

### 6.5 CRUD & sync API (all bodies are ciphertext for vault ops)
```
POST   /me/vault/records        { recordId, ciphertext, iv, ver }      # create/update (upsert)
GET    /me/vault/records?since= → [VaultRecord...]                     # delta sync (incl. tombstones)
DELETE /me/vault/records/:id                                           # tombstone
POST   /me/vault/keys/wrap      { forDeviceId, wrappedVMK }            # device-transfer sync
GET    /me/vault/keys           → { wrappedVMK[thisDevice]?, recoveryWrappedVMK? }
POST   /me/devices              { authPub, wrapPub, migrateFrom? }     # register device (signup/new device)
POST   /me/anchor/request|verify (reuse existing claim OTP endpoints)  # phone-anchor
```
All `/me/*` require a valid signed device credential (§5.2).

### 6.6 Save / manage / retrieve UX
- **Save**: (a) auto-upsert after a successful payment (encrypt → POST record); (b) explicit **Add contact**
  (manual fields or device **picker** import — reuse [`pickContact`](../app/src/pages/send/steps.tsx)).
- **Manage**: a **Contacts** surface — search, favorite/pin, rename, add note, delete (tombstone + local purge).
  Today's "recents" strip becomes the top (favorites + most-recent) of this list.
- **Retrieve**: on app start, unwrap VMK → delta-sync records → decrypt → render. Fully offline-capable
  (IndexedDB cache); syncs opportunistically (matches the 2G-tolerant [`req`](../app/src/api/client.ts) timeout design).

---

## 7. Crypto summary
- Device auth: **ECDSA P-256** (sign). Key wrap transport: **ECDH P-256** → **HKDF-SHA256** → KEK.
- Vault: **AES-256-GCM** (VMK + per-record, random 96-bit IV per record).
- Recovery code KDF: **Argon2id** (preferred, WASM) or **PBKDF2-SHA256 ≥310k iters** (native fallback) + 128-bit salt.
- All keys non-extractable where possible; VMK wrapped at rest; nothing secret in localStorage.

---

## 8. Threat model (what each layer resists)
- **Stolen `deviceId` / sniffed header:** useless — requests need a signature from the non-extractable key.
- **Malicious/breached server:** sees payment ledger (unavoidable) but **not** contact labels/notes/unpaid
  contacts (E2E); cannot unwrap VMK (holds only ciphertext).
- **Stolen unlocked device:** can act as that account (same as any logged-in app) — acceptable; value-bearing
  recipient wallet still separately OTP-gated.
- **Intercepted OTP:** can recover account + history + *transacted numbers*, but **not** the encrypted
  labels/notes (needs device or recovery code) — the OTP-vs-E2E split (§6.4) is what buys this.
- **Lost device:** history back via OTP; labels back via 2nd device or recovery code, else lost (stated up front).
- **Private mode / no storage:** isolated in-memory session, no cross-user leakage; no persistence.

---

## 9. Phased rollout
1. **Contacts book on today's identity** — real add/edit/delete/favorite/note + picker import, stored per
   current `mm_sender_id` (plaintext first). Highest user value, lowest risk. *(Ships value immediately.)*
2. **Device keypair + signed requests** + `anon` fix + UUID→device migration.
3. **E2E vault** — VMK envelope, encrypt records, device-transfer sync. *(Migrate phase-1 plaintext contacts
   into the vault client-side.)*
4. **Phone-anchor + multi-device recovery** (reuse OTP) + recovery code.
5. *(Optional later)* passkeys; Argon2id WASM; blind-indexed search.

> Note the ordering tension: shipping plaintext contacts in phase 1 means a **client-side re-encryption
> migration** in phase 3. Alternative: build the vault first (slower to first value). See §11-Q2.

---

## 10. Data-model / endpoint appendix
- New server tables/maps: `DeviceAccount`, `VaultRecord`, `DeviceKeyWrap`, `RecoveryWrap` (persisted via the
  existing [`persist.ts`](../server/src/core/persist.ts) register/restore pattern).
- New client modules: `lib/deviceKey.ts` (keygen/sign), `lib/vault.ts` (VMK + encrypt/decrypt + sync),
  `pages/send/Contacts.tsx` (management UI), extend [`api/client.ts`](../app/src/api/client.ts).

---

## 11. Open decisions (need your call before build)
- **Q1 — Recovery UX:** offer a **recovery code** (true E2E, but users must save it) *and* device-transfer, or
  keep it **device-transfer-only** (simpler, no code, but total-device-loss = labels gone)? (§6.4)
- **Q2 — Phasing:** ship **plaintext contacts first** for speed (then migrate to E2E), or **build the vault
  first** so no contact is ever stored in the clear? (§9)
- **Q3 — Anchor prompt timing:** when do we invite phone-anchoring — never-until-asked, after first payment,
  or when the user first opens Contacts? (§5.3)
- **Q4 — Encryption scope:** confirm we **don't** encrypt transacted phone numbers (already server-known) and
  only encrypt labels/notes/unpaid contacts (§6.1) — or insist on encrypting everything for uniformity?
- **Q5 — Session model:** signed-token (§5.2 option B) vs per-request signatures — confirm token approach.
