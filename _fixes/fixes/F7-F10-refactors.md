# F7–F10 — the refactors

These four aren't patches. A mechanical diff of a 1,936-line file split is more dangerous
than doing it by hand, and the other three are habits rather than edits. Here's the shape
and the order.

---

## F7 — split `routes/api.ts` by trust boundary

1,936 lines, ~95 endpoints, three completely different trust levels in one file: the
anonymous customer flow, the device-scoped merchant/vault surface, and the full admin
console including treasury and compliance. The helpers that decide *who owns what* —
`verifyDeviceSig`, `ownerOf`, `partnerOf`, `vaultOwnerOf`, `isAdminRequest`,
`mayViewPayment` — sit in the middle of it.

Split by who's allowed to call it, not by feature:

```
server/src/core/requestAuth.ts     ← the six helpers, nothing else
server/src/routes/
  public.ts     quotes · payments · recipients/resolve · discover · merchant/pay
  account.ts    /me/* — vault · devices · anchor · recipients · referral
  merchant.ts   merchant onboarding · links · listing · summary
  admin.ts      the entire /admin/* surface + /ops/snapshot
  index.ts      mounts all four on the existing router
```

Do it in that order, one PR each, moving code without changing it. The win is that
`requestAuth.ts` becomes ~120 lines you can hand to a security reviewer, instead of six
functions buried at line 270 of a file nobody reads end to end.

`admin.ts` will still be large. That's fine — it's uniformly admin-gated, so its size is
volume, not risk.

**Do F2 and F3 first.** They touch two of the functions being moved, and you want those
diffs readable.

---

## F8 — adopt the design system that already exists

`momome.css` defines a genuinely good token set — a spacing scale, a fluid type scale,
radii, a 44px tap-target floor — and layout primitives (`.container`, `.stack`,
`.cluster`, `.overline`, `.chip`, `.seg`) written with comments explicitly saying they
exist so pages stop re-declaring widths and stacks inline.

The send flow then re-declares them inline anyway. `13.5px`, `11.5px`,
`letter-spacing:.09em`, `textTransform:uppercase` recur by hand across `steps.tsx`,
`ui.tsx`, `Activity.tsx` and `Success.tsx` — and `.overline` exists precisely to end that
duplication.

This is discipline, not architecture. One screen per PR, deleting the inline equivalents
as you go, starting with the send flow because it's the highest-traffic surface. Concrete
first pass:

- Every uppercase micro-label → `.overline` (there are roughly a dozen).
- The amount quick-picks and Activity filters → `.chip` (both hand-roll it today, with
  different padding).
- `Label` in `ui.tsx` is `.overline` with a margin. Make it use the class.
- The `FlowCard` padding `clamp(15px, 3.6vw, 19px)` → the spacing scale.

Rule going forward: a raw px value in a component is a bug unless there's a comment
saying why the scale doesn't fit.

---

## F9 — scope the page stylesheets

`Landing.css` carries a comment documenting a real bug in production: an unscoped `.step`
rule in `Developers.css` hijacked the landing steps, forced them into a 2-column grid and
overlapped the title with the description. The fix was to re-scope every landing rule
under `.how`.

That fix is correct and it doesn't generalise. Every generic class name in every page
stylesheet — `.step`, `.n`, `.card`, `.grid` — is the same bug waiting for a second
author, because all of these are imported into one global scope.

Two options, pick one and enforce it:

- **CSS modules** (`Landing.module.css`) — the compiler guarantees it. Best if you're
  willing to touch every page's imports.
- **Mandatory page prefix** (`.lp-step`, `.dev-step`) — zero tooling, relies on review.

Either way, `momome.css` keeps only genuine globals: tokens, resets, `.btn`, and the
layout primitives from F8.

---

## F10 — one source of visual truth

The root README says the prototypes in `project/` *"remain the visual source of truth"*,
while `app/` is the shipping product and carries its own copy of `momome.css` and
`legal.css`. Two sources of truth is zero sources of truth — and the prototypes cannot
have tracked the send flow's refund-claim states, rail routing, merchant tooling or the
encrypted contact vault.

```diff
-_Original design handoff note (from claude.ai/design) is preserved in [`project/`](project/);
-the prototypes there remain the visual source of truth._
+_[`project/`](project/) holds the original design prototypes, archived as of the initial
+build. They are historical reference only — `app/` is the canonical UI, and
+`app/src/styles/momome.css` is the design system of record._
```

If nothing imports from `project/` — worth confirming with a grep before you do it — move
it to `docs/archive/prototypes/` so its position in the tree matches its status.
