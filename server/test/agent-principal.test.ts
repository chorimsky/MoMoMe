/* ============================================================
   An agent is a principal that must be bounded before it can move money.

   §15 of the blueprint asks that an AI agent operate under explicit delegated authority and
   be unable to widen it. The least honest way to satisfy that would be a `kind: "agent"`
   field that changes nothing — so what is asserted here is that declaring a credential an
   agent can only ever take authority AWAY:

     • an agent with no delegation bound to it cannot create LIVE payments at all;
     • the organization's DEFAULT limit rule does not count as its delegation — the default
       bounds every caller, so accepting it would make the declaration meaningless;
     • the sandbox is exempt, because a rehearsal environment that refuses teaches nothing
       except to avoid the rehearsal environment;
     • an agent can never do more than the server credential it was promoted from;
     • promoting or demoting is its own operation, not something that rides along in an edit;
     • rotation preserves the kind, or rotating an agent's key would quietly promote it.
   Run: pnpm --filter @momome/server test:agent
   ============================================================ */
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { createCredential, setPrincipalKind, updateCredential, rotateCredential, getCredential, authenticate } = await import("../src/core/platform/credentials.js");
  const { upsertLimitRule, delegationsFor, _resetLimits } = await import("../src/core/platform/limits.js");
  const { createOrganization, applicationsOf } = await import("../src/core/platform/orgs.js");

  const org = createOrganization({ name: "Agent Co", ownerUserId: "u1" });
  const appId = applicationsOf(org.id)[0]?.id ?? "app_default";
  const mint = (over: Record<string, unknown> = {}) =>
    createCredential({ orgId: org.id, appId, env: "test", label: "k", createdBy: "u1", ...over } as Parameters<typeof createCredential>[0]);

  console.log("\nThe agent principal");

  /* 1. The default is unchanged. Declaring nothing means a server credential. */
  const server = mint();
  assert.ok(server.ok);
  ok("a credential with no declared kind is a server credential", server.credential.kind === undefined);

  /* 2. An agent is declarable, and declaring it is its OWN operation. */
  const agent = mint({ kind: "agent" });
  assert.ok(agent.ok);
  ok("an agent credential can be minted as one", agent.credential.kind === "agent");
  const promoted = setPrincipalKind(server.credential.id, "agent");
  ok("a server credential can be promoted", promoted?.kind === "agent");
  ok("…and demoted again", setPrincipalKind(server.credential.id, "server")?.kind === undefined);
  // The kind must not be changeable as a side effect of editing something else.
  updateCredential(agent.credential.id, { label: "renamed" } as Parameters<typeof updateCredential>[1]);
  ok("editing a credential cannot change its kind", getCredential(agent.credential.id)?.kind === "agent");
  ok("…and the edit it WAS asked for still happened", getCredential(agent.credential.id)?.label === "renamed");

  /* 3. Rotation preserves the kind. Otherwise rotating an agent's key promotes it. */
  const rolled = rotateCredential(agent.credential.id, "u1");
  assert.ok(rolled.ok);
  ok("rotating an agent credential yields an agent credential", rolled.credential.kind === "agent");
  ok("…and the new secret works", authenticate(rolled.secret).ok === true);
  const rolledServer = rotateCredential(server.credential.id, "u1");
  assert.ok(rolledServer.ok);
  ok("rotating a server credential does not make it an agent", rolledServer.credential.kind === undefined);

  /* 4. WHAT COUNTS AS A DELEGATION. The environment default must not. */
  _resetLimits(); // restores the two built-in defaults (live, test)
  const live = { env: "live" as const };
  ok("the built-in defaults are not a delegation for any credential", delegationsFor("cred_anything", live.env).length === 0, JSON.stringify(delegationsFor("cred_anything", live.env).map((r) => r.id)));
  // A rule scoped to the whole organization is a policy, not a delegation either.
  upsertLimitRule({ name: "org-wide", enabled: true, priority: 5, scope: { orgIds: [org.id], envs: ["live"] }, ceilings: { maxTransactionXaf: 1000 } } as Parameters<typeof upsertLimitRule>[0]);
  ok("an organization-wide rule is not a delegation either", delegationsFor("cred_x", live.env).length === 0);
  // Only a rule bound to the credential counts.
  const bound = upsertLimitRule({ name: "the agent's bounds", enabled: true, priority: 1, scope: { credentialIds: ["cred_x"], envs: ["live"] }, ceilings: { maxTransactionXaf: 50_000 } } as Parameters<typeof upsertLimitRule>[0]);
  ok("a rule bound to the credential is its delegation", delegationsFor("cred_x", live.env).map((r) => r.id).includes(bound.id));
  ok("…and it is not another credential's", delegationsFor("cred_y", live.env).length === 0);

  /* 5. A delegation that is disabled, expired or for the other environment is not in force. */
  upsertLimitRule({ id: bound.id, name: bound.name, enabled: false, priority: 1, scope: { credentialIds: ["cred_x"], envs: ["live"] }, ceilings: bound.ceilings } as Parameters<typeof upsertLimitRule>[0]);
  ok("a disabled delegation is not in force", delegationsFor("cred_x", live.env).length === 0);
  upsertLimitRule({ id: bound.id, name: bound.name, enabled: true, priority: 1, scope: { credentialIds: ["cred_x"], envs: ["live"] }, ceilings: bound.ceilings, notAfter: "2020-01-01T00:00:00Z" } as Parameters<typeof upsertLimitRule>[0]);
  ok("an expired delegation is not in force", delegationsFor("cred_x", live.env).length === 0);
  upsertLimitRule({ id: bound.id, name: bound.name, enabled: true, priority: 1, scope: { credentialIds: ["cred_x"], envs: ["test"] }, ceilings: bound.ceilings } as Parameters<typeof upsertLimitRule>[0]);
  ok("a test-environment delegation does not bound live", delegationsFor("cred_x", "live").length === 0);
  ok("…but it does bound test", delegationsFor("cred_x", "test").length === 1);

  /* 6. THE GATE ITSELF. The route that enforces it runs only on a live deployment, which a
        test deployment cannot be — so the predicate is asserted directly rather than left
        as the one rule nobody has checked outside production. */
  const { agentWithoutDelegation } = await import("../src/core/platform/limits.js");
  _resetLimits();
  const asAgent = { id: "cred_bare", kind: "agent" as const };
  const asServer = { id: "cred_bare", kind: undefined };
  ok("an unbounded agent is refused on live", agentWithoutDelegation(asAgent, "live") === true);
  ok("…and is NOT refused in the sandbox", agentWithoutDelegation(asAgent, "test") === false);
  ok("a server credential is never refused by this rule", agentWithoutDelegation(asServer, "live") === false);
  upsertLimitRule({ name: "bounds for cred_bare", enabled: true, priority: 1, scope: { credentialIds: ["cred_bare"], envs: ["live"] }, ceilings: { maxTransactionXaf: 10_000 } } as Parameters<typeof upsertLimitRule>[0]);
  ok("…and a bounded agent is allowed through on live", agentWithoutDelegation(asAgent, "live") === false);
  // The bounds must be IN FORCE, not merely present: an expired delegation leaves the agent
  // unbounded again, which is the state the rule exists to refuse.
  _resetLimits();
  upsertLimitRule({ name: "lapsed bounds", enabled: true, priority: 1, scope: { credentialIds: ["cred_bare"], envs: ["live"] }, ceilings: { maxTransactionXaf: 10_000 }, notAfter: "2020-01-01T00:00:00Z" } as Parameters<typeof upsertLimitRule>[0]);
  ok("an agent whose delegation has lapsed is refused again", agentWithoutDelegation(asAgent, "live") === true);

  console.log(`\n✅ agent-principal: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
