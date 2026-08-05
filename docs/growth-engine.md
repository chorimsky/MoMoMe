# MoMo›Me — Step 5: Network Growth Engine (Cameroon launch playbook)

How we get from a working product to a **movement**: the first 10,000 users, the first
1,000 merchants, and a self-reinforcing loop. Grounded in the Cameroon market as it
actually is (Aug 2026) and in the exact product we've shipped (QR + payment links +
instant MoMo settlement + "no crypto knowledge" + merchant dashboard + developer API).

---

## 0. The wedge — why we win where the exchanges don't

**Market reality (sources at bottom):**
- **Mobile Money is the rail.** ~19.5M active MoMo accounts; ~95% of all electronic
  transactions run on MTN MoMo + Orange Money; ~CFA 40.6B moved *daily*. Every merchant
  we want already has a settlement account. **We ride on top of MoMo — zero new habit.**
- **Crypto is niche but growing.** ~1.85% crypto user penetration, concentrated in a young,
  tech-savvy, multilingual cohort. Today crypto is used for *holding / remittance / speculation* —
  **almost never for everyday commerce.**
- **Diaspora is huge.** ~$400–500M/yr in remittances, led by **France** (300k+ Cameroonians),
  then Germany, Belgium, UK, US, Canada. XAF is EUR-pegged (655.957) — a clean euro corridor.
- **Incumbents are the wrong shape.** Yellow Card, Bitnob et al. are **on/off-ramps for crypto
  holders** (buy/sell BTC/USDT → cash out to MoMo). None is a **merchant acceptance network**.

**Our wedge (one sentence):** *the recipient never touches crypto.* A merchant, a driver, a
freelancer, a landlord gets **ordinary Mobile Money**, instantly — while the payer used
Bitcoin, Lightning, USDT, or their own MoMo. We are not asking Cameroon to adopt crypto.
We are giving the **1.85% who hold it, and the diaspora who send it, a place to spend it** —
and giving the **98% a better way to get paid.**

**Two demand engines feed one supply side:**
```
   Crypto holders (Buea/Silicon Mountain, young urban)  ┐
                                                        ├──►  MERCHANTS (accept, settle to MoMo)
   Diaspora (France-led, euro corridor)                 ┘
```
The merchant is the flywheel. Every merchant QR is a billboard that recruits payers, and
every payer who can't find MoMo›Me at the next shop asks that shop to add it. **Supply is
the scarce, defensible asset — we optimise the whole engine around merchant density.**

---

## 1. Acquire the first 10,000 users (the demand side)

Users are cheaper than merchants and follow them — so we seed users where crypto already
lives, then let merchant density pull the rest.

**Cohort A — Crypto-native students & builders (the beachhead): ~3,000.**
- **Where:** Buea "Silicon Mountain" — University of Buea, Catholic University Institute of
  Buea, ActivSpaces, Silicon Mountain Ventures, the SMCon crowd (500+). This is the densest
  crypto-literate population in the country, English-speaking, and already a *community*.
- **Hook:** "Spend your Bitcoin/USDT at real shops in Buea today." The first city where you
  can actually *live* on crypto via MoMo.
- **Motion:** campus ambassadors (§4), a Buea "MoMo›Me accepted here" corridor (§3), hackathon
  + bounties on the **developer API** (we already shipped it).

**Cohort B — Diaspora payers (the volume): ~4,000.**
- **Where:** France first (largest, euro-pegged, single-language FR). Cameroonian associations,
  Facebook/WhatsApp diaspora groups, church networks in Paris/Marseille/Lyon.
- **Hook:** "Pay a shop, a school, or family back home directly — they get MoMo in seconds,
  no Western Union fee, no account for them." The **merchant payment link / QR** is the unit:
  a mum in Lyon pays her son's landlord in Douala by opening a link.
- **Motion:** corridor content in FR, "pay tuition / rent / a bill back home" use-case landing
  pages (we already generate SEO pages), diaspora micro-influencers.

**Cohort C — Everyday urban MoMo users (the mainstream pull): ~3,000.**
- Come **for free**, pulled by merchant QRs in Douala/Yaoundé once density exists. They may
  never touch crypto — they can also pay *from their own MoMo*. The point is the network and
  the receipt/contacts habit.

**Channels & cost discipline:** WhatsApp-first (it's the country's social layer), merchant-QR
as owned media (zero CAC), campus + diaspora community leaders (paid in status, not cash),
radio/OOH only in the launch city. Target blended CAC near-zero on Cohort C; small stipends
only for ambassadors and merchant field reps.

---

## 2. Onboard the first 1,000 merchants (the supply side — the real work)

This is where the network is won. **Merchant onboarding is already frictionless in-product**
(name → settlement number → OTP → live; QR/link in one tap). Growth is a *field + community*
problem, not a product one.

**Sequence by density, not by count** — a merchant is only useful where payers are:
1. **Buea corridor (Tier-0): 150 merchants.** Blanket one walkable zone — Molyko/Mile 17
   student strip: cafés, chop houses, printing shops, phone/data vendors, bars, transport.
   Density > breadth: a student must hit **5 MoMo›Me shops on one street** so it feels real.
2. **Douala (Tier-1): 500 merchants.** Akwa/Bonanjo commercial core + Bonamoussadi. Restaurants,
   retail, hotels (foreign visitors!), clinics. Field reps with the **merchant dashboard on a
   phone** onboard in <3 minutes at the counter.
3. **Yaoundé (Tier-1): 350 merchants.** Bastos/Centre-ville, hotels, NGOs/agencies (diaspora &
   grant money), training centres.

**Priority categories (from the blueprint, validated by the market):**
Tier-1: **Restaurants/cafés** (frequent, visible), **freelancers/consultants** (diaspora-paid,
international-payment pain), **hotels** (foreign visitors with crypto), **tech companies**
(early adopters, will use the API). Tier-2: retail, training centres, clinics, event
organisers, NGOs.

**The merchant offer (status, not cash):**
- **Free.** No hardware, no bank, no card machine — they already have MoMo.
- **Instant settlement** to the number they already use (our biggest trust lever — verified).
- **Visibility:** listed on the future **"Pay with MoMo›Me" map** (merchant Phase 4), a window
  **sticker + counter QR kit**, and a **Verified Merchant** badge as volume grows.
- **A dashboard that answers "how is my money moving?"** — already shipped.

**Field playbook:** 2-person teams (one FR, one EN), a printed QR kit per merchant, onboard →
verify OTP → stick QR → do one live test payment at the counter (the "aha"). Reps' incentive
is tied to **merchants that take ≥1 real payment in 7 days**, not sign-ups.

---

## 3. Viral mechanics (engineered into the product)

The blueprint's growth loop, made concrete and tied to features (✅ shipped · ◻︎ to build):

```
Merchant displays QR  →  Customer pays (discovers MoMo›Me)  →  Customer pays elsewhere,
asks that merchant to add it  →  Merchant onboards (3 min)  →  more QRs  →  ↺
```

- ✅ **Merchant QR / payment links** — every counter is owned media.
- ✅ **"MoMo›Me accepted here"** identity (merchant code + badge) — the physical trust mark.
- ✅ **Digital receipt + contacts** — the payer keeps a record and re-pays in one tap (retention).
- ◻︎ **Referral codes** (users + merchants): "invite a shop, both get a status boost / fee
  credit." A merchant who recruits 3 merchants earns Verified faster. *Build on the existing
  device-account + merchant identity.*
- ◻︎ **Share-a-receipt / "I got paid on MoMo›Me"** — one-tap WhatsApp share (receipt export
  already exists; add a merchant-branded share).
- ◻︎ **Diaspora "pay a merchant back home"** deep-link kit — the France→Cameroon unit of virality.
- ◻︎ **"Pay with MoMo›Me" discovery map** (merchant Phase 4) — turns supply into a consumer
  reason-to-open, closing the loop.

---

## 4. Ambassador model (status-driven, not paid-to-join)

Reuse the merchant/developer identity infra for a light ambassador layer.

- **Who:** campus reps (Buea/Douala/Yaoundé universities), diaspora community leaders (France),
  and **power merchants** who recruit other merchants.
- **Tiers (status ladder):** *Rep → City Lead → Regional Lead.* Advancement gated on
  **activated merchants + first-payment rate**, not headcount.
- **Rewards that scale with the network, not the treasury:** a public leaderboard, a Verified
  badge, early features, small fee-credit / airtime stipends, event invites (SMCon presence),
  and revenue-share on the merchants they bring (using the developer-API attribution model).
- **Tooling (◻︎ build):** a lightweight ambassador dashboard = the merchant dashboard pattern +
  a referral code and an attributed-merchant list. Cheap to build on what exists.

---

## 5. Community strategy

- **Buea first, as a scene, not a market.** Sponsor/att​end SMCon, run a **crypto-to-MoMo
  hackathon on the developer API**, seed a WhatsApp/Telegram "MoMo›Me Buea" group, and make
  the Molyko corridor a place people *show off* ("I paid for lunch with sats").
- **Diaspora chapters (France-led).** FR-language WhatsApp groups around real jobs-to-be-done
  (pay tuition, rent, family, a specific shop). Partner with hometown associations.
- **Content:** short vertical video of *real* payments (scan → pay → merchant's phone dings),
  bilingual, WhatsApp-status-native. Show the merchant's face, not the blockchain.
- **Trust & sensitivity:** operate transparently on compliance (we have the AML/CFT engine);
  be mindful that the Anglophone regions (incl. Buea) are conflict-affected — lead with
  economic empowerment, keep messaging apolitical, and protect field-rep safety.

---

## 6. Partnerships (concrete targets)

- **Hubs / incubators:** ActivSpaces (Douala/Buea), Silicon Mountain Ventures, Mountain Hub
  (Yaoundé) — co-host events, recruit ambassadors & API developers, credibility.
- **Universities:** University of Buea, Catholic University Institute of Buea, Univ of Douala,
  Univ of Yaoundé I — campus corridors, student reps, fee-payment pilots.
- **MoMo agent networks:** MTN MoMo / Orange Money agents are everywhere and trusted — a
  co-marketing / agent-assisted-onboarding angle turns thousands of existing agents into a
  merchant-signup and cash-in surface.
- **Crypto rails & communities:** IBEX / Lightning ecosystem, regional Bitcoin meetups — supply
  the crypto-native payers and dev mindshare.
- **Diaspora orgs:** Cameroonian associations & churches in France (Paris/Marseille/Lyon) — the
  remittance corridor's trust layer.
- **B2B via the API:** local marketplaces, delivery apps, SaaS, event ticketing — each
  integration multiplies merchants and volume without field cost.

---

## 7. Cameroon launch sequence (phased)

- **Phase 0 — Prove the loop (Buea, ~6–8 wks).** 150 corridor merchants + 3,000 crypto-native
  users on one street. Success = a student lives a day on MoMo›Me; merchants see daily sales.
  *This is the reference story everything else sells.*
- **Phase 1 — Diaspora corridor (France ↔ Douala/Yaoundé, parallel).** Turn on the
  pay-a-merchant-back-home unit; 500 Douala + 350 Yaoundé merchants where diaspora money lands.
- **Phase 2 — Density & discovery.** Ship the referral loop + "Pay with MoMo›Me" map; let
  merchant density pull mainstream MoMo users (Cohort C) for near-zero CAC.
- **Phase 3 — B2B/API multiplier & CEMAC.** Marketplaces/platforms via the API; replicate the
  Buea→Douala playbook into Gabon/Chad/Congo/CAR (same XAF rails, same product).

---

## 8. North-star & guardrails

- **North star:** *weekly merchants with ≥1 real payment* (density × activation), not raw signups.
- **Supporting:** first-payment rate within 7 days of onboarding; payer M1 retention (re-pay via
  contacts/receipt); corridor density (MoMo›Me shops per active user's daily path); diaspora
  corridor volume (France→XAF).
- **Unit-economics guardrail:** blend the crypto-payer margin (higher take) with the MoMo-to-MoMo
  and diaspora volume; keep field-rep pay tied to *activated* merchants; lean on owned media
  (QRs) so CAC stays near zero on the mainstream cohort.
- **Compliance as a moat:** we already have the AML/CFT + STR engine and payment-origin location
  — in a legal-vacuum market, *being the trustworthy, transparent operator* is a durable edge
  and the thing regulators/partners/merchants reward.

---

## 9. What Engineering builds to power this (ties strategy → backlog)

1. **Referral system** (users + merchants) on the device-account + merchant identity — the core
   viral primitive.
2. **Ambassador dashboard** — merchant-dashboard pattern + referral code + attributed list +
   leaderboard.
3. **"Pay with MoMo›Me" discovery map** (merchant Phase 4) — supply becomes consumer demand.
4. **Merchant QR kit generator** — printable poster/sticker/table-tent PDF per merchant.
5. **Diaspora pay-back-home kit** — FR corridor landing + shareable merchant links.
6. **Share-a-receipt (merchant-branded)** — one-tap WhatsApp virality.
7. **Merchant Phase 2/3** (invoices, verification tiers → Verified badge) — the status ladder.

---

### Sources
- [DataReportal — Digital 2025: Cameroon](https://datareportal.com/reports/digital-2025-cameroon) · [Business in Cameroon — MTN 7.6M internet users H1 2025](https://www.businessincameroon.com/public-management/2108-14917-mtn-cameroon-hits-record-7-6m-internet-users-in-h1-2025-despite-criticism) · [The Africa Report — Orange overtakes MTN](https://www.theafricareport.com/402382/orange-ends-mtns-long-hold-on-cameroons-mobile-market/)
- [TechCabal — Cameroon's startup wave](https://techcabal.com/2025/07/01/tnw-cameroon-algeria/) · [Wikipedia — Silicon Mountain](https://en.wikipedia.org/wiki/Silicon_Mountain)
- [Mariblock — Cameroon](https://www.mariblock.com/countries/cameroon) · [Statista — Cryptocurrencies Cameroon](https://www.statista.com/outlook/fmo/digital-assets/cryptocurrencies/cameroon)
- [Semafor — Yellow Card $33M raise](https://www.semafor.com/article/10/16/2024/african-crypto-startup-yellow-card-raises-33-million-in-new-funding) · [Bitnob — Africa fintech trends 2025](https://bitnob.com/blog/top-fintech-trends-in-africa-to-watch-in-2025)
