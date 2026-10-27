#!/bin/sh
# Runs every browser regression against a served build: scripts/e2e-all.sh URL OUTDIR
# Private-model checks run only when SPLITTER_PRIVATE_MODEL points to a file.
url=${1:-http://127.0.0.1:8795/}; out=${2:-evidence/all}; mkdir -p "$out"
cd "$(dirname "$0")/.." || exit 1
fail=0
run() { name=$1; shift; start=$(date +%s)
  if timeout 1500 node "$@" >"$out/$name.log" 2>&1; then r=PASS; else r=FAIL; fail=1; fi
  echo "$r $name $(( $(date +%s) - start ))s"; }
for t in guided-flow merge-expert design-system design-r2 round2-editing round2-touch round3-context round3-depth ux-audit interactions expert-controls joints mobile-ui large-mesh; do
  run "$t" "e2e/$t.mjs" "$url" "$out/$t"
done
run smoke e2e/smoke.mjs "$url" bracket_320mm.stl prusa-mini "$out/smoke"
run support e2e/support.mjs "$url" web/samples/bowl_shell_300mm.stl "$out/support" prusa-mini
run wasm-plan e2e/wasm-plan.mjs "$url" web/samples/bracket_320mm.stl
if [ -n "$SPLITTER_PRIVATE_MODEL" ]; then
  start=$(date +%s)
  if timeout 1500 node e2e/round3-fit-file.mjs "$url" "$SPLITTER_PRIVATE_MODEL" "$out/private-fit" >"$out/private-fit.log" 2>&1; then r=PASS; else r=FAIL; fail=1; fi
  echo "$r round3-fit-file(private) $(( $(date +%s) - start ))s"
fi
exit $fail
