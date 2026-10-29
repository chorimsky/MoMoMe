#!/usr/bin/env bash
# The deploy gate's decision table, against a fake /health/deep.
#
# Worth having as a test rather than a one-off check, because the gate is the thing that
# decides whether a build stays, it is only ever exercised during a real deploy, and the
# change it is being tested for LOOSENED it: pre-existing problems no longer fail a deploy.
# A loosening with no test is how a gate becomes decoration.
#
#   scripts/test/deploy-gate.test.sh
set -u
cd "$(dirname "$0")/../.."
export GATE_TRIES=2 GATE_SLEEP=1
FAKE="scripts/test/fake-health.py"
pass=0; fail=0

run_case() { # name, health-code, body, baseline, quote-code, expected-exit
  local name="$1" code="$2" body="$3" baseline="$4" quote="$5" expect="$6"
  local port=$((18000 + RANDOM % 900)) tmp; tmp=$(mktemp)
  printf '%s' "$baseline" > "$tmp"
  FAKE_BODY="$body" FAKE_CODE="$code" FAKE_QUOTE="$quote" python3 "$FAKE" "$port" & local pid=$!
  sleep 1
  local out rc
  out=$(bash scripts/deploy-gate.sh "http://127.0.0.1:$port" "abc1234" "$tmp" 2>&1); rc=$?
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null; rm -f "$tmp"
  if [ "$rc" = "$expect" ]; then printf "  ✓ %s\n" "$name"; pass=$((pass+1))
  else printf "  ✗ %s (exit %s, wanted %s)\n---\n%s\n---\n" "$name" "$rc" "$expect" "$out"; fail=$((fail+1)); fi
}

echo
echo "The deploy gate's decision table"
V='"version":"abc1234"'
PEEXIT="collection rail down: peexit"

# The case the change was made FOR: a vendor outage that has lasted days must not block a
# good build for ever, or the gate gets switched off and nothing is gated.
run_case "a pre-existing vendor problem is tolerated"  503 "{$V,\"problems\":[\"$PEEXIT\"]}"                         "$PEEXIT" 200 0
# …and the thing that must not be lost by making it tolerant.
run_case "a NEW problem still fails the deploy"        503 "{$V,\"problems\":[\"$PEEXIT\",\"ledger is not durable\"]}" "$PEEXIT" 200 1
# The third false failure: problems that come from LEARNED state. A rail's health resets on
# restart, balance caches warm up, and a hard-down rail goes eligible again for one probe
# every cooldown — so the same unchanged production reports a different set minute to
# minute. The old build happened to be between probes; the new one had warmed up.
run_case "an environmental problem appearing after warm-up is not the build's fault"  503 "{$V,\"problems\":[\"$PEEXIT\",\"payout rail down: peexit\",\"funds not allocated to a carrier float: campay holds an amount\"]}"  "$PEEXIT" 200 0
# But a BUILD-OWNED problem appearing beside them still fails: the exemption is for the
# kinds a deploy cannot cause, not a blanket tolerance.
run_case "a build-owned problem still fails beside environmental ones"  503 "{$V,\"problems\":[\"payout rail down: peexit\",\"money jobs have not completed in the last 3 minutes\"]}"  "$PEEXIT" 200 1

# The two false failures that prompted the kind-based comparison. Both were builds whose
# only change was describing an EXISTING condition better — one named the cause, the other
# dropped a rail that never belonged in the list. Under string comparison each read as a
# brand-new problem and failed a good deploy.
run_case "the same problem, now naming its cause, is not new"  503 "{$V,\"problems\":[\"collection rail down: peexit (egress IP not allowlisted)\"]}"  "collection rail down: peexit" 200 0
run_case "the same problem, with a rail removed from it, is not new"  503 "{$V,\"problems\":[\"funds not allocated to a carrier float: campay holds an amount\"]}"  "funds not allocated to a carrier float: campay holds an amount; pawapay holds an amount" 200 0

run_case "an unknown starting state fails closed"      503 "{$V,\"problems\":[\"$PEEXIT\"]}"                         ""        200 1
run_case "a clean build on a clean baseline passes"    200 "{$V,\"problems\":[]}"                                    ""        200 0
run_case "a problem this build FIXED is not held against it" 200 "{$V,\"problems\":[]}"                              "$PEEXIT" 200 0
# Degraded but unable to say why: the one state a baseline comparison cannot reason about.
run_case "503 with an empty problems list fails"       503 "{$V,\"problems\":[]}"                                    ""        200 1
# The build's own job, which no vendor outage excuses.
run_case "a broken synthetic quote fails even so"      200 "{$V,\"problems\":[]}"                                    ""        500 1
# And the two ways a gate can accidentally approve the wrong thing.
run_case "a 500 carrying JSON is not 'healthy'"        500 "{$V,\"problems\":[]}"                                    ""        200 1
run_case "the OLD version still answering fails"       200 "{\"version\":\"old9999\",\"problems\":[]}"               ""        200 1

echo
if [ "$fail" = 0 ]; then echo "✅ deploy-gate: $pass cases passed"; else echo "❌ deploy-gate: $pass passed, $fail failed"; exit 1; fi
