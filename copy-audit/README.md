# Copy audit

- `changes.md`: every changed string (before → after, reason), totals, and what was kept on purpose.
- `inventory.csv`: all user-visible strings before the pass, from source (`tools/copy-inventory.py`) and as rendered in 27 states (`e2e/copy-check.mjs`).
- `screenshots/before`, `screenshots/after`: the same 14 states at 1440×900 and 390×844.

Rule check: `node e2e/copy-check.mjs URL OUTDIR` (also the first suite in `scripts/e2e-all.sh`). Fails on a button, link, disclosure or command label over three words, a control ending in `?`/`!`, or a heading that ends in `?`/`!`/`.` or matches a slogan pattern. The allowlist for generated names is at the top of the script.
