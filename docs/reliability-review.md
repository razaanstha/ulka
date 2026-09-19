# Browser reliability review

## Verified causes and changes

- Observation could settle on an intermediate loading message before an editor appeared. Settling now checks visible busy/progress indicators and loading text, and accounts for observation time in its wait budget. Loading hints are conservative; final outcome verification remains necessary.
- A 250-row observation cap could hide reachable controls. Reachable controls are retained; offscreen context has an explicit omission count. Very dense pages may still create large model inputs.
- Structured generation could remain pending when a transport ignored cancellation. The caller now races cancellation and rejects late output.
- Classic conversation planning and page answers did not receive Stop signals. Cancellation now reaches those calls and checks before navigation and runner startup. This is covered by focused tests; installed-extension behavior still needs live verification.
- The evaluation harness used shorter settling budgets than production. A 1.4-second editor delay failed under its 1.5-second budget. The harness now matches production's 3-second action wait and 10-second explicit WAIT. Original failed evidence is preserved.

## Evaluation boundaries

`bun run check` passed with 252 tests after the runtime changes. These tests include mocked model transports and deterministic browser behavior; they do not establish model-driven task success on real websites.

`python3 scripts/eval/check_environment.py --seeds 0 1 2 3 17` exercises five synthetic task families, varying labels, duplicate-button ordering, and editor delays. The oracle uses known correct actions. It also checks wrong-target actions, false completion, and terminal-episode handling. Latency excludes model inference and browser startup. Reports are under `scripts/eval/results/`.

Live CUA testing is blocked: both state access and reset returned `Transport closed`. Extension reload and execution of the latest build through the installed UI have not been verified. A prior flight task displayed a very large token total, but no comparable baseline or complete timing trace was captured; this does not establish which stage was responsible.

## Next required evidence

1. Reconnect CUA, reload the built extension, and refresh the local fixture page.
2. Run the same form-editing task repeatedly through Ulka with its configured model. Verify actual field values and final page state, including unsuccessful runs.
3. Test Stop during planning, execution, and verification; confirm no later navigation or actions occur.
4. Capture per-stage model calls, token counts, and latency before changing prompt/context size or removing verification calls.
5. Extend model-driven cases to stale controls, searchable comboboxes, multi-tab work, and representative live sites. Keep held-out tasks so tuning does not merely fit fixtures.

## Remaining limitations

An in-flight page scan may exceed its settling budget. Main model-driven paths do not yet share a hard elapsed-time deadline. Readiness heuristics cannot prove completion. General-purpose browsing reliability and speed improvements require the live measurements above; passing scripted fixtures alone is insufficient.

## Live CUA retry

After reconnecting, CUA successfully opened the local fixture and reloaded Ulka; the Extensions page displayed `Reloaded`. A fresh task requested Name = `Ulka QA`, Country = `Sweden`, notifications unchecked, then Continue, without navigation. At approximately 22 seconds, CUA showed the correct Name and Country and an unchecked notification box. Ulka reported 29,129 tokens at that intermediate point. Continue and final completion were not yet verified.

A subsequent CUA read took about 50 seconds and returned a different foreground tab. Automatic approval review then rejected broader inspection of that unrelated signed-in page. Requested that the user foreground the local test tab. This run cannot supply a reliable total task latency or completion result until its final state is observed. The earlier transport-closed blocker recovered, but live validation remains incomplete.

### Live outcome observed on recheck

CUA recovered and directly showed Name `Ulka QA`, Country `Sweden`, notifications unchecked, and the page's `Continued` confirmation. All requested fixture mutations therefore occurred. The Ulka panel, however, showed `Thinking interrupted`, `Incomplete response. Completion not verified.`, and `Stopped. Work remains incomplete; review partial progress before continuing.` Reported usage was 88,531 tokens (84,697 input / 3,834 output), explicitly partial. The displayed reasoning mentioned a schema error and re-observation before another subgoal. This is evidence of successful page actions with an incomplete agent run, not a clean end-to-end pass. Exact schema failure and interruption source require diagnostics; UI reasoning alone does not establish their cause. Total latency remains unavailable because CUA access was interrupted.

### Text-generation change without a deadline

Removed the subsequently added 30-second text-generation deadline at the user's request. Stop cancellation remains independent of transport cooperation. The original latest user message now reaches the writer in both classic and FX paths. Explicit `set/fill <unique field label> to/with <literal>` assignments can return the original value without generation or content-review calls. The fixture's `set Name to Ulka QA` is covered by a zero-call regression test. Ambiguous, conditional, duplicate-label, date, password and multiline cases retain the existing path. Freshness, approvals and final verification remain in the runner.

Build, typecheck and 258 tests passed. Live reload was deferred because the installed extension was running a separate user flight task. No live speedup is claimed for this build yet; generated/composed content still uses independent review.

### Combined Jev decision request

Operation selection and every operation with multiple compatible targets now share one evaluation request. A sole target remains deterministic. Only the selected operation's compatible target can become executable; existing probability checks, exhausted-target filtering, cancellation, and one malformed-output retry remain. Usage is recorded once as `jev_decision`.

Offline regression evidence: the multi-target case drops from two evaluator invocations to one. Mixed CLICK/TYPE_TEXT choices, native SELECT option identity, invalid selected targets, and cancellation are covered. Typecheck, build, and 264 tests pass. This is a request-count improvement, not a measured browser speedup. Speculative heads add output and can increase provider work; live latency and accuracy must be measured before claiming parity with jev-ultrafast.

Live measurement remains unavailable after CUA ended the prior session on a prohibited browser URL. No attempt was made to bypass that restriction. The installed extension's latest build/reload is unconfirmed. Follow-up profiling must compare identical public tasks across repeated runs, including text generation, observation, provider calls, and final verification. Text-model switching and observation-loop changes remain unimplemented pending that evidence.

### Text and observation performance implementation

Supersedes the implementation-pending note above. Field generation and independent content review now use `inception/mercury-2.5` through Gateway with `reasoning: none`; planning and completion verification keep their existing model. Provider availability and structured-output support were checked against https://vercel.com/ai-gateway/models/mercury-2.5. No production latency/quality claim follows from catalog availability. Usage pricing now attributes those stages to the text model.

Accessibility observations capture a DOM baseline before execution. Settling polls DOM against that baseline, then refreshes accessibility once before returning a decision snapshot. Changed-state polls run at 50 ms; unchanged-state polls back off to 250 ms. Existing overall wait budgets and loading guards remain. The mocked immediate-change regression waits 150 ms instead of the former 750 ms, excluding browser work. Delayed loading at 1.4 seconds remains covered, and Stop skips the final refresh. Full accessibility preparation occurs twice in the covered observe/action/settle cycle instead of on every settling sample. Baseline collection adds one DOM read per full accessibility observation; unusual AX-only changes can require the full wait budget before refresh.

Jev instructions are shared once in request state rather than duplicated into every speculative head. Only matching operation targets can execute. No verification or content review was removed to obtain these savings.

`bun run check`: typecheck, build, 268 tests pass. `git diff --check`: clean. Paid alternating text-model benchmark is implemented at `scripts/eval/benchmark-text.ts`; its missing-key path exits clearly. It could not run here because `AI_GATEWAY_API_KEY` is absent from the shell. No stored browser credentials were accessed. CUA live validation and installed extension reload remain unverified. Full performance parity is therefore not established.

### Structured-output failures from supplied 07:21 diagnostics

The supplied export confirms a live Mercury/combined-Jev run. Four Mercury generation calls failed with `AI_NoObjectGeneratedError` in 490–1020 ms each. Older verification failures included a 299263 ms call ending in type/Zod validation failure. The export omits rejected field/type details, so it cannot establish the exact malformed output or prove a provider-schema root cause.

The shared structured transport now explicitly includes the same JSON Schema in system instructions, in addition to provider response-format metadata. Strict SDK validation is retained; no malformed output is coerced, partially executed, or treated as success. Verifier requests now disable reasoning; final verification remains independent. Safe error diagnostics report known field types and whitelisted issue paths/codes, never output values, arbitrary field names or validation messages. Text-generation failures retain provider usage when available.

Regression checks cover the outgoing Gateway request contract, rejection of invalid output, privacy of diagnostic shapes, cancellation, and verifier reasoning configuration. `bun run check`: typecheck/build and 270 tests pass. Live provider compatibility and the failed task's recovery still require a fresh run. These tests establish the transport contract, not that the observed provider failure has been reproduced or eliminated.

### Follow-up audit: request duplication and failure recovery

Found and fixed additional overhead introduced/exposed by the faster path:

- Speculative Jev heads repeated complete widget rows already present in shared state. Heads now keep compatible compact descriptors and explicitly refer to shared widget state. A 40-control, five-operation regression retains every control and relationship with more than 40% fewer serialized request characters than the duplicated representation. This is synthetic payload size, not measured token count or live latency.
- Exhausted malformed field generation was misclassified as a wrong field. FX consequently retried the browser subgoal, reproducing the same provider failure. It now returns `text_generation_unavailable`; FX stops recovery of that failed path. Semantic wrong-field rejections remain separate. Regression reproduces two failed generation attempts, zero writes, and no second FX subgoal.
- The diagnostic connection button previously checked only DeepSeek and a trivial object schema. It now also checks actual Mercury field/date/review schemas and the actual verifier schema. Synthetic expected values are checked, so a valid schema containing the wrong field value fails. All seven checks remain browser-free. Existing diagnostic deadlines are unchanged; no task-generation timeout was added.

`bun run check`: typecheck, build, and 274 tests pass. `git diff --check`: clean. Added a metrics-only export analyzer and processed the user-supplied trace into `scripts/eval/results/2026-09-19-supplied-diagnostics-summary.json`. It labels incomplete log envelopes and overlapping timing categories explicitly; page content is omitted.

Remaining release gate: reload the built extension, run Help & diagnostics → Test model, then repeat the same public browsing tasks under matched timing boundaries. Shell provider credentials remain unavailable and CUA's previous URL restriction prevents live validation here. Equal speed and accuracy to jev-ultrafast remain unproven. Offline tests cannot substitute for provider compatibility or end-to-end completion evidence.

### Selective verification policy

FX calls the runner with explicit `completionMode: 'subgoal'`; Classic/default runner calls remain in task mode. A routine subgoal's DONE decision now yields `checkpoint` with an explicit unverified reason, not completed-task status. The host still returns a fresh observation, and FX instructions require inspecting it before dependent actions. Task-level outcome verification remains mandatory after actions. Failed final verification still drives bounded recovery or a blocked result.

Executed actions classified `confirm` retain subgoal verification as well as their existing approval gate. No target freshness, occlusion, operation compatibility, schema/date validity or action-approval checks were removed. A checkpoint resets the consecutive blocked-subgoal counter only when its returned action history records observed page change.

Exact whole-message quoted searches, such as `Search for "James Webb Space Telescope"`, now supply literal content directly only to a unique observed searchbox/native search input. Ambiguous controls, other target fields, instructions with site/workflow qualifiers, and composed content retain the existing generation/review path. No model-derived goal or page text supplies the literal.

Regression evidence: routine runner checkpoint invokes zero subgoal verifiers; two FX checkpoint results still invoke one final verifier; false final verification cannot become success; consequential actions retain approval and subgoal verification; exact quoted search uses zero text calls. Typecheck, build and 280 tests pass. Live latency and matched external benchmark accuracy remain unverified.

### Task-scoped attachment reuse and fewer planner handoffs

FX previously created and detached an AttachedBrowser for each observation, page read, WebMCP call, browser subgoal and final check. Those paths now use one TaskBrowserSession, lazily attached and released in task cleanup. It switches targets explicitly, releases before native close/internal navigation, and rejects access after cancellation or closure. It reuses the attachment and observer instance, never a previous page observation. Classic tasks keep their existing lifecycle.

The eight-action/16-model-step FX subgoal limits are replaced with a task-shared allowance of 30 executor attempts and 60 runner model steps. Stale executor attempts count because focus may already have changed. Model steps include decision, generation and subgoal verification calls, not each provider request within their bounded retries. FX planning, native tools and final verification retain their separate existing limits. Exhaustion is explicit and stops FX immediately, preventing recovery from resetting the allowance. DONE can still be considered at the exact action allowance. Existing cycle/no-progress checks remain active and may stop a sequence earlier.

Regression evidence: five serial session acquisitions perform one attach and one cleanup detach; switching and native-close release ordering pass; cancellation during attach still cleans up. A twelve-action subgoal completes as an unverified checkpoint without a planner handoff. Action and model-step exhaustion persist across subgoals, and FX does not retry exhausted tasks. `bun run check`: typecheck, build and 289 tests pass. These are deterministic tests with mocked browser/model dependencies, not measured live speedups. No model timeout was added.

Live release gates remain open: installed extension reload, current Mercury schema checks, and matched repeated browsing tasks. CUA previously ended on a prohibited URL; no alternate browser automation was used. Shell provider credentials remain unavailable. Comparable speed and accuracy to jev-ultrafast are not established by these tests.

### 07:42 diagnostics: Gateway rejection misreported as idle

The supplied export identifies exporter build `181d54f8-5359-4f21-9513-6ecb65358cf8`, built at 07:41:29 UTC. Earlier buffered runs predate that build and cannot be assigned its features. The new 07:42 run receives HTTP 403 on its first model POST, ends with `stopReason: refused`, executes zero tools, and incorrectly reports `idle` after 1637 ms. No response body is present, so the exact access restriction is unknown. ZDR eligibility is a candidate, not a confirmed cause. Vercel documents per-request ZDR as available on Pro and Enterprise: https://vercel.com/changelog/zero-data-retention-no-prompt-training-on-ai-gateway. The account plan is not available in this export.

FX now treats unrecovered HTTP rejection or a refused turn as blocked before final verification, with Gateway access/ZDR guidance for HTTP 403. A later successful HTTP response clears a recovered transport error. Existing partial output remains visible. ZDR is not disabled or retried without the requested policy. This fixes status reporting, not the Gateway's access decision. Help & diagnostics → Test model uses synthetic content and can provide the rejection response needed to distinguish account permissions from model-route eligibility.

Earlier 07:25 and 07:31 runs contain four successful Mercury generation/review calls of 732–1159 ms, with no text failures in those runs. They do not establish broad reliability. The 07:25 run reports done after 99618 ms; its 80919 ms FX turn excludes the final 18378 ms check. Another run reports blocked after 110999 ms, with 108334 ms outside tools. Older browser failures include attempts to access a different extension's URL. Those are distinct from the newest HTTP 403.

The metrics analyzer now includes request-to-terminal time, HTTP failures, refusal/status conflicts and whether a run predates the exporter build. Sanitized results are saved in `scripts/eval/results/2026-09-19-0742-diagnostics-summary.json`. Regression reproduces the original idle/refusal bug before the fix, covers rejection after partial browser work, and checks successful transport recovery. Typecheck, build and 296 tests pass. Live Gateway access remains unresolved.

### Live real-world test confirms ZDR plan incompatibility

Through the installed extension in Helium, a natural Wikipedia research request for JWST's launch date, operator and source failed with HTTP 403 before navigation. The page stayed on Main Page. The updated diagnostic UI then exposed the synthetic rejection body: "Zero Data Retention (ZDR) is only available for Pro and Enterprise plans. Current plan: hobby." All seven inference checks failed. This confirms the access cause previously left uncertain: mandatory ZDR is incompatible with the current account plan.

The diagnostic display and blocked-task reporting are live-verified. Successful real browsing, task latency improvements and jev-ultrafast parity remain unverified. ZDR has not been silently disabled; further real-world execution needs the user's privacy/plan choice. Details and pending natural-language acceptance cases are in `docs/live-use-case-checks.md`.

### User-authorized ZDR disablement

The user explicitly requested "disable zdr" after the live Gateway response confirmed the Hobby plan restriction. The shared policy now sends `gateway.zeroDataRetention: false` for every inference path, including FX's fetch hook, Jev retries, structured generation/review/verification and diagnostics. Other provider options, credentials and cancellation signals are preserved. The helper is renamed `withGatewayPolicy` to avoid implying that ZDR remains enabled; README reflects the actual request policy.

Updated wire-contract tests first reproduced six failures against the previous enabled policy. After the change, typecheck, build and all 298 tests passed. Build `9f0fc31d-8c94-459d-90da-6956a38a775b` was produced at 08:02:45 UTC, and Reload was invoked for the installed Ulka extension through CUA. A fresh natural Wikipedia research request was then submitted for live verification.

Live retry succeeded: Ulka searched for JWST, opened its article and correctly answered with a source. A conversational Hubble comparison also succeeded, including opening a second article and returning to the first. Independent CUA page inspection confirmed requested facts. Terminal results were observed within 66 and 70 seconds respectively, not precise latency measurements. The previous global 403 blocker is resolved for these runs. Planner indecision and oversized observation results remain performance findings; general reliability and jev-ultrafast parity are still unproven.

### Live evidence drives field-model and planner-input changes

The next live diagnostic run exposed an unrelated Mercury refusal for the synthetic name `Ulka QA`, while the previously failing date check passed. Bounded mismatch values now distinguish incorrect values from schema/transport failures without logging real page output. Field generation/review now uses the existing DeepSeek route with reasoning disabled. This is a targeted mitigation, not proof of broad date reliability or faster generation.

FX previously received full control tables despite only choosing high-level subgoals. Its model-facing result now contains a size-bounded control preview with explicit omission notices and priority for focused, selected and editable controls. Jev and final verification retain the full evidence. A reproduced 4.9 MB Unicode control result becomes a preview under 16 KB without losing any of the 2,001 controls from final verification. Diagnostics record planner-result bytes alongside original characters. Other potentially large tool payloads are not covered by this control-table bound.

Typecheck, build and 299 tests pass. The paid synthetic benchmark now explicitly compares the previous Mercury route against the current field route, both with reasoning disabled, and groups results by arm rather than model name. No stored browser credential was retrieved to run it. Reload was invoked, but CUA's stale Extensions menu prevents post-change live validation. Full acceptance evidence and remaining live checks are recorded in `docs/live-use-case-checks.md`. No task/model timeout was added; final verification remains active.

CUA subsequently recovered. Two seven-check diagnostic runs passed (14/14 HTTP 200), and natural JWST research plus a Cassini comparison both completed with independently checked source facts. The second task navigated to a new article and visibly completed final verification. Completion was observed within 33.3 and 61.8 seconds, including CUA overhead; the first reused an open article. These runs confirm functional completion, not a matched speedup or universal fix for verification latency. Exact installed build identity was not freshly exported. See the acceptance log for prompts, usage, timing limits and pending date/travel testing.

### Real flight search exposes verification scope expansion

A natural Google Flights search for Stockholm–Venice, Oct 3–9, one adult/economy passed with independently checked filters and two displayed round-trip prices. Completion was observed within 110.4 seconds. A follow-up changing only return date to Oct 10 correctly updated the page and prices, but final verification triggered recovery. Visible planner feedback cited both loading uncertainty and missing return-leg dates. The subsequent planner acknowledged that the result list explicitly showed round-trip totals, then nevertheless expanded flight details repeatedly to find full return itineraries that the user had not requested. The operator stopped that run at 141.3 seconds; it remains a failed end-to-end test despite the correct page change.

The verifier now explicitly respects the latest correction, accepts committed search filters plus matching settled result facts for search requests, and does not require full itinerary/checkout details unless requested. Loading and date-selection checks remain. This is a prompt-level mitigation for the observed scope expansion; local tests verify the request contract, not model compliance. A numeric-only performance view exposes retained stage timings and evidence sizes in Help & diagnostics to distinguish planner, browser and verifier costs. It warns that timings overlap and incomplete buffers cannot yield a complete task duration.

All 301 tests, typecheck/build and diff whitespace checks pass. Build `9a4db43a-1b2f-4a5b-98d2-25756b88ab96` was built and reload invoked through CUA. After reload, CUA again returned only a stale Extensions menu with no screenshot; reacquiring the app, reset, Cancel/Escape and native menu-focus recovery did not restore access. Post-fix real-task speed and recovery counts remain unmeasured. No alternate browser driver was used.

### Reconfirmation with measured stage timings

A subsequent live return-date change failed after **167.429 seconds**, exhausting the action budget before final verification. The date picker changed the departure unexpectedly; recovery repeated calendar edits and reopened the picker after restoring the intended pair. In-app diagnostics measured **92.606 seconds inside tools** and **74.790 seconds outside tools**, with **32 Jev decisions totaling 33.197 seconds** (median 0.841 seconds, included in tool time). The planner produced 21,949 reasoning characters. This corrects any interpretation that final verification is the only performance bottleneck: this failure did not run final verification at all.

The cost-row elapsed-time feature was verified live (`2m 48s · Partial`). Performance diagnostics now render each record separately so native accessibility does not truncate an entire JSON block. Typecheck/build, focused panel/performance tests and whitespace checks pass. Calendar interaction reliability and excessive recovery remain unresolved; no overall speed fix or verifier-scope live pass is claimed.

## Latest speed investigation (2026-09-19, 08:51 UTC)

Additional fixes implemented: editable-date preference with JSON-safe widget hints; lossless repeated-row compression for verification evidence; approval requests wait for an explicit choice instead of expiring after 30 seconds; FX planner sends Gateway `reasoning: 'none'`. The planner setting addresses an observed repeated-reasoning loop on an already-correct flight search, stopped after 1m 59s. Full validation passes (304 tests, typecheck, build). Live validation of the latest planner build remains blocked by stale CUA window state after reload. Exact runs, failed intermediate regression, evidence sizes and pending checks are recorded in `live-use-case-checks.md`. These changes are not evidence of jev-ultrafast parity or a measured final-verifier speedup.

## Follow-up live findings and fixes (09:23 UTC)

Live traces showed six repeated waits and a later regression into repeated date-entry/Enter after a URL change. Browser subgoals now return unverified checkpoints on navigation; unchanged non-loading subgoal waits also return for planner inspection. Final verification still runs. Date reversal then passed in 47s; conversational reversal took 99s including transient-service recovery. A different two-article research task passed in 42s but unnecessarily repeated its answer because the final verifier lacked the proposed reply. Added that candidate reply to the existing verification request, with explicit evidence/authority separation and answer-only recovery guidance. Latest checks: 308 passing tests, typecheck/build, clean whitespace check. Latest answer-verification change still awaits live confirmation after CUA lost its window tree during reload. See `live-use-case-checks.md` for failures and measurement limits; do not present these individual successes as consistent performance.

## Latest live verification completed (09:29 UTC)

The previously pending answer-verification fix now passed live: fresh two-article Pioneer research completed in 28,985 ms with one successful final verification taking 5,679 ms, no recovery, zero planner reasoning. Conversational UTC-date comparison completed in 7,602 ms and correctly returned 399 days, independently calculated. Requested source facts were checked through CUA. Copied logs UI succeeded; exact timings were read from the built-in performance view because CUA paste was unreliable. These validate the latest flow and conversational continuity, while earlier 99-second service-error recovery remains evidence that latency is not consistently low. No blanket "fully fixed" or upstream-parity claim is justified.
