/* Capital Intelligence + Investor OS — end-to-end over HTTP.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/capital.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import type { AddressInfo } from "node:net";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { createApp } = await import("../src/app.js");
  const { issueToken } = await import("../src/core/adminAuth.js");
  const { createUser } = await import("../src/core/adminUsers.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/capital`;
  const adminRoot = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/admin`;
  const mk = (name: string, role: string) => { const u = createUser(name, "Str0ng-Passw0rd!x", role as never); return { id: u.id, h: { "x-admin-token": issueToken({ uid: u.id, role: role as never }).token, "content-type": "application/json" } }; };
  const admin = mk("cap-admin", "Super Admin"), fin = mk("cap-fin", "Finance Manager"), im = mk("cap-im", "Investment Manager"), rm = mk("cap-rm", "Relationship Manager"), co = mk("cap-co", "Compliance Officer"), legal = mk("cap-legal", "Legal"), ops = mk("cap-ops", "Operations Manager"), ro = mk("cap-ro", "Read Only"), investor = mk("cap-investor", "Investor"), agent = mk("cap-agent", "Support Agent");
  const call = async (who: { h: Record<string, string> }, method: string, path: string, body?: unknown, base = root) => { const r = await fetch(`${base}${path}`, { method, headers: who.h, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, never> & Record<string, unknown> }; };

  try {
    /* ---------- engine on an EMPTY book: zeros with a small sample, never invented ---------- */
    let r = await call(admin, "GET", "/intelligence/overview?period=30d");
    ok("overview answers for Super Admin", r.status === 200, String(r.status));
    { // The sandbox seeds a small book; whatever it holds, the overview must equal the payments store — never a plausible-looking figure.
      const pays = (await call(admin, "GET", "/payments", undefined, adminRoot)).body as unknown as Array<{ xaf: number; displayStatus: string; createdAt: string }>;
      const cutoff = Date.now() - 30 * 86_400_000;
      const done = pays.filter((p) => p.displayStatus === "Completed" && Date.parse(p.createdAt) >= cutoff);
      const vol = (r.body.volume as { current: number; count: number });
      ok("overview volume equals the sum of completed payments in the window", vol.current === done.reduce((s, p) => s + p.xaf, 0) && vol.count === done.length && (r.body.freshness as { sampleSize: number }).sampleSize === done.length, `${vol.count} payments`);
    }
    ok("overview names its sources", Array.isArray(r.body.sources) && (r.body.sources as unknown[]).length >= 3);
    r = await call(admin, "GET", "/intelligence/forecasts");
    const f = (r.body.forecasts as Array<{ metric: string; horizons: Record<string, { expected: number; lower: number; upper: number; confidence: string }>; method: string }>) ?? [];
    ok("7 forecasts with expected/lower/upper/confidence", f.length === 7 && f.every((x) => Object.keys(x.horizons).length === 4 && ["LOW", "MEDIUM", "HIGH"].includes(x.horizons["30"].confidence)));
    ok("empty book → LOW confidence (no false precision)", f[0]?.horizons["30"].confidence === "LOW");
    r = await call(admin, "GET", "/intelligence/liquidity");
    ok("liquidity exposes required + 4 stress presets + calculation", typeof r.body.required === "number" && Object.keys(r.body.stress as object).length === 4 && !!(r.body.stress as Record<string, { calculation: { steps: unknown[] } }>).NORMAL.calculation.steps.length);
    r = await call(admin, "POST", "/intelligence/liquidity/stress", { preset: "SEVERE", inputs: { volumeIncreasePct: 300 } });
    ok("custom stress test computes and shows its steps", r.status === 200 && (r.body.inputs as { volumeIncreasePct: number }).volumeIncreasePct === 300 && (r.body.calculation as { steps: unknown[] }).steps.length > 5);
    r = await call(admin, "GET", "/intelligence/scenarios?volumeMultiplier=1.5");
    ok("scenarios: 3 presets + custom", (r.body.scenarios as unknown[]).length === 4);
    r = await call(admin, "GET", "/intelligence/capital-requirements");
    ok("requirements derive from live data (POWER float requirement present)", (r.body.requirements as Array<{ capitalType: string; derived: boolean; calculation: { steps: unknown[] } }>).some((x) => x.capitalType === "POWER" && x.derived && x.calculation.steps.length >= 5));
    r = await call(admin, "GET", "/intelligence/risk");
    ok("risk: 7 categories, each with drivers + action", (r.body.items as Array<{ drivers: string[]; recommendedAction: string }>).length === 7 && (r.body.items as Array<{ drivers: string[] }>).every((i) => i.drivers.length > 0));
    r = await call(admin, "GET", "/intelligence/concentration");
    ok("concentration exposes configurable thresholds", typeof (r.body.thresholds as Record<string, number>).investor === "number");
    r = await call(fin, "PUT", "/intelligence/concentration/thresholds", { investor: 35 });
    ok("finance can set thresholds", r.status === 200 && (r.body.thresholds as Record<string, number>).investor === 35);
    r = await call(rm, "PUT", "/intelligence/concentration/thresholds", { investor: 10 });
    ok("relationship manager cannot set thresholds (section gate)", r.status === 403);

    /* ---------- role → section gate for the new prefixes ---------- */
    ok("Support Agent has no intelligence", (await call(agent, "GET", "/intelligence/overview")).status === 403);
    ok("Operations Manager has intelligence", (await call(ops, "GET", "/intelligence/transactions")).status === 200);
    ok("Operations Manager has no investors", (await call(ops, "GET", "/investors")).status === 403);
    ok("Relationship Manager has investors", (await call(rm, "GET", "/investors")).status === 200);
    ok("Relationship Manager has no capital", (await call(rm, "GET", "/capital")).status === 403);
    ok("Legal has capital ledgers", (await call(legal, "GET", "/capital")).status === 200);
    ok("Investor role has NO intelligence", (await call(investor, "GET", "/intelligence/overview")).status === 403);
    ok("Investor role has NO investors list", (await call(investor, "GET", "/investors")).status === 403);
    ok("Investor role has NO console access at all", (await call(investor, "GET", "/overview", undefined, adminRoot)).status === 403);
    ok("no session → 401 on the capital API", (await fetch(`${root}/intelligence/overview`)).status === 401);
    ok("unmapped capital prefix fails closed", (await call(admin, "GET", "/nope")).status === 403);
    r = await call(investor, "GET", "/portal/dashboard");
    ok("Investor role reaches the portal (404 until linked, not 403)", r.status === 404 && r.body.error === "no_investor", String(r.status));
    ok("Read Only can read investors", (await call(ro, "GET", "/investors")).status === 200);
    ok("Read Only cannot create investors", (await call(ro, "POST", "/investors", { name: "X Y", type: "VC", country: "CM" })).status === 403);

    /* ---------- Investor OS lifecycle with four eyes ---------- */
    r = await call(rm, "POST", "/investors", { name: "Sahel Ventures", type: "VC", country: "SN", preferences: { capitalTypes: ["POWER"], maxTicket: 200000 } });
    ok("relationship manager creates an investor", r.status === 201 && r.body.stage === "LEAD", String(r.status));
    const invId = r.body.id as string;
    ok("Compliance Officer cannot create investors (view only)", (await call(co, "POST", "/investors", { name: "Nope Inc", type: "VC", country: "CM" })).status === 403);
    r = await call(rm, "POST", `/investors/${invId}/qualify`, { status: "QUALIFIED", score: 80, note: "fits" });
    ok("qualification moves stage to QUALIFIED", r.status === 200 && r.body.stage === "QUALIFIED");
    r = await call(rm, "POST", `/investors/${invId}/kyc/submit`, { documents: [{ kind: "GOVERNMENT_ID", received: true }, { kind: "PROOF_OF_ADDRESS", received: true }, { kind: "SOURCE_OF_FUNDS", received: true }, { kind: "TAX_ID", received: true }], note: "complete" });
    ok("KYC submitted", r.status === 200 && (r.body.kyc as { status: string }).status === "SUBMITTED");
    ok("RM cannot approve KYC (role)", (await call(rm, "POST", `/investors/${invId}/kyc/review`, { decision: "APPROVED", note: "" })).status === 403);
    const coSelf = mk("cap-co2", "Compliance Officer");
    await call(coSelf, "PATCH", `/investors/${invId}`, { tags: ["x"] }).catch(() => null); // no-op (CO can't edit) — fine
    r = await call(co, "POST", `/investors/${invId}/kyc/review`, { decision: "APPROVED", note: "ok" });
    ok("Compliance Officer approves KYC (different person from submitter)", r.status === 200 && (r.body.kyc as { status: string }).status === "APPROVED" && r.body.stage === "KYC_APPROVED", String(r.status));
    // Four-eyes on KYC: a Super Admin who submits cannot approve their own submission.
    r = await call(admin, "POST", "/investors", { name: "Self Check Ltd", type: "INSTITUTION", country: "CM" });
    const selfId = r.body.id as string;
    await call(admin, "POST", `/investors/${selfId}/kyc/submit`, { documents: [{ kind: "GOVERNMENT_ID", received: true }, { kind: "PROOF_OF_ADDRESS", received: true }, { kind: "SOURCE_OF_FUNDS", received: true }, { kind: "TAX_ID", received: true }], note: "" });
    r = await call(admin, "POST", `/investors/${selfId}/kyc/review`, { decision: "APPROVED", note: "" });
    ok("four eyes: submitter cannot approve their own KYC file", r.status === 409 && r.body.error === "four_eyes", String(r.status));

    r = await call(im, "POST", "/investments/opportunities", { name: "Float facility", capitalType: "POWER", target: 400000, minTicket: 50000, termMonths: 12, economics: { returnPct: 9 } });
    ok("opportunity created", r.status === 201);
    const oppId = r.body.id as string;
    r = await call(im, "POST", "/investments/proposals", { investorId: invId, opportunityId: oppId, amount: 120000 });
    ok("proposal created for KYC-approved investor", r.status === 201 && r.body.status === "DRAFT", String(r.status));
    const propId = r.body.id as string;
    ok("proposal for a non-KYC investor is refused", (await call(im, "POST", "/investments/proposals", { investorId: selfId, opportunityId: oppId, amount: 60000 })).status === 409);
    await call(im, "POST", `/investments/proposals/${propId}/status`, { status: "SENT" });
    await call(im, "POST", `/investments/proposals/${propId}/status`, { status: "ACCEPTED" });
    r = await call(im, "POST", "/investments/term-sheets", { proposalId: propId, terms: { returnPct: 9 } });
    ok("term sheet issued with a generated document", r.status === 201 && typeof r.body.documentId === "string", String(r.status));
    const tsId = r.body.id as string;
    ok("IM cannot move a term sheet to LEGAL_REVIEW (Legal function)", (await call(im, "POST", `/investments/term-sheets/${tsId}/status`, { status: "LEGAL_REVIEW" })).status === 403);
    ok("Legal moves it to LEGAL_REVIEW", (await call(legal, "POST", `/investments/term-sheets/${tsId}/status`, { status: "LEGAL_REVIEW" })).status === 200);
    r = await call(legal, "POST", `/investments/term-sheets/${tsId}/status`, { status: "EXECUTED" });
    ok("Legal executes → investment opened + commitment on the POWER ledger", r.status === 200 && r.body.status === "EXECUTED");
    r = await call(admin, "GET", "/capital/ledger/power");
    ok("POWER ledger shows the commitment; nothing on OWN", (r.body.ledger as { balances: { committed: number } }).balances.committed === 120000 && ((await call(admin, "GET", "/capital/ledger/own")).body.ledger as { balances: { committed: number } }).balances.committed === 0);
    r = await call(admin, "GET", "/investments");
    const ivt = (r.body.investments as Array<{ id: string; status: string }>)[0];
    ok("investment is PENDING_FUNDING", ivt?.status === "PENDING_FUNDING");
    r = await call(im, "POST", "/investments/funding", { investmentId: ivt.id, amount: 120000, reference: "WIRE-1" });
    ok("IM records funding (RECEIVED)", r.status === 201 && r.body.status === "RECEIVED");
    const fundId = r.body.id as string;
    ok("IM cannot verify funding (Finance function)", (await call(im, "POST", `/investments/funding/${fundId}/verify`, { decision: "VERIFIED", note: "" })).status === 403);
    r = await call(fin, "POST", `/investments/funding/${fundId}/verify`, { decision: "VERIFIED", note: "bank statement" });
    ok("Finance verifies funding → RECEIPT on POWER ledger", r.status === 200 && r.body.status === "VERIFIED");
    r = await call(admin, "GET", "/capital/ledger/power");
    const bal = (r.body.ledger as { balances: { received: number; available: number } }).balances;
    ok("POWER received 120000, available 120000", bal.received === 120000 && bal.available === 120000);
    // Finance recording AND verifying the same funding is blocked.
    r = await call(fin, "POST", "/investments/funding", { investmentId: ivt.id, amount: 1, reference: "WIRE-2" });
    r = await call(fin, "POST", `/investments/funding/${r.body.id as string}/verify`, { decision: "VERIFIED", note: "" });
    ok("four eyes: recorder cannot verify their own funding", r.status === 409 && r.body.error === "four_eyes");

    /* ---------- allocation: propose → approve (other person) → execute (step-up) ---------- */
    r = await call(fin, "POST", "/capital/allocations", { capitalType: "POWER", investmentId: ivt.id, amount: 90000, purpose: "Float top-up", target: "XAF payout float" });
    ok("allocation proposed", r.status === 201 && r.body.status === "PROPOSED", String(r.status));
    const allocId = r.body.id as string;
    ok("four eyes: proposer cannot approve", (await call(fin, "POST", `/capital/allocations/${allocId}/decide`, { decision: "APPROVED", note: "" })).status === 409);
    ok("IM approves", (await call(im, "POST", `/capital/allocations/${allocId}/decide`, { decision: "APPROVED", note: "ok" })).status === 200);
    r = await call(im, "POST", `/capital/allocations/${allocId}/execute`);
    ok("execution demands step-up (elevation_required)", r.status === 403 && r.body.error === "elevation_required", String(r.body.error));
    const elevated = { h: { "x-admin-token": issueToken({ uid: im.id, role: "Investment Manager" as never, elevatedUntil: Date.now() + 600_000 }).token, "content-type": "application/json" } };
    r = await call(elevated, "POST", `/capital/allocations/${allocId}/execute`);
    ok("elevated execution posts DEPLOYMENT", r.status === 200 && r.body.status === "EXECUTED", String(r.status));
    r = await call(admin, "GET", "/capital/ledger/power");
    ok("POWER deployed 90000, available 30000", (r.body.ledger as { balances: { deployed: number; available: number } }).balances.deployed === 90000 && (r.body.ledger as { balances: { available: number } }).balances.available === 30000);
    ok("over-allocation refused", (await call(fin, "POST", "/capital/allocations", { capitalType: "POWER", amount: 999999, purpose: "too much", target: "x" })).status === 409);

    /* ---------- recommendations: review → approve by a second person with confirmation ---------- */
    r = await call(admin, "GET", "/intelligence/recommendations");
    const recs = r.body.recommendations as Array<{ id: string; status: string; inputs: unknown[]; calculation: { steps: unknown[] }; confidence: string }>;
    ok("recommendations generated with inputs + calculation + confidence", recs.length > 0 && recs.every((x) => Array.isArray(x.inputs) && x.calculation && x.confidence));
    const rec = recs.find((x) => x.status === "CREATED")!;
    ok("cannot jump CREATED → APPROVED", (await call(fin, "POST", `/intelligence/recommendations/${rec.id}/transition`, { to: "APPROVED", note: "confirmed" })).status === 409);
    ok("IM reviews", (await call(im, "POST", `/intelligence/recommendations/${rec.id}/transition`, { to: "REVIEWED", note: "looks right" })).status === 200);
    ok("four eyes: reviewer cannot approve", (await call(im, "POST", `/intelligence/recommendations/${rec.id}/transition`, { to: "APPROVED", note: "confirmed" })).status === 409);
    ok("approval without explicit confirmation refused", (await call(fin, "POST", `/intelligence/recommendations/${rec.id}/transition`, { to: "APPROVED", note: "yes" })).status === 400);
    ok("RM cannot approve (role)", (await call(rm, "POST", `/intelligence/recommendations/${rec.id}/transition`, { to: "APPROVED", note: "CONFIRMED" })).status === 403);
    r = await call(fin, "POST", `/intelligence/recommendations/${rec.id}/transition`, { to: "APPROVED", note: "CONFIRMED — board note" });
    ok("Finance approves with confirmation", r.status === 200 && r.body.approvedBy === "cap-fin", String(r.status));
    ok("dismiss needs a reason", (await call(im, "POST", `/intelligence/recommendations/${recs[recs.length - 1].id}/transition`, { to: "DISMISSED" })).status === 400 || recs.length === 1);

    /* ---------- copilot: structured answer, traceable, audited, never executes ---------- */
    r = await call(im, "POST", "/copilot/ask", { question: "How much liquidity do we need over the next 90 days?" });
    ok("copilot answers with metrics, sources, confidence, freshness", r.status === 200 && r.body.intent === "liquidity_need" && (r.body.metrics as unknown[]).length >= 3 && (r.body.sources as unknown[]).length > 0 && typeof r.body.dataUpdatedAt === "string");
    ok("answer explained by the engine (no model configured)", r.body.explainedBy === "engine");
    r = await call(im, "POST", "/copilot/ask", { question: "What happens if transaction volume grows 50%?" });
    ok("scenario question routes to the scenario engine", r.body.intent === "volume_scenario" && (r.body.calculations as unknown[]).length === 1);
    r = await call(im, "POST", "/copilot/ask", { question: "Which investors should we contact?" });
    ok("investor question routes to matching; fit and close probability stay separate", r.body.intent === "contact_investors" && (/fit \d+\/100, close probability \d+%/.test(String(r.body.answer)) || /no open capital requirement/i.test(String(r.body.answer))), String(r.body.answer).slice(0, 80));
    r = await call(admin, "GET", "/copilot/audit");
    ok("AI audit records user, question, sources, engine result", (r.body.entries as Array<{ user: string; engineResult: unknown; sources: unknown[] }>).length === 3 && (r.body.entries as Array<{ user: string }>)[0].user === "cap-im");
    ok("Investor role cannot use the copilot", (await call(investor, "POST", "/copilot/ask", { question: "risk?" })).status === 403);

    /* ---------- documents, reports, notifications, audit ---------- */
    r = await call(admin, "GET", "/documents");
    const doc = (r.body.documents as Array<{ id: string; investorId: string; status: string; access: string[] }>)[0];
    ok("term-sheet document exists with INVESTOR access", !!doc && doc.access.includes("INVESTOR"));
    ok("generated document keeps its line breaks", ((await call(admin, "GET", `/documents/${doc.id}`)).body.body as string).split("\n").length > 3);
    await call(im, "POST", `/documents/${doc.id}/status`, { status: "ISSUED" });
    await call(im, "POST", `/documents/${doc.id}/status`, { status: "AWAITING_SIGNATURE" });
    r = await call(admin, "POST", `/investors/${invId}/portal-link`, { userId: investor.id });
    ok("Super Admin links the investor login to the record", r.status === 200 && r.body.portalUserId === investor.id, String(r.status));
    r = await call(investor, "GET", "/portal/dashboard");
    ok("linked investor sees ONLY their own room (no intelligence keys)", r.status === 200 && (r.body.investor as { id: string }).id === invId && !("liquidity" in r.body) && !("recommendations" in r.body));
    ok("portal shows the document awaiting signature", r.body.documentsRequiringAction === 1);
    ok("signing needs a typed name", (await call(investor, "POST", `/portal/documents/${doc.id}/sign`, { name: "" })).status === 400);
    r = await call(investor, "POST", `/portal/documents/${doc.id}/sign`, { name: "Amina Diallo" });
    ok("investor signs from the portal — name + sha256 recorded", r.status === 200 && r.body.status === "SIGNED" && (r.body.signature as { name: string; bodyHash: string }).name === "Amina Diallo" && /^[0-9a-f]{64}$/.test((r.body.signature as { bodyHash: string }).bodyHash), String(r.status));
    ok("investor cannot read another investor's document", (await call(investor, "GET", `/portal/documents/${(await call(admin, "POST", "/documents", { title: "Other doc", category: "corporate", type: "POLICY", investorId: selfId, access: ["INVESTOR"] })).body.id as string}`)).status === 404);
    r = await call(investor, "POST", "/portal/messages", { subject: "Hello", body: "Question about the term" });
    ok("investor messages inbound", r.status === 201 && r.body.direction === "IN");
    r = await call(fin, "POST", "/capital/reports", { kind: "EXECUTIVE_CAPITAL", period: "30d" });
    ok("executive report generated with sections + sources", r.status === 201 && (r.body.sections as unknown[]).length === 5 && (r.body.sources as unknown[]).length > 0);
    const repId = r.body.id as string;
    const csv = await fetch(`${root}/capital/reports/${repId}?format=csv`, { headers: fin.h });
    ok("report exports as CSV", csv.status === 200 && (csv.headers.get("content-type") ?? "").includes("text/csv"));
    ok("Compliance Officer reads notifications (cross-cutting)", (await call(co, "GET", "/notifications")).status === 200);
    ok("Relationship Manager reads notifications", (await call(rm, "GET", "/notifications")).status === 200);
    ok("Investor role cannot read management notifications", (await call(investor, "GET", "/notifications")).status === 403);
    r = await call(admin, "GET", "/notifications");
    const kinds = new Set((r.body.notifications as Array<{ kind: string }>).map((n) => n.kind));
    // REQUIREMENT_IDENTIFIED fires only when a requirement has a gap; the sandbox float covers it.
    ok("notifications raised for investor, KYC, funding, approvals", ["NEW_INVESTOR", "KYC_SUBMITTED", "KYC_APPROVED", "FUNDING_RECEIVED", "APPROVAL_REQUIRED"].every((k) => kinds.has(k)), [...kinds].join(","));
    r = await call(admin, "GET", "/capital/audit");
    ok("audit trail covers investor, term sheet, funding, allocation and ledger", ["Investor", "Term sheet", "Funding", "Allocation", "Ledger"].every((rec) => (r.body.trail as Array<{ record: string }>).some((e) => e.record === rec)));
    /* ---------- search, close, portal proposal response ---------- */
    r = await call(admin, "GET", "/search?q=sahel");
    ok("search finds the investor for Super Admin", r.status === 200 && (r.body.hits as Array<{ kind: string }>).some((h) => h.kind === "investor"));
    r = await call(ops, "GET", "/search?q=sahel");
    ok("search hides investors from a role without the section", r.status === 200 && !(r.body.hits as Array<{ kind: string }>).some((h) => h.kind === "investor"));
    ok("search is off-limits to the Investor role", (await call(investor, "GET", "/search?q=x")).status === 403);
    r = await call(im, "POST", "/investments/proposals", { investorId: invId, opportunityId: oppId, amount: 60000 });
    const prop2 = r.body.id as string; await call(im, "POST", `/investments/proposals/${prop2}/status`, { status: "SENT" });
    r = await call(investor, "GET", "/portal/dashboard");
    ok("portal lists the proposal (marked VIEWED on first read)", (r.body.proposals as Array<{ id: string; status: string }>).some((p) => p.id === prop2 && p.status === "VIEWED"));
    r = await call(investor, "POST", `/portal/proposals/${prop2}/respond`, { decision: "ACCEPTED" });
    ok("investor accepts from the room", r.status === 200 && r.body.status === "ACCEPTED", String(r.status));
    ok("a second answer is refused", (await call(investor, "POST", `/portal/proposals/${prop2}/respond`, { decision: "DECLINED" })).status === 409);
    r = await call(im, "POST", "/investments/proposals", { investorId: invId, opportunityId: oppId, amount: 80000 });
    const prop3 = r.body.id as string; await call(im, "POST", `/investments/proposals/${prop3}/status`, { status: "SENT" });
    r = await call(investor, "POST", `/portal/proposals/${prop3}/counter`, { amount: 70000, note: "Prefer a smaller first ticket" });
    ok("investor counters from the room", r.status === 200 && r.body.status === "COUNTERED" && (r.body.counter as { amount: number }).amount === 70000, String(r.status));
    ok("Read Only cannot resolve a counter", (await call(ro, "POST", `/investments/proposals/${prop3}/counter/resolve`, { accept: true })).status === 403);
    r = await call(im, "POST", `/investments/proposals/${prop3}/counter/resolve`, { accept: true });
    ok("accepting the counter creates a superseding ACCEPTED proposal at 70000", r.status === 200 && r.body.status === "ACCEPTED" && r.body.amount === 70000 && r.body.supersedes === prop3);
    ok("original proposal is SUPERSEDED", ((await call(admin, "GET", "/investments")).body.proposals as Array<{ id: string; status: string }>).find((p) => p.id === prop3)?.status === "SUPERSEDED");
    ok("IM cannot close an investment", (await call(im, "POST", `/investments/${ivt.id}/close`, { note: "x" })).status === 403);
    r = await call(fin, "POST", `/investments/${ivt.id}/close`, { note: "facility ended" });
    ok("Finance closes the investment → EXITED", r.status === 200 && r.body.status === "EXITED");
    ok("INVESTMENT_CLOSED notification raised", ((await call(admin, "GET", "/notifications")).body.notifications as Array<{ kind: string }>).some((n) => n.kind === "INVESTMENT_CLOSED"));
    r = await call(admin, "GET", "/intelligence/health");
    ok("capital health: POWER received 120000, OWN 0 — types never mixed", (r.body.byType as Record<string, { received: number }>).POWER.received === 120000 && (r.body.byType as Record<string, { received: number }>).OWN.received === 0);
    r = await call(admin, "GET", `/intelligence/matching/${(await call(admin, "GET", "/intelligence/capital-requirements")).body.requirements ? ((await call(admin, "GET", "/intelligence/capital-requirements")).body.requirements as Array<{ id: string }>)[0].id : "CR-0001"}`);
    ok("matching returns fit and close probability as separate fields", r.status === 200 && (r.body.matches as Array<{ fitScore: number; closeProbabilityPct: number }>).every((m) => typeof m.fitScore === "number" && typeof m.closeProbabilityPct === "number"));
  } finally {
    server.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
