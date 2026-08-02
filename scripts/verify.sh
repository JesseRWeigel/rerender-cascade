#!/usr/bin/env bash
# Verification for rerender-cascade.
#
# Every claim this project makes is a claim about React, so every check here ends up running React.
# The unit suite asserts the expected cascade of each scenario against a live run; the recount in
# scripts/independent-check.mjs measures the same thing off React's own fiber flags with code that
# shares nothing with the instrumentation; the browser check loads the published page in Chromium,
# because a page whose whole inline script fails to parse still looks fine and still passes every
# Node test. scripts/sabotage.sh then breaks each of those on purpose and requires them to notice.
#
# Nothing here is skipped. A missing dependency fails with the command that installs it.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$PWD
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); }
# ${var/#$HOME/~} tilde-expands the replacement and silently does nothing, so the ~ is escaped.
rel() { printf '%s' "${1/#$HOME/\~}"; }

echo "rerender-cascade verification"
echo "  node $(node -v), repo $(rel "$ROOT")"
echo

echo "1. dependencies"
if [ ! -d node_modules ]; then
  echo "  installing dependencies (node_modules is absent)"
  if ! npm install --no-audit --no-fund >"$TMP/install.log" 2>&1; then
    bad "npm install failed. Run: npm install"
    tail -15 "$TMP/install.log" | sed 's/^/        /'
  fi
fi
for pkg in react react-dom jsdom playwright-core; do
  if node -e "require.resolve('$pkg/package.json')" 2>/dev/null; then
    ok "$pkg $(node -p "require('$pkg/package.json').version")"
  else
    bad "$pkg is missing. Run: npm install"
  fi
done
echo

echo "2. unit suite: every expected cascade against a live React run"
if node --test "test/*.test.mjs" >"$TMP/unit.log" 2>&1; then
  TESTS=$(grep -oE 'pass [0-9]+' "$TMP/unit.log" | tail -1 | grep -oE '[0-9]+')
  ok "$TESTS unit tests pass"
else
  TESTS=0
  bad "unit suite"
  grep -E '^not ok|Error|AssertionError' "$TMP/unit.log" | head -20 | sed 's/^/        /'
fi
echo

echo "3. the recording still matches what React does right now"
if node scripts/record.mjs --check >"$TMP/record.log" 2>&1; then
  ok "$(cat "$TMP/record.log")"
else
  bad "data/cascades.json is stale"
  sed 's/^/        /' "$TMP/record.log"
fi
SCENARIOS=$(node -p "JSON.parse(require('fs').readFileSync('data/cascades.json','utf8')).scenarios.length")
ACTIONS=$(node -p "JSON.parse(require('fs').readFileSync('data/cascades.json','utf8')).scenarios.reduce((n,s)=>n+s.runs.length,0)")
VERDICTS=$(node -p "JSON.parse(require('fs').readFileSync('data/cascades.json','utf8')).scenarios.reduce((n,s)=>n+s.runs.reduce((m,r)=>m+r.nodes.length,0),0)")
RENDERS=$(node -p "JSON.parse(require('fs').readFileSync('data/cascades.json','utf8')).scenarios.reduce((n,s)=>n+s.runs.reduce((m,r)=>m+r.nodes.reduce((k,x)=>k+x.renderCount,0),0),0)")
REACT=$(node -p "JSON.parse(require('fs').readFileSync('data/cascades.json','utf8')).react")
ok "$SCENARIOS scenarios, $ACTIONS recorded state changes, $VERDICTS component verdicts, $RENDERS re-renders, React $REACT"
echo

echo "4. independent recount off React's own fiber flags"
if node scripts/independent-check.mjs >"$TMP/indep.log" 2>&1; then
  ok "$(grep 'independent fiber recount' "$TMP/indep.log")"
  grep '^  note' "$TMP/indep.log" | sed 's/^  note/      note/' || true
else
  bad "the independent recount disagrees with the instrumentation"
  sed 's/^/        /' "$TMP/indep.log" | head -20
fi
echo

echo "5. every claimed optimisation has a run where it fails"
# Each pair below must contain one variant where the component skips and one where it does not.
if node -e '
const data = JSON.parse(require("fs").readFileSync("data/cascades.json", "utf8"));
const groups = new Map();
for (const s of data.scenarios) {
  if (!groups.has(s.group)) groups.set(s.group, []);
  groups.get(s.group).push(s);
}
let bad = 0;
for (const [group, list] of groups) {
  const variants = new Set(list.map((s) => s.variant));
  if (variants.size === 1 && variants.has("control")) continue;
  if (!variants.has("works") || !variants.has("defeated")) {
    console.log(`group ${group} lacks a paired control: ${[...variants].join(", ")}`);
    bad += 1;
    continue;
  }
  const skips = list.filter((s) => s.runs.some((r) => r.nodes.some((n) => n.renderCount === 0 && ["memo-bailout","element-identity","ancestor-skipped","state-bailout","render-then-bailout"].includes(n.reason))));
  const renders = list.filter((s) => s.variant === "defeated" && s.runs.some((r) => r.nodes.some((n) => n.renderCount > 0 && n.name !== r.owner)));
  if (!skips.length || !renders.length) {
    console.log(`group ${group} does not demonstrate both outcomes`);
    bad += 1;
  }
}
if (bad) process.exit(1);
console.log(`${groups.size} scenario groups, every optimisation paired with a run where it does not work`);
' >"$TMP/pairs.log" 2>&1; then
  ok "$(cat "$TMP/pairs.log")"
else
  bad "a claimed optimisation has no negative control"
  sed 's/^/        /' "$TMP/pairs.log"
fi
echo

echo "6. the page is generated from the recording"
if node scripts/build-docs.mjs --check >"$TMP/docs.log" 2>&1; then
  ok "$(cat "$TMP/docs.log")"
else
  bad "docs/index.html is stale or hand-edited"
  sed 's/^/        /' "$TMP/docs.log"
fi
echo

echo "6b. the page is self-contained"
selfcontained=0
head -3 docs/index.html | grep -qi '^<!doctype html>' || { bad "docs/index.html has no doctype"; selfcontained=1; }
grep -q '<meta charset="utf-8">' docs/index.html || { bad "docs/index.html has no charset"; selfcontained=1; }
grep -q '<meta name="viewport" content="width=device-width' docs/index.html || { bad "docs/index.html has no viewport"; selfcontained=1; }
# Any request to another host would make the page depend on the network. There must be none.
if grep -nEo '(src|href)="[^"]*"' docs/index.html | grep -vE '="#' | grep -q .; then
  bad "docs/index.html references an external resource"
  grep -nEo '(src|href)="[^"]*"' docs/index.html | head -5 | sed 's/^/        /'
  selfcontained=1
fi
if grep -qE '<link |@import|https?://' docs/index.html; then
  bad "docs/index.html pulls in an external stylesheet, font or URL"
  grep -nE '<link |@import|https?://' docs/index.html | head -5 | sed 's/^/        /'
  selfcontained=1
fi
# body { overflow-x: hidden } masks real overflow and makes the browser probe vacuous.
if grep -qE 'overflow-x:\s*hidden' docs/index.html; then
  bad "docs/index.html hedges against overflow with overflow-x: hidden"
  selfcontained=1
fi
[ "$selfcontained" = "0" ] && ok "doctype, charset, viewport, no external resources, no overflow-x: hidden"
echo

echo "7. the page in a real browser"
if node scripts/check-page.mjs >"$TMP/page.log" 2>&1; then
  ok "$(grep 'browser check' "$TMP/page.log")"
  sed -n 's/^  ok/      ok/p' "$TMP/page.log"
else
  bad "browser check of docs/index.html"
  sed 's/^/        /' "$TMP/page.log"
fi
echo

echo "8. sabotage: break each check on purpose and require it to notice"
if bash scripts/sabotage.sh >"$TMP/sab.log" 2>&1; then
  SABOTAGES=$(grep -c '^  ok ' "$TMP/sab.log")
  ok "$(tail -1 "$TMP/sab.log")"
  sed -n 's/^  \.\./      /p' "$TMP/sab.log"
else
  SABOTAGES=0
  bad "a sabotage went unnoticed"
  sed 's/^/        /' "$TMP/sab.log"
fi
echo

echo "9. nothing private or oversized in git"
if git ls-files -z | xargs -0 grep -lI "$HOME" 2>/dev/null | grep -v '^$'; then
  bad "a tracked file contains an absolute home path"
else
  ok "no absolute home paths in tracked files"
fi
# Case-sensitive on purpose: AWS key ids are uppercase, and -i turns every base64 blob into a hit.
if git ls-files -z | xargs -0 grep -lE '(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{10,})' 2>/dev/null | grep -v '^$'; then
  bad "a tracked file looks like it contains a credential"
else
  ok "no credential-shaped strings in tracked files"
fi
# grep classifies a file with a NUL byte as binary and skips it, which would make the two scans
# above silently blind to that file. grep -P is not available on every box here, so python looks.
if nulfiles=$(git ls-files | python3 -c '
import sys
bad = []
for line in sys.stdin.read().split():
    try:
        if b"\x00" in open(line, "rb").read():
            bad.append(line)
    except OSError:
        pass
print(" ".join(bad))
') && [ -z "$nulfiles" ]; then
  ok "no tracked file contains a NUL byte, so the scans above could read all of them"
else
  bad "tracked files contain NUL bytes and were skipped by the scans: $nulfiles"
fi
if git ls-files | grep -qE '^node_modules/'; then
  bad "node_modules is tracked"
else
  ok "node_modules is not tracked"
fi
big=$(git ls-files | xargs -r du -k 2>/dev/null | awk '$1 > 1024 {print $2 " (" $1 "KB)"}')
if [ -z "$big" ]; then
  ok "no tracked file is over 1 MB ($(git ls-files | wc -l) files, $(git ls-files | xargs -r du -ck 2>/dev/null | tail -1 | cut -f1) KB total)"
else
  bad "tracked files over 1 MB: $big"
fi
echo

echo "10. the README block regenerates from the recording"
if node scripts/build-readme.mjs --check >"$TMP/readme.log" 2>&1; then
  ok "$(cat "$TMP/readme.log")"
else
  bad "the measured block in README.md is stale"
  sed 's/^/        /' "$TMP/readme.log"
fi
echo

echo "11. the README says what this run says"
SENTINEL="rerender-cascade verification passed"
if [ ! -f README.md ]; then
  bad "README.md is missing"
elif ! grep -q '^## Status' README.md; then
  bad "README.md has no ## Status section"
else
  ok "README.md has a Status section"
  for claim in "$SENTINEL" "$TESTS unit tests pass" "$SCENARIOS scenarios" "$VERDICTS component verdicts" "$RENDERS re-renders" "React $REACT" "$SABOTAGES sabotage"; do
    if grep -qF "$claim" README.md; then
      ok "README states \"$claim\""
    else
      bad "README does not state \"$claim\"; regenerate the Status block from a real run"
    fi
  done
fi
echo

echo "$pass passed, $fail failed"
if [ "$fail" != "0" ]; then
  exit 1
fi
echo "$SENTINEL"
