# General text-entry recovery

## Evidence and diagnosis

The user-supplied export at 07:52:57 UTC contains five runs. Four report done; the last Facebook run, `a86c763a-9b94-4d2e-b169-79d66937d1be`, stops after two blocked subgoals at 43.2 seconds. Three TYPE_TEXT executions target the same browser node (123), despite observation IDs changing from e14 to e17. The first changes observed state; the next two do not. A subsequent CLICK on that textbox also makes no change, and shared cycle detection stops the task. Field values, generated content, and the original request are redacted, so this export does not prove that the exact text was correct or identify why the provider chose another replacement.

Code inspection and failing regressions establish a general control-loop problem: a routine text-entry subgoal continues asking for actions after a settled write, allowing a repeated TYPE_TEXT choice to replace the same draft until cycle limits block it. Planner previews also discard form identity and recent typed content, and silently cut values to 300 characters. That leaves the planner without enough evidence to distinguish complete drafts, separate conversations, and missing text.

## Changes

- Routine TYPE_TEXT returns an unverified checkpoint after its settled observation. The planner inspects field values and suggestions before deciding a dependent commit or submission.
- Complete observed values that exactly match generated text are not replaced. Task mode excludes that same-state replacement locally and supplies feedback so a commit or DONE can win. Subgoal mode returns observed-value evidence without recording a fictitious execution or consuming action budget. Truncated values never qualify.
- Matching values do not consume shared execution-attempt limits. Later requested corrections remain possible.
- Planner previews preserve form context, multiline semantics, suggestion IDs, supported operations, and up to 2,000 characters of field value and recent typed content. Larger previews carry explicit truncation metadata. Oversized rows are skipped without hiding later smaller controls; existing byte and row budgets remain.
- Approval gates, freshness validation, shared action limits, cycle protection, and final outcome verification remain active. Consequential subgoals still require their completion check.

## Validation and limits

Regressions reproduce a stubborn TYPE_TEXT planner reaching blocked before the fix, then handing off after exactly one write afterward. Further checks cover matching-text commit recovery, repeated no-op handoffs without poisoning shared budgets, later corrections, incomplete value previews, and preservation of draft/form evidence in planner results.

`bun run check` passed: typecheck, build, 362 tests, zero failures, 1,822 assertions. The final preview regression also passed after adding an oversized selected-link case. `git diff --check` passed.

The isolated real-Chrome smoke uses actual accessibility observation, freshness checks, and CDP execution to enter a long contenteditable draft once, then recognize the matching draft without another execution. No provider requests or real messages are sent.

These checks validate the runtime failure mode and browser integration. They do not establish universal agent-task success, live Facebook compatibility, provider planning quality, or measured cost savings. The redacted real-world task has not been replayed against a live provider after this change. Reload the rebuilt extension before acceptance testing.
