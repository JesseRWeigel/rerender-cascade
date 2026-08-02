#!/usr/bin/env bash
# Attack this project's own checks and require them to notice.
#
# Every sabotage runs in a throwaway copy of the tree. Each one is PROVED to have changed real
# output before anything is concluded from it: an observation command runs before and after the
# edit and the two outputs must differ. A sabotage that did not apply is a no-op with a confident
# write-up attached, and concluding "the verify has a gap" from one is worse than not trying.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT=$PWD
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
ok() { printf '  ok    %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; fail=$((fail + 1)); }

n=0
# run_sabotage <name> <python-patch-file> <observe-cmd> <check-cmd>
run_sabotage() {
  local name=$1 patch=$2 observe=$3 check=$4
  n=$((n + 1))
  local dir="$TMP/s$n"
  mkdir -p "$dir"
  git -C "$ROOT" ls-files -z | tar -C "$ROOT" --null -T - -cf - | tar -C "$dir" -xf -
  ln -s "$ROOT/node_modules" "$dir/node_modules"

  local before after
  before=$(cd "$dir" && eval "$observe" 2>&1)

  if ! (cd "$dir" && python3 - <<PATCH
$(cat "$patch")
PATCH
  ); then
    bad "$name: the patch did not apply, so it proves nothing"
    return
  fi

  after=$(cd "$dir" && eval "$observe" 2>&1)
  if [ "$before" = "$after" ]; then
    bad "$name: the sabotage changed no observable output, so it proves nothing"
    return
  fi
  local delta
  delta=$(diff <(printf '%s\n' "$before") <(printf '%s\n' "$after") | grep -c '^[<>]' || true)
  printf '  ..    %s: sabotage changed %s line(s) of real output\n' "$name" "$delta"

  if (cd "$dir" && eval "$check" >"$dir/check.log" 2>&1); then
    bad "$name: the sabotage was NOT caught (check exited 0)"
    sed 's/^/        /' "$dir/check.log" | tail -12
  else
    ok "$name: caught, $(grep -cE '(FAIL|not ok|✖|Error)' "$dir/check.log" || true) failure line(s) reported"
  fi
}

echo "sabotage suite"
echo

mkdir -p "$TMP/patches"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/1.py" <<'PY'
# 1. The probe silently drops one component's renders. This is the classic instrumentation bug:
#    the page would report a memo working perfectly when it is not.
import sys
p = 'src/probe.mjs'
s = open(p).read()
old = "  function probe(name, props, extra) {"
assert old in s, 'anchor missing'
s = s.replace(old, old + "\n    if (name === 'MemoToolbar') return;", 1)
open(p, 'w').write(s)
PY
run_sabotage "probe drops MemoToolbar renders" "$TMP/patches/1.py" \
  "node scripts/observe.mjs" \
  "node --test 'test/*.test.mjs'"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/2.py" <<'PY'
# 2. Attribution compares props by value instead of by identity. React compares identity, so this
#    makes every "a new object with the same contents is a changed prop" claim silently vanish.
p = 'src/attribute.mjs'
s = open(p).read()
old = "    if (!Object.is((prev || {})[key], (next || {})[key])) changed.push(key);"
assert old in s, 'anchor missing'
new = "    if (JSON.stringify((prev || {})[key]) !== JSON.stringify((next || {})[key])) changed.push(key);"
s = s.replace(old, new, 1)
open(p, 'w').write(s)
PY
run_sabotage "attribution compares props by value, not identity" "$TMP/patches/2.py" \
  "node scripts/observe.mjs" \
  "node --test 'test/*.test.mjs'"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/3.py" <<'PY'
# 3. Attribution reports a React.memo bail-out for a component React never even reached. This is
#    the failure where the page credits an optimisation that did nothing.
p = 'src/attribute.mjs'
s = open(p).read()
old = """      else if (node.parent && !rendered(node.parent)) reason = 'ancestor-skipped';"""
assert old in s, 'anchor missing'
new = """      else if (node.memo) reason = 'memo-bailout';
      else if (node.parent && !rendered(node.parent)) reason = 'ancestor-skipped';"""
s = s.replace(old, new, 1)
open(p, 'w').write(s)
PY
run_sabotage "attribution credits memo for a subtree React never reached" "$TMP/patches/3.py" \
  "node scripts/observe.mjs" \
  "node --test 'test/*.test.mjs'"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/4.py" <<'PY'
# 4. The scenario that is supposed to demonstrate the fix quietly stops applying the fix. Without
#    the paired negative control, "useMemo around the context value prevents this" would be a
#    claim with nothing behind it.
p = 'src/scenarios.mjs'
s = open(p).read()
old = "        const value = memoiseValue ? memoised : { user };"
assert old in s, 'anchor missing'
s = s.replace(old, "        const value = { user };", 1)
open(p, 'w').write(s)
PY
run_sabotage "the fixed variant stops applying its fix" "$TMP/patches/4.py" \
  "node scripts/observe.mjs" \
  "node --test 'test/*.test.mjs'"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/5.py" <<'PY'
# 5. A render count in the published data is edited by hand. Nothing in the source changes, so
#    only a recount against real React can catch it.
import json
p = 'data/cascades.json'
d = json.load(open(p))
hits = 0
for sc in d['scenarios']:
    if sc['id'] != 'memo-inline-object':
        continue
    for run in sc['runs']:
        for node in run['nodes']:
            if node['name'] == 'MemoToolbar':
                assert node['renderCount'] == 1, node['renderCount']
                node['renderCount'] = 0
                node['rendered'] = False
                node['reason'] = 'memo-bailout'
                hits += 1
assert hits == 1, hits
open(p, 'w').write(json.dumps(d, indent=2) + '\n')
PY
run_sabotage "a render count in data/cascades.json is edited by hand" "$TMP/patches/5.py" \
  "node scripts/independent-check.mjs; node scripts/record.mjs --check" \
  "node scripts/independent-check.mjs && node scripts/record.mjs --check"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/6.py" <<'PY'
# 6. A number on the published page is edited by hand while the data stays correct. The Node
#    suite never loads the page, so only the page checks can catch this.
p = 'docs/index.html'
s = open(p).read()
old = '<b id="stat-renders">'
assert old in s, 'anchor missing'
i = s.index(old) + len(old)
j = s.index('<', i)
value = s[i:j]
assert value.isdigit(), value
s = s[:i] + str(int(value) + 7) + s[j:]
open(p, 'w').write(s)
PY
run_sabotage "a number on docs/index.html is edited by hand" "$TMP/patches/6.py" \
  "node scripts/build-docs.mjs --check" \
  "node scripts/build-docs.mjs --check"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/7.py" <<'PY'
# 7. The page's inline script gets one unbalanced parenthesis. The file still looks fine, the
#    static HTML still renders, and every Node test still passes.
p = 'docs/index.html'
s = open(p).read()
old = "  var DATA = JSON.parse(document.getElementById('cascade-data').textContent);"
assert old in s, 'anchor missing'
s = s.replace(old, "  var DATA = JSON.parse((document.getElementById('cascade-data').textContent);", 1)
open(p, 'w').write(s)
PY
run_sabotage "the page's inline script no longer parses" "$TMP/patches/7.py" \
  "grep -c 'JSON.parse((document' docs/index.html || true" \
  "node scripts/check-page.mjs"

# ---------------------------------------------------------------------------------------------
cat >"$TMP/patches/8.py" <<'PY'
# 8. The independent recount loses the rule that makes it independent-and-correct: without the
#    stale-fiber-flag filter it disagrees with the instrumentation everywhere, which must fail
#    rather than be quietly tolerated.
p = 'scripts/independent-check.mjs'
s = open(p).read()
old = "if ((fiber.flags & PERFORMED_WORK) !== 0 && !previousFibers.has(fiber)) worked.push(name);"
assert old in s, 'anchor missing'
s = s.replace(old, "if ((fiber.flags & PERFORMED_WORK) !== 0) worked.push(name);", 1)
open(p, 'w').write(s)
PY
run_sabotage "the independent recount loses its stale-flag filter" "$TMP/patches/8.py" \
  "node scripts/independent-check.mjs 2>&1 | tail -3" \
  "node scripts/independent-check.mjs"

echo
echo "$pass sabotage(s) caught, $fail not caught"
[ "$fail" = "0" ] || exit 1
