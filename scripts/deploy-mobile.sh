#!/usr/bin/env bash
# Publish the mobile app by hand, the same way .github/workflows/mobile.yml does — because
# for weeks it could not. Every Actions job on this repo was refused before it started
# ("The job was not started because your account is locked due to a billing issue"), so the
# OTA workflow never ran once and no phone received a JS change. The server had
# scripts/deploy.sh to fall back on; mobile had nothing.
#
#   scripts/deploy-mobile.sh ota      publish a JS-only update to the production channel
#   scripts/deploy-mobile.sh build    queue iOS + Android store builds on EAS
#
# Needs: a logged-in EAS CLI (`eas login`) or EXPO_TOKEN.
#
# WHAT AN OTA CAN AND CANNOT CARRY. runtimeVersion follows `version` in app.config.ts, so an
# update only reaches binaries of that same app version. A change that touches native code —
# a new native module, an icon, a splash, a permission — needs `build`, then a store release.
# This script refuses to guess which it is; it says what changed and leaves the call to you.
set -euo pipefail
WHAT="${1:-ota}"
REPO=$(git rev-parse --show-toplevel); cd "$REPO"
SHA=$(git rev-parse HEAD); SHORT=${SHA:0:7}
export NODE_OPTIONS="${NODE_OPTIONS:---dns-result-order=ipv4first}"   # fetch/eas time out without it

DIRTY=$(git status --porcelain -- mobile shared | grep -v '^??' || true)
[ -n "$DIRTY" ] && echo "note: mobile/ or shared/ has uncommitted changes — eas publishes the WORKING TREE, not $SHORT:" && printf '%s\n' "$DIRTY"

# The gate CI would have applied. A JS bundle that does not compile is a crash on a phone
# with no way back but another update, so this is not optional.
echo "mobile: typechecking…"
npm --prefix mobile run typecheck >/dev/null || { echo "mobile: TYPECHECK FAILED — nothing published."; exit 1; }
echo "mobile: typecheck clean"

VERSION=$(node -e "const c=require('./mobile/app.config.ts');" 2>/dev/null || grep -o "version: '[^']*'" mobile/app.config.ts | head -1 | cut -d"'" -f2)
echo "mobile: app version $VERSION (runtimeVersion follows it — an OTA reaches only $VERSION builds)"

case "$WHAT" in
  ota)
    # Native changes cannot ride an OTA. Name them rather than shipping a bundle that a
    # phone cannot run: app.config.ts (icons/splash/permissions/version) and package.json
    # (a new native module) are the two that matter.
    NATIVE=$(git diff --name-only HEAD~1 HEAD -- mobile/app.config.ts mobile/package.json 2>/dev/null || true)
    [ -n "$NATIVE" ] && {
      echo "mobile: WARNING — the last commit touched:"; printf '  %s\n' $NATIVE
      echo "mobile: if that added a native module or changed the app version, an OTA will NOT carry it; run '$0 build' instead."
    }
    MSG=$(git log -1 --pretty=%s)
    echo "mobile: OTA → production channel · \"$MSG\""
    ( cd mobile && npx eas-cli@latest update --channel production --non-interactive --message "$MSG" )
    echo "mobile: published. Phones on $VERSION pick it up on next launch."
    ( cd mobile && npx eas-cli@latest update:list --limit 3 --non-interactive 2>/dev/null | head -20 ) || true
    ;;
  build)
    echo "mobile: queueing iOS + Android production builds on EAS (not submitted — submission stays manual)"
    ( cd mobile && npx eas-cli@latest build --platform all --profile production --non-interactive --no-wait )
    echo "mobile: queued. Watch them with: cd mobile && npx eas-cli@latest build:list"
    ;;
  *) echo "usage: $0 [ota|build]"; exit 2;;
esac
