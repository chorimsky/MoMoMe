# Wallet interoperability

Today's interoperable representation of a MoMo›Me identity is the Lightning Address `<E.164 digits>@momome.xyz` (LUD-16 → LUD-06 → fresh BOLT11). Every Lightning wallet in the world can pay it; the metadata names the holder (masked to strangers, full once the holder proved the number), the callback returns a LUD-09 success message.

`POST /api/v2/wallet/resolve` (flag `WALLET_RESOLUTION_API_ENABLED`) lets a wallet that *chooses* to understand a bare number (`+237674123456`) ask for what to pay: it answers with the Lightning Address and the LNURL-pay path — open standards out, no MoMo›Me invoice format. **No wallet can pay a bare phone number natively until it implements this or a common resolver standard; the product does not claim otherwise** (rule 17). UMA: see UMA_COMPATIBILITY.md.
