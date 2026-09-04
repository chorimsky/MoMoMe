# Play Store graphics — MoMo›Me

Every asset here was checked against the Play Console requirements on 4 Sep 2026.

| Console field | Requirement | File(s) | Actual |
|---|---|---|---|
| App icon | PNG/JPEG · ≤1 MB · 512×512 | `play-icon-512.png` | 512×512 PNG · 37 KB · full-bleed square (Play applies its own mask) |
| Feature graphic | PNG/JPEG · ≤15 MB · 1024×500 | `play-feature-1024x500.png` | 1024×500 PNG · 69 KB |
| Phone screenshots | 2–8 · PNG/JPEG · ≤8 MB · 16:9 or 9:16 · sides 320–3840 px | `screenshots/phone/01…07.png` | 7 × 1080×1920 (9:16) · 150–290 KB |
| 7-inch tablet | up to 8 · same rules as phone | `screenshots/tablet7/01…07.png` | 7 × 1440×2560 (9:16) · 200–420 KB |
| 10-inch tablet | up to 8 · 16:9 or 9:16 · sides 1080–7680 px | `screenshots/tablet10/01…07.png` | 7 × 2160×3840 (9:16) · 380–780 KB |
| Chromebook | optional (4–8) | — | not provided; app is not Chromebook-optimised |
| Android XR | optional (4–8) | — | not provided |

## What the screenshots show (upload in this order)
1. **Send** — number, verified recipient name, amount.
2. **Choose how to pay** — the method picker with the network named on every row.
3. **Review** — fee, total, what leaves the wallet, locked price.
4. **Delivered** — success with reference and receipt.
5. **Get paid** — the receive/payment-link screen.
6. **Discover** — verified local businesses.
7. **More** — contacts, own your number, refunds, settings.

## How they were made
Real screens of the mobile app (the same React Native code, rendered through Expo's
web target against a local sandbox backend), captured at 3× (1080×2400), then placed in
a device frame on the brand background with a one-line caption so each image is exactly
9:16 as Play requires. Amounts and the recipient are sandbox data. Regenerate with the
same pipeline after any UI change; captions are in the compose script used for this set.

## Still to do in Play Console (needs your sign-in)
- Data safety → account deletion URL: `https://www.momome.xyz/delete-account`
- Paste `listing.md` copy (short + full description) and answer `data-safety.md`.
