# WhatsApp ↔ MoMo›Me

The chat where someone asks for money is where they want to pay from. MoMo›Me meets people
there in three ways, all shipped in the server and apps; only the Meta side is yours to
connect.

## What it does

**1. Share into WhatsApp (works today, no setup).** Receive → *Send on WhatsApp* drops your
receive link (`momome.xyz/send?to=<number>&amount=<xaf>`) into a chat. Merchant links and
the web Receive page already share to WhatsApp. On a phone with the app, tapping such a link
opens MoMo›Me's Send screen prefilled (app links for `/send` and `/pay`); without the app it
opens the web flow.

**2. A bot on your WhatsApp Business number.** People message the number in text; the bot
answers with a link into the exact screen, in the language they wrote:

| They write | Bot replies |
|---|---|
| `send 5000 to 677000789` / `envoyer 5000 à 677000789` | Pay link for that number and amount, with the **registered name** shown before they tap, or "name not on file — check every digit" |
| `receive 5000` / `recevoir 5000` / `my link` | Their own receive link (their WhatsApp number is their Mobile Money number) |
| `status MMM-2026-000123` / `statut …` | Where that payment is |
| anything else, `help`, `aide` | The menu |
| a **voice note** | "I can't listen to voice notes yet — type it, e.g. `send 5000 to 677000789`" (EN + FR) |

Nothing moves money from the chat: every link opens MoMo›Me, where the person confirms
with the same name check as everywhere else.

**3. A notification channel.** "You have received 1 000 XAF…" goes to the recipient on
WhatsApp; when it lands, the SMS for the same news is skipped (recorded as such in the
outbox). A sender who linked their number (More → Your number) gets delivered / refund
notices there too. Meta's rule is enforced: free-form text only within 24 h of the
person's last message to us; outside that window only the approved template is sent, and
anything else is recorded as skipped with the reason instead of silently lost.

## Connect it (Meta side — operator)

1. Meta for Developers → create an app (Business type) → add **WhatsApp**. Use the test
   number first, then add the real business number.
2. **Variables on momome-api** (Railway):
   - `WHATSAPP_ACCESS_TOKEN` — a *System User* permanent token with `whatsapp_business_messaging`
   - `WHATSAPP_PHONE_NUMBER_ID` — from WhatsApp → API setup
   - `WHATSAPP_VERIFY_TOKEN` — any long random string you choose
   - `WHATSAPP_APP_SECRET` — App settings → Basic → App secret (webhook signatures)
   - `WHATSAPP_TEMPLATE_DELIVERED` — the approved template name (optional until approved)
   - `WHATSAPP_TEMPLATE_LANG` — e.g. `en` or `fr` (default `en`)
3. **Webhook**: WhatsApp → Configuration → Callback URL
   `https://momome-api-production.up.railway.app/webhooks/whatsapp`, Verify token = the value
   above, subscribe to the **messages** field.
4. **Template** (for notices outside the 24 h window): create a *Utility* template, body
   `You have received {{1}} on your Mobile Money via MoMo›Me. Ref {{2}}.` (and a French
   one if you set `WHATSAPP_TEMPLATE_LANG=fr`). Put its name in `WHATSAPP_TEMPLATE_DELIVERED`.
5. Admin → Settings → Notification channels → switch **WhatsApp** on. The row shows
   "Not connected" until step 2 is done.

Cost: Meta charges per conversation (utility ≈ a few cents in Cameroon; a reply inside a
user-initiated window is free). The SMS skip offsets most of it.

## Voice and free text — Meta Model API (Muse)

With `META_AI_API_KEY` set on momome-api, two more things work:

- **Voice notes are transcribed.** The note is downloaded from Meta, converted to 16 kHz WAV
  in-process (no ffmpeg), sent to Muse Voice Transcribe with French + English bias and our
  vocabulary as keywords, and the bot **reads back what it heard** before answering
  ("J'ai entendu : « envoie cinq mille à … »"), then gives the link, then "if that is
  wrong, type it". Numbers and amounts dictated in words become digits.
- **Free text is understood.** "Give Nana 5k for the rent, her number is 6 77 00 07 89"
  becomes `{intent: send, amount: 5000, number: 677000789}` through constrained JSON output
  (Muse Spark). The model only proposes: every field then goes through the same phone,
  limit and name checks as a typed command, and the link opens the confirm screen.

Rules that hold: the model never touches a payout, quote or refund; no OTPs or tokens in
prompts; an 8 s timeout, and any failure or outage falls back to the regex bot, so
WhatsApp never goes quiet. Without the key, voice notes get "type it" and text is regex only.

Variables: `META_AI_API_KEY` (required), `META_AI_MODEL` (default `muse-spark-1.3`),
`META_AI_ASR_MODEL` (default `muse-voice-transcribe-1.0`). Cost: a message is a few hundred
tokens; a voice note is billed by audio seconds. Pay as you go at dev.meta.ai.
