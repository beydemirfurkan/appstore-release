#!/usr/bin/env bash
# Try the whole flow with no Apple account: a fake App Store Connect on loopback,
# a throwaway API key, the "Wellness" demo project, and `appstore-release` on
# PATH. Nothing leaves your machine. Works in bash and zsh:
#
#   source scripts/demo/setup.sh
#   appstore-release check            # then: release, submit --submit, check
#   demo-stop                         # stop the fake server
#
# The VHS tapes in docs/media/tapes/ source this before they start recording.
# Sourced into the recording shell, so no `set -e`: a blocked `check` exits 4 by design.
# BASH_SOURCE in bash; the %x prompt expansion is zsh's name for the same thing.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")/../.." && pwd)"
PORT="${DEMO_PORT:-4010}"
WORK="$(mktemp -d)"

# A server left over from an interrupted recording would serve its old state.
lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null || true
node "$REPO/scripts/demo/server.mjs" "$PORT" 2>/dev/null &
echo $! > "$WORK/server.pid"
node --input-type=module -e "
  import { writeWellnessProject } from '$REPO/test/helpers/fixture-project.mjs';
  import { generateKeyPairSync } from 'node:crypto';
  import { writeFileSync } from 'node:fs';
  writeWellnessProject('$WORK/wellness');
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  writeFileSync('$WORK/AuthKey_DEMO123456.p8', privateKey.export({ type: 'pkcs8', format: 'pem' }));
"
mkdir -p "$WORK/bin"
ln -s "$REPO/src/cli.mjs" "$WORK/bin/appstore-release"

export PATH="$WORK/bin:$PATH"
export APPSTORE_RELEASE_API_BASE="http://127.0.0.1:$PORT"
export ASC_KEY_ID=DEMO123456 ASC_ISSUER_ID=69a6de00-0000-0000-0000-000000000000
export ASC_P8_PATH="$WORK/AuthKey_DEMO123456.p8" ASC_APP_ID=1234567890
export DEMO_WORK="$WORK"
demo-stop() { kill "$(cat "$DEMO_WORK/server.pid")" 2>/dev/null && echo "fake App Store Connect stopped"; }
cd "$WORK/wellness"
sleep 0.4
echo "Demo ready in $WORK/wellness — a fake App Store Connect is serving the app \"Wellness\"."
echo "Try: appstore-release check   (then release, submit --submit, check; demo-stop when done)"
