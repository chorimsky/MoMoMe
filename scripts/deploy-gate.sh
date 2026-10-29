#!/usr/bin/env bash
# Deploy gate — is the service that just came up fit to keep? Used by the CI deploy jobs and
# by hand after a manual `railway up`. Exits non-zero when it is not, so the caller can roll
# back (CI) or the operator can redeploy the previous build.
#   scripts/deploy-gate.sh <base-url> [expected-git-sha] [baseline-problems-file]
#
# THE QUESTION THIS ASKS is "did THIS BUILD make anything worse?" — not "is everything in
# the world healthy?". Those are different, and conflating them cost four days of deploys:
# /health/deep answers 503 on ANY problem, including a third party's collection rail being
# unreachable, so while Peexit's api host stayed NXDOMAIN no build could pass, however good
# it was. A gate that cannot pass during a vendor outage is a gate that gets switched off,
# and then nothing is gated at all.
#
# So a problem already present on the OLD build is reported and tolerated; a NEW problem
# fails. What stays absolute is everything the build itself owns: the version must be the
# one we deployed, and the synthetic quote — the call every customer path starts with — must
# work. No baseline file means no tolerance, so an unknown starting state fails closed.
set -euo pipefail
BASE="${1:?base url}"; WANT="${2:-}"; BASELINE_FILE="${3:-}"
# How long to wait for the new build to start answering. Defaults to ten minutes, which is
# what a cold Railway start needs; overridable so the gate's own tests do not take ten
# minutes per failing case, and so CI can choose its own patience.
TRIES="${GATE_TRIES:-40}"; NAP="${GATE_SLEEP:-15}"

problems_of() { # stdin: /health/deep body → one problem KIND per line
  # COMPARE KINDS, NOT SENTENCES. The first version diffed whole problem strings, and a
  # problem string carries detail that moves on its own: which rails are affected, why, and
  # (before the figures were redacted) how much. So a build that merely DESCRIBED an
  # existing condition better — naming the cause, or dropping a rail that never belonged in
  # the list — read as a brand-new problem and failed the gate. That happened twice in a row
  # on builds whose only crime was improved diagnostics, which is how a gate teaches people
  # to ignore it.
  #
  # The kind is the text before the first colon: "payout rail down", "collection rail down",
  # "funds not allocated to a carrier float". A NEW KIND is what this gate exists to catch.
  # Detail within a kind is reported in full below, just not counted as new.
  python3 -c 'import sys,json
try:
    d = json.load(sys.stdin)
    for p in (d.get("problems") or []):
        print(str(p).split(":")[0].strip().lower())
except Exception: pass'
}

# The baseline file holds whatever the previous build reported — full sentences. Reduce it
# to kinds with exactly the same rule, so both sides of the comparison speak one language.
# WHOSE PROBLEM IS IT? The gate asks "did THIS BUILD make anything worse?", and for that
# the problem kinds divide in two.
#
#   BUILD-OWNED  — the store is not durable, the money jobs have stopped, FX is stale.
#                  A deploy can genuinely cause these, and a new one must fail.
#   ENVIRONMENTAL — a rail is down, a vendor refuses our IP, a float is empty. A code
#                  deploy does not cause these, and they OSCILLATE on their own: the rail
#                  health tracker resets on restart, balance caches warm up, and a
#                  hard-down rail becomes eligible again for one probe every cooldown. So
#                  the same unchanged production reports a different set minute to minute.
#
# Comparing a single baseline sample against a single post-deploy sample therefore failed
# three good builds in a row: the old build happened to be between probes, the new one had
# warmed up, and the diff showed problems that had been there all week.
#
# Environmental kinds are reported in full and never fail the gate. What still protects the
# deploy is everything the build genuinely owns: the version must be the one we uploaded,
# the synthetic quote — the call every customer path starts with — must work, and any
# BUILD-OWNED problem that was not there before fails.
ENVIRONMENTAL='^(payout rail down|collection rail down|funds not allocated to a carrier float|rail unreachable)$'

kinds_of() { # stdin: one problem per line → one kind per line
  python3 -c 'import sys
for line in sys.stdin:
    t = line.strip()
    if t: print(t.split(":")[0].strip().lower())'
}

BASELINE=""
if [ -n "$BASELINE_FILE" ] && [ -f "$BASELINE_FILE" ]; then
  BASELINE=$(cat "$BASELINE_FILE")
  [ -n "$BASELINE" ] && echo "gate: tolerating problems that were ALREADY present before this deploy:" && printf '  · %s\n' $(printf '%s\n' "$BASELINE" | tr ' ' '_')
fi

echo "gate: waiting for $BASE/health/deep"
for i in $(seq 1 "$TRIES"); do
  body=$(curl -s -m 8 "$BASE/health/deep" || true)
  code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' "$BASE/health/deep" || echo 000)
  ver=$(printf '%s' "$body" | python3 -c 'import sys,json
try: print(json.load(sys.stdin).get("version") or "")
except Exception: print("")')
  # Every build reports its commit (APP_VERSION from CI, or the BUILD_VERSION file that
  # scripts/deploy.sh stamps into the export). When a SHA is expected it has to MATCH: an
  # empty or different version means the previous build is still the one answering, and
  # gating the OLD build is how a failed deploy gets called a success.
  # 200 = healthy, 503 = the degraded answer /health/deep gives when `problems` is non-empty.
  # Both are READ, and which problems they carry is what decides — but any OTHER status is a
  # refusal, not a degradation. An earlier draft of this replaced the status check with "the
  # body looks like JSON", which would have let a 500 carrying a JSON error body pass as
  # healthy: the exact over-correction this gate is supposed to be careful about.
  if { [ "$code" = "200" ] || [ "$code" = "503" ]; } && { [ -z "$WANT" ] || [ "${WANT:0:7}" = "$ver" ]; }; then
    now=$(printf '%s' "$body" | problems_of)
    # Which problems are new? comm needs sorted input; both sides may be empty.
    new=$(comm -13 <(printf '%s\n' "$BASELINE" | kinds_of | sort -u) <(printf '%s\n' "$now" | sed '/^$/d' | sort -u) || true)
    # Drop the kinds a deploy cannot cause — but ONLY when we have a baseline to reason
    # from. With no baseline the starting state is unknown, and an unknown state still
    # fails closed: that is a different situation (the service may never have been up, or
    # something may be badly wrong) and tolerating anything there would be assuming.
    if [ -n "$BASELINE" ]; then
      new=$(printf '%s\n' "$new" | sed '/^$/d' | grep -vE "$ENVIRONMENTAL" || true)
    fi
    if [ -n "$new" ]; then
      echo "gate: FAILED — this build introduced a NEW KIND of problem it owns:"
      printf '  ✗ %s\n' "$new"
      echo "gate: the full problem text from the live build:"
      printf '%s' "$body" | python3 -c 'import sys,json
try:
    for p in (json.load(sys.stdin).get("problems") or []): print("     ·", p)
except Exception: pass' 
      printf '%s\n' "$body"; exit 1
    fi
    if [ -n "$(printf '%s' "$now" | sed '/^$/d')" ]; then
      echo "gate: degraded, but by nothing new — pre-existing problem(s) only:"
      printf '%s' "$body" | python3 -c 'import sys,json
try:
    for p in (json.load(sys.stdin).get("problems") or []): print("  ·", p)
except Exception: pass' 
    elif [ "$code" = "503" ]; then
      # Degraded with nothing named. Not tolerable: it means something answered unhealthy
      # and could not say what, which is the one state a baseline comparison cannot reason
      # about.
      echo "gate: FAILED — 503 with an empty problems list; nothing to compare against."
      printf '%s\n' "$body"; exit 1
    else
      echo "gate: deep health OK (version ${ver:-?})"
    fi
    # A synthetic quote — the one call every customer path starts with. Absolute: this is
    # the build's own job, and no vendor outage excuses it.
    q=$(curl -s -m 10 -X POST "$BASE/api/quotes" -H 'content-type: application/json' -H 'x-mm-sender: deploy-gate' -d '{"xaf":5000,"method":"LIGHTNING","country":"CM"}' -o /dev/null -w '%{http_code}')
    if [ "$q" = "200" ] || [ "$q" = "201" ]; then echo "gate: synthetic quote OK (version ${ver:-?})"; exit 0; fi
    echo "gate: FAILED — synthetic quote returned $q"; printf '%s\n' "$body"; exit 1
  fi
  [ "$i" -lt "$TRIES" ] && sleep "$NAP"
done
echo "gate: FAILED — no JSON health response, or the old version is still answering (last version '${ver:-}', wanted '${WANT:0:7}'):"
printf '%s\n' "$body"; exit 1
