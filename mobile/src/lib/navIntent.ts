/**
 * Proof that a navigation came from inside the app.
 *
 * The Send screen accepts `name` alongside `scanned` so that tapping a contact opens Send
 * with that contact's label. Those are route params, and route params also arrive from
 * OUTSIDE: a `momome://` deep link or a universal link can carry `?scanned=6…&name=MTN`
 * and preset a recipient label the sender never typed. On live rails most numbers have no
 * registered name to contradict it, so the label would be believed.
 *
 * A contact tap therefore mints a random token here, in memory, and passes it as `t`.
 * The Send screen honours `name` only when `t` matches a token minted in this process.
 * A link from outside cannot know the token, so its `name` is ignored (the number is kept:
 * numbers are checked, labels are trusted).
 */
const minted = new Set<string>();

export function mintIntent(): string {
  const t = Math.random().toString(36).slice(2) + Date.now().toString(36);
  minted.add(t);
  if (minted.size > 20) minted.delete(minted.values().next().value as string);
  return t;
}

export function consumeIntent(t: unknown): boolean {
  if (typeof t !== 'string' || !minted.has(t)) return false;
  minted.delete(t);
  return true;
}
