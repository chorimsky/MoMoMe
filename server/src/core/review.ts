/* ============================================================
   Store review access.

   Google Play (and Apple) review an app by using it, and they cannot receive a Cameroon
   SMS. The app has no login, but the "own your number" step and merchant verification
   send a one-time code to a Mobile Money number, which a reviewer read as a login wall
   and rejected the release for ("provide valid login credentials").

   So a single number can be designated for reviewers, with a fixed code, through two
   environment variables. Nothing is bypassed for anyone else: the number must still be a
   valid MTN/Orange number, the code is checked like any other, and money can never move
   to it — POST /payments refuses it as a recipient. Unset in an environment → no review
   access exists at all.
   ============================================================ */
const phone = (process.env.REVIEW_PHONE ?? "").replace(/\D/g, "");
const code = (process.env.REVIEW_OTP ?? "").replace(/\D/g, "");

export function reviewAccess(): { phone: string; code: string } | null {
  return phone.length >= 8 && code.length === 6 ? { phone, code } : null;
}

/** Is this number (any formatting, with or without the country code) the review number? */
export function isReviewPhone(candidate: string): boolean {
  const r = reviewAccess();
  if (!r) return false;
  const d = candidate.replace(/\D/g, "");
  return d === r.phone || d.endsWith(r.phone);
}
