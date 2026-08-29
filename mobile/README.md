# MoMo›Me — mobile app

Native iOS & Android app for MoMo›Me (pay any MTN / Orange Money number with Bitcoin,
Lightning or USDT). Built with **Expo SDK 57 + Expo Router**.

- **Isolated project.** Own `node_modules`, **not** a pnpm workspace member, so mobile
  dependency churn can never break the deployed web/server stacks.
- **Shared contract.** Imports the API types/domain from the repo root via `@shared/*`
  (see `metro.config.js`, `tsconfig.json`) — one source of truth, no duplication.
- **Same backend.** Talks to `EXPO_PUBLIC_API_BASE` (defaults to the live prod backend).

## Quick start

```bash
cd mobile
npm install
npx expo start   # scan the QR with Expo Go
```

## Ship it

Full store-deployment walkthrough (EAS build + submit, signing, deep links, App Store review
notes) is in **[DEPLOY.md](./DEPLOY.md)**.

## Layout

```
src/
  app/                 Expo Router routes
    (tabs)/            Send · Scan · Discover · Wallet · More
    pay/[code].tsx     merchant pay-link / QR target
    claim.tsx          refund claim
    legal/[doc].tsx    terms / privacy / contact
  api/client.ts        typed backend client (X-MM-Sender device id)
  components/ui.tsx     MoMo UI kit (Screen/Card/Button/Field/Pill)
  constants/theme.ts    ported design tokens (light + dark) + fonts
  lib/                 format + config helpers
```
