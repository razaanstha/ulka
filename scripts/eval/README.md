# Browser runtime evaluations

Run `python3 scripts/eval/check_environment.py` from the repository root. Requires Bun and Chrome; `BROWSER_BINARY` can select another Chromium executable.

The checks launch an isolated temporary browser profile and exercise Ulka's production observer, freshness validator, and executor on synthetic pages. Five task families cover duplicate-label controls, field entry, native selects, checkboxes, and delayed editors. Known wrong actions and false completion claims must not pass the page-state checks.

These are runtime evaluations using scripted actions, not end-to-end model-driven success measurements. They make no model requests and do not train or deploy models. Broader model-driven benchmarks, latency distributions, and live-site compatibility remain separate work.

The JSON-lines environment only accepts generated task families/seeds and observed actions; it cannot open caller-supplied URLs or execute caller-supplied code.

For a repeatable multi-seed run:

```sh
python3 scripts/eval/check_environment.py --seeds 0 1 2 3 17
```

This runs 25 positive scenarios plus wrong-target and false-completion checks for each seed. The JSON report includes per-scenario action duration and nearest-rank p50/p95. Durations include execution and observation settling, exclude browser startup/reset, and contain no model latency. The delayed-editor scenario has two actions; compare like scenarios before interpreting aggregate percentiles. Seed variation changes labels, duplicate-button ordering, and editor delays; it does not provide broad website coverage.

Before claiming general-purpose reliability, also verify model-driven tasks, Stop during planning and execution, stale controls, multi-tab navigation, and live-site outcomes through the installed extension. Record failures and elapsed time, including unsuccessful runs. Passing these scripted scenarios alone is insufficient.

The environment uses production runner wait budgets: 3 seconds after actions, 10 seconds for explicit WAIT. The initial 1.5-second harness budget failed delayed-editor seed 3 (1.4-second render delay), returning the last observation before the editor mounted. The preserved `results/2026-09-19-short-wait.json` records that 24/25 baseline. This was a harness mismatch, not evidence of a production failure at its 3-second budget.
