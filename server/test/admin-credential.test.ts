/* The admin credential the console ACTUALLY accepts.

   ADMIN_PASSWORD is read exactly once — when the first admin is seeded. After that the
   credential is a scrypt hash in the persisted store, and the environment variable is
   inert. assertAdminSecurity() checks the env var, so it can disagree with reality in both
   directions, and the dangerous direction is a false all-clear on the single credential
   guarding the treasury. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

async function main() {
  console.log("\nAdmin credential — the stored one, not the environment variable");
  const { seedAdminUsers, storedAdminMatches, verifyCredentials, findByUsername, setPassword } =
    await import("../src/core/adminUsers.js");

  ok("no admin seeded yet → unknown, not 'fine'", storedAdminMatches("anything") === null);

  // Seed as a deployment would with ADMIN_PASSWORD unset: the built-in default.
  seedAdminUsers();
  ok("seeding creates the 'admin' account", !!findByUsername("admin"));
  ok("the stored credential is detectably the DEFAULT", storedAdminMatches("momome-admin") === true);
  ok("…and the default genuinely logs in", !!verifyCredentials("admin", "momome-admin"));

  // THE TRAP: set ADMIN_PASSWORD after seeding. The env var now says "not default" while
  // the console still accepts the default — exactly the false all-clear.
  process.env.ADMIN_PASSWORD = "a-strong-rotated-password";
  ok("rotating ADMIN_PASSWORD does NOT change the login password",
    !verifyCredentials("admin", "a-strong-rotated-password"));
  ok("…the OLD password still works — the rotation was a no-op",
    !!verifyCredentials("admin", "momome-admin"));
  ok("storedAdminMatches sees through it: still the default",
    storedAdminMatches("momome-admin") === true);
  ok("…and reports the env var does NOT match what is stored",
    storedAdminMatches("a-strong-rotated-password") === false);

  // Resetting properly (console / /admin/forgot) is what actually changes it.
  const u = findByUsername("admin")!;
  setPassword(u.id, "a-strong-rotated-password");
  ok("an actual reset changes the login", !!verifyCredentials("admin", "a-strong-rotated-password"));
  ok("…and the default stops working", !verifyCredentials("admin", "momome-admin"));
  ok("…and it no longer reads as default", storedAdminMatches("momome-admin") === false);

  console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
