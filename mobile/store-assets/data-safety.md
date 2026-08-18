# Play Console — Data safety answers (MoMo›Me)

Fill the Data safety form (Play Console → App content) to match how the app actually
behaves. Verify each against the code before submitting — you are certifying it.

## Does your app collect or share user data?
**Yes** (it processes payment details), but it does **not sell** data and does **not**
use it for ads/tracking.

## Data types

| Category | Type | Collected | Shared | Purpose | Notes |
|---|---|---|---|---|---|
| Financial | Payment info (phone number paid to/from, amount, reference) | Yes | No | App functionality (execute the transfer) | Sent to the MoMo›Me settlement backend over HTTPS |
| Personal | Phone number | Yes | No | App functionality | The recipient's / your Mobile Money number |
| Contacts | In-app contacts you save | Yes* | No | App functionality (pay again) | *Stored **end-to-end encrypted**; the server only ever holds ciphertext it cannot read |
| App activity | Payment history | Yes | No | App functionality | Your own transactions |
| Device/other IDs | Anonymous device id | Yes | No | App functionality / fraud-prevention | Random id the app mints; not the hardware advertising id |

**Camera:** used only to scan payment QR codes in real time. No photos/videos are
collected or stored. (Do **not** list camera as data collection.)

## Security practices
- **Data is encrypted in transit** (HTTPS/TLS): **Yes**.
- **Contacts are end-to-end encrypted** at rest and in transit (AES-256-GCM; the key
  never leaves the user's device / secure keystore).
- **Users can request deletion**: provide the support contact
  (More → Contact & support, or the email in `app config → support`).
- **Committed to Play Families policy**: app is not directed at children.

## Account creation / login
None required. The app auto-creates an anonymous device profile; there is no username or
password. (The optional "Own your number" flow verifies a Mobile Money number via OTP but
is not a login gate.)
