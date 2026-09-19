# Live Ulka acceptance checks

Run these through the installed extension after reload, in separate test tabs/chats. The operator does not perform the requested page actions. Record actual final page state, elapsed task time, model usage, text-generation/review diagnostics, and failures. Never label a task successful from Ulka's reply alone.

| Case | Prompt | Observable pass condition |
| --- | --- | --- |
| Public search and reading | On English Wikipedia, search for the James Webb Space Telescope and tell me its launch date. Stay on Wikipedia. | Correct article open; date agrees with visible article; no unsupported completion claim. |
| Flight search with exact dates | On Google Flights, find round-trip flights from Stockholm to Venice, departing October 3, 2026 and returning October 9, 2026, one adult, economy. Report the dates and a visible fare. Do not book. | Both cities and both dates committed in results; fare visible; no checkout action. |
| Change one field while preserving others | Change only the return date to October 10, 2026. Keep departure October 3, route, passenger count and cabin unchanged. Do not book. | Results show October 3–10 with all other constraints retained. |
| Exact search-field entry | On a public search form with a unique visible Search field: Set Search to "James Webb Space Telescope", then submit the search and report the first relevant result. | Literal remains exact; diagnostic text_literal event; no text generation/review calls for this entry; expected results visible. |

The last case applies only where the selected field's observed label is actually Search. The optimization intentionally falls back for other labels or ambiguity; do not alter page labels to manufacture a pass. Native date fields and generated prose still use the existing model path. Compare those cases separately from exact-literal entry.

Earlier attempt: blocked before task submission by CUA returning Helium's Extensions menu across navigation. Two installed app paths share Helium's bundle ID; selecting the mounted copy timed out. Later CUA sessions recovered; see the dated results below. No real-use-case pass claimed yet.

## Wikipedia installed-version run

Submitted through Ulka via CUA: "On this Wikipedia page, search for James Webb Space Telescope using the site search, open its article, and tell me its launch date based on the article. Stay on Wikipedia."

Result: failed, observed terminal at approximately 67 seconds after submission (UI showed 55 seconds). Page stayed on Wikipedia Main Page. Ulka reported two blocked subgoals and scrolling with no new readable content, with 81,328 reported tokens (79,881 input / 1,447 output), marked partial. Developer trace confirmed a SCROLL_UP decision and an observation with 247 elements from 251 candidates, accessibility source, zero unmapped nodes, four CSS-hidden controls. Exact cause of selecting scroll over search is not established by these facts.

Exported sanitized diagnostics through the UI as `ulka-logs-2026-09-19T06-58-11-282Z.json`. macOS denied reading that file in Downloads even with an escalated read. Copy logs reported Clipboard unavailable. Installed build identity/reload remains unconfirmed, so this is not a verified regression result for the latest source changes.

A second independent task was submitted with explicit Search Wikipedia field assignment and a no-scroll constraint. Outcome pending.

## Matched performance acceptance for the current build

Do not run an alternative browser driver to bypass the current CUA restriction. Resume these checks only through an allowed, user-authorized browser surface. Reload the built extension and record its build ID; run Help & diagnostics → Test model first. A failed field/date/review schema check blocks a claim that the generation failure is fixed.

Run five paired repetitions per task on a baseline build and this build, alternating order. Use identical prompts, initial page state, credentials/model route, viewport and network conditions. Report cold setup separately. Primary task time starts at submission and ends at a verified outcome or explicit failure; preserve failures and interruptions. Also report action-loop time separately if comparing an upstream benchmark that excludes setup, initial navigation or independent verification. Never compare those different timing boundaries as equal.

Keep the public search, date search and preservation cases above. Add a synthetic public fixture with at least twelve meaningful actions so the old eight-action handoff boundary is exercised, plus a two-tab read-and-return task to check attachment switching. Count planner tool calls, Jev calls, generation/review calls, verifier calls and browser attach/detach operations. Check page outcomes independently of the final reply. Report completion rate alongside p50/p95, model usage and malformed-response count; five pairs are a smoke sample, not general reliability evidence.

Expected structural results: one attach/detach pair for a single-tab task without explicit releases; no artificial handoff after action eight; shared budget exhaustion cannot restart via another subgoal; exact literal entry uses zero generation calls; routine subgoals remain unverified until the final task check. No absolute latency or external parity result has been measured for this build.

## 2026-09-19 live CUA test: Gateway access failure

CUA successfully selected `/Applications/Helium.app`, reloaded Ulka, opened a new controlled tab at `http://127.0.0.1:8765/`, and opened the installed extension panel. No prohibited site or alternative browser driver was used. The local artifact before reload was build `c38f6935-dae3-4726-acf1-b98db73284b1` (07:44:18 UTC); a fresh exported installed-build identifier was not available.

Two live checks were completed:

1. Help & diagnostics → Test model: all seven checks visibly returned HTTP 403, including FX-style headers, SDK plain/schema, verifier, Mercury generation/date/review. This is a live provider-access failure, not a mocked result.
2. Submitted to Ulka: "On this page, set Name to Ulka E2E, select Country Sweden, leave Enable notifications unchecked, then click Continue. Stay on this page." Ulka visibly ended with "Incomplete response. Completion not verified." and "Gateway rejected the model request (HTTP 403)." Independent page inspection showed Name blank, Country Nepal, notifications unchecked and no Continued confirmation. The form task failed; the requested mutations were not made. Correct failure reporting passed. No successful browsing benchmark follows from this run.

CUA returned unchanged/stale accessibility state during polling; toggling Settings exposed the terminal result. Therefore exact completion latency cannot be assigned from CUA polling times. Screenshot capture failed with ScreenCaptureKit error -3811. Copy logs visibly reported Clipboard unavailable.

The diagnostic panel now displays the first sanitized synthetic response/error directly, and its stale "Four small checks" label now says seven. Typecheck, build and 298 tests passed; local build `f2c1e001-164e-4fb5-8a43-42d22d062456` (07:51:01 UTC) was built and the extension Reload control invoked. After switching back to the fixture, CUA returned only the stale Extensions menu. Escape, its exposed Cancel action, reacquiring the app and one clean CUA reset did not recover the page tree. The updated response display and exact reason for HTTP 403 remain live-unverified. ZDR remains enabled; the account plan and route eligibility remain unknown.

## 2026-09-19 real-world task: Wikipedia research

The user clarified that acceptance means ordinary human requests on real websites, without supplying click-by-click instructions. CUA recovered and a new Wikipedia Main Page tab was opened with Ulka. Submitted exactly:

> Find when the James Webb Space Telescope launched and who operates it. Use Wikipedia and include a link to the article you checked.

Result: **failed before browsing**. Ulka displayed HTTP 403, "Incomplete response. Completion not verified.", and zero reported tokens. The page remained `en.wikipedia.org/wiki/Main_Page`; no answer or source article was produced. No latency claim is made because CUA accessibility updates were stale. A screenshot independently confirmed the failed reply and unchanged page.

The updated diagnostic UI was verified live: "Seven small checks" was visible and all seven checks failed with HTTP 403. Closing and reopening Settings refreshed stale accessibility output and exposed the first sanitized response:

> Zero Data Retention (ZDR) is only available for Pro and Enterprise plans. Current plan: hobby.

This confirms account-plan eligibility as the current blocker. The mandatory ZDR change prevents all tested inference paths from running on this account. No fallback removed ZDR. User choice is required between disabling the requirement for public-site tests and retaining it with an eligible plan. This supersedes the earlier unknown-cause and unverified-diagnostic-display notes above.

### Everyday acceptance cases after Gateway access is restored

These are pending, not successful results. Start from each site's public landing page, submit the natural prompt through Ulka, and let Ulka choose the interactions. Observe the final page and source evidence independently. Do not rescue a failed run by completing its page actions manually.

| Case | Natural prompt | Success evidence |
| --- | --- | --- |
| Research | Find when the James Webb Space Telescope launched and who operates it. Use Wikipedia and include a link to the article you checked. | Correct article and supported facts, usable citation. |
| Follow-up | Compare that with Hubble. Give me a short table with launch dates and operators, with sources. | Previous subject retained; both articles checked; supported comparison. |
| Travel search | Find round-trip flights from Stockholm to Venice, October 3–9, 2026, for one adult in economy. Show me two options with prices. Do not book. | Real results preserve route, both dates, cabin and passengers; visible prices and itinerary details. |
| Change of mind | Actually, return on October 10. Keep everything else the same. | Only return date changes; refreshed results, other constraints preserved. |
| Shopping comparison | Find two wireless headphones under 1,000 SEK on a Swedish retailer's site. Compare price, battery life and availability, with product links. Do not buy anything. | Two actual products meet budget; visible sources support claims; missing specifications acknowledged. |

Record task completion, unsupported claims, human interventions, retries, elapsed submission-to-terminal time, model calls and usage. Repeat successful cases with paraphrased prompts before making reliability claims. Unit tests and synthetic connection checks remain separate evidence.

## ZDR-disabled live retry

The user explicitly authorized disabling ZDR. Build `9f0fc31d-8c94-459d-90da-6956a38a775b` (08:02:45 UTC) sets `gateway.zeroDataRetention: false` across inference paths. Typecheck, build and 298 tests pass. The installed Ulka Reload control was invoked through CUA before the retry.

Repeated the exact natural Wikipedia research prompt in a fresh Ulka chat, starting on Main Page. **Task passed.** Ulka entered the search, navigated to `https://en.wikipedia.org/wiki/James_Webb_Space_Telescope`, and returned 25 December 2021 plus STScI for NASA in partnership with ESA and CSA, with a Wikipedia article link. Independent CUA inspection found the same launch date and operator in the article infobox and lead. No operator performed the page search or navigation for Ulka. Settings were toggled only to refresh stale CUA accessibility output.

Terminal success was observed within 66 seconds of submission, an observation upper bound rather than precise model/task latency. The panel reported 229,586 tokens (209,857 input / 19,729 output), estimated $0.0339. Reported usage includes multiple model paths and is not a billing audit. One successful task proves the 403 blocker is removed for this run, not general reliability or upstream performance parity. The planner's visible reasoning repeatedly reconsidered whether to navigate directly or use search; that is a remaining performance investigation target, not a measured attribution of total delay.

Then submitted in the same chat: "Compare that with Hubble. Give me a short table with launch dates and operators, with Wikipedia sources." **Follow-up passed.** Ulka opened Hubble's article in another tab, read its details, returned to JWST and produced a two-row comparison with both source links. Independent CUA inspection confirmed Hubble's infobox lists STScI and April 24, 1990, 12:33:51 UTC. The previous subject was preserved without restating JWST in the follow-up prompt. The final verification finished and Send/New chat became available. Terminal completion was observed within 70 seconds of follow-up submission; the earlier 54-second observation still showed verifying. This interval includes CUA overhead and does not identify exact verification latency. Follow-up reported 89,249 tokens (87,213 input / 2,036 output), estimated $0.0286.

Remaining live findings: multiple observation/navigation outputs were reported as too large, followed by recovery via tab listing and targeted page reads. The agent recovered, but this adds work. Both runs demonstrate successful research and conversational continuity, not broad browsing reliability. Travel/shopping cases and paired latency comparisons remain pending.

After both tasks, the seven live connection checks all returned HTTP 200. Six passed; `sdk_text_date` failed with "Synthetic contract values did not match". This is a separate date-output failure, not the former Gateway access rejection. A focused regression using reordered date keys passed, ruling out property insertion order as that test's failure cause. The exact live mismatched date value was not exposed; date-generation reliability remains unresolved. No blanket seven-check pass is claimed.

## Follow-up investigation: intermittent field refusal and oversized planner output

Added bounded expected/received values to synthetic diagnostic mismatches, preserving existing sanitization. This display was verified through the installed extension. A fresh seven-check run returned HTTP 200 throughout: the date check passed, but the name check failed with `suitable: false` and text `I am Mercury. I cannot bypass safety guidelines.` The expected value was the harmless synthetic name `Ulka QA`. This demonstrates an intermittent unrelated refusal; it does not identify the exact earlier date mismatch.

Changed field generation and review from Mercury to the existing `deepseek/deepseek-v4.1-flash` Gateway route with reasoning disabled. FX now receives a bounded preview of page controls, prioritizing focused/selected/input controls and explicitly marking omissions. Jev execution and final verification retain the complete host evidence. A regression reproduces a 4,925,175-byte result and verifies a planner preview below 16,000 UTF-8 bytes while all 2,001 controls remain available to the verifier. This limits the control-table contribution, not every possible tool result.

Typecheck, build and 299 tests passed. Build `72e19bd2-f45b-440a-abef-a03da4ef95e8` (08:11:52 UTC) was produced and Reload was invoked through CUA. Installed build identity and post-change live behavior remain unverified: CUA again returned only a stale Extensions menu. Escape, exposed Cancel, visible menu selection, keyboard navigation, reacquiring the app and a CUA reset did not restore a usable page tree; screenshots were unavailable. The user requested another self-check, which encountered the same state. No alternate browser driver was used. The two earlier Wikipedia passes must not be attributed to these new changes.

Next live checks: confirm installed build, repeat all seven diagnostics, then repeat the natural Wikipedia research and conversational follow-up before travel/date cases. Compare completion rate, oversized-result recoveries, model usage and task time. No current speedup or jev-ultrafast parity claim is supported yet.

## Subsequent CUA confirmation run

CUA recovered. On the controlled Wikipedia tab, all seven live model checks passed with HTTP 200, including field generation, native date output, review and verifier contracts. The local build artifact remains `72e19bd2-f45b-440a-abef-a03da4ef95e8`; a new installed-build export was not captured, so exact runtime identity is not independently established by this check.

Submitted the same natural JWST research prompt through Ulka. The agent reused an already open JWST article, read its facts and returned the correct launch date/operator with a source link. Independent article inspection confirmed the infobox and lead. Terminal completion was observed within 33.3 seconds; reported usage was 63,794 tokens (62,794 input / 1,000 output), estimated $0.0200. This is an observation upper bound including CUA overhead. Reusing the existing article makes it unsuitable for a matched speed comparison with the earlier search/navigation run.

Submitted a conversational follow-up: "Compare that with the Cassini spacecraft. Give me a short table with launch dates and operators, with Wikipedia sources." Ulka opened the previously unopened Cassini–Huygens article and produced a comparison with both citations. Independent article inspection confirmed October 15, 1997 and the listed operators: Cassini NASA/JPL, Huygens ESA/ASI. The panel was visibly verifying at its displayed 34 seconds; a subsequent observation confirmed verification ended and Send/New chat were enabled within 61.8 seconds of submission. Reported usage was 80,666 tokens (78,870 input / 1,796 output), estimated $0.0258. No operator performed the requested article navigation. Exact verifier latency is unavailable from these observations; it cannot be computed from the two snapshots.

These two tasks passed and demonstrate conversational continuity plus terminal verification after navigation. They do not establish consistent speed, resolution of all verification delays, date-entry success on real websites, or upstream parity. No paired baseline or repeated latency distribution has been measured.

Repeated Test model after both tasks: all seven checks again passed with HTTP 200. Across these two diagnostic invocations, 14/14 checks passed. This small synthetic sample does not establish general field-generation reliability.

## Real travel tests: verification expands a completed date change

Started a fresh Ulka chat and submitted: "Find round-trip flights on Google Flights from Stockholm to Venice, October 3–9, 2026, for one adult in economy. Show me two options with prices. Do not book."

**Search passed.** Ulka navigated to Google Flights, committed Venice and both dates, and returned Norwegian nonstop at SEK 1,679 round trip and SWISS/ITA at SEK 2,368. Independent CUA inspection confirmed the route, round-trip mode, one passenger, economy, Oct 3/9 fields, and both result-row prices and outbound times. No booking was performed. Terminal completion was observed within 110.4 seconds, including CUA overhead and time between observations. Reported usage: 356,798 tokens (326,127 input / 30,671 output), estimated $0.0374.

Follow-up: "Actually, return on October 10. Keep the same departure date, route, one adult and economy. Show me two updated options with prices. Do not book."

**Page change succeeded; end-to-end run failed to finish before operator stop.** At the 47.1-second observation the page showed Oct 3/10, same route/passenger/class, and Norwegian SEK 1,365 / SWISS SEK 2,368 round-trip rows. The panel had already answered and was verifying. Verification then requested recovery. Visible planner text attributed this to loading uncertainty and missing verified return-leg dates. Waiting for settled results was legitimate; requiring complete return-leg details expanded the request beyond the displayed search options requested. The agent began repeated flight-detail clicks, despite recognizing that the results list reports outbound flights with round-trip totals. The operator stopped this redundant recovery after 141.3 seconds. Ulka correctly reported stopped/incomplete. Usage was 687,072 tokens (619,198 input / 67,874 output), estimated $0.0493, partial. This is not an end-to-end pass.

Targeted change: verifier instructions now respect latest user corrections and distinguish search/filter/result verification from full itinerary selection or booking. Committed dates, filters, settled results and requested facts remain required; loading uncertainty must not introduce additional tasks. Added a numeric-only Help & diagnostics performance view for recent retained runs, separating overlapping planner/tool/verification timings and evidence sizes. No timeout, action check or independent final verification was removed.

Build `9a4db43a-1b2f-4a5b-98d2-25756b88ab96` (08:26:30 UTC) passed focused tests/typecheck/build. Reload was invoked and visibly showed "Reloading…", but switching back to Flights again yielded a stale Extensions menu and no screenshot. Post-fix timing/behavior is not yet validated. Pending: open Ulka on Flights, inspect retained timing summary, repeat return-date change in both directions and independently verify preserved constraints and terminal completion.

## Reconfirmation: calendar recovery dominates, final verifier never reached

CUA recovered. Starting from the existing Oct 3–10 results, submitted in a fresh chat: "Change the return date to October 9, 2026. Keep departure October 3, Stockholm to Venice, one adult and economy. Show two updated options with prices. Do not book."

**Failed end to end.** The agent changed departure while editing the date range, repeatedly tried to repair it, then reopened the calendar after restoring Oct 3/9. The run ended automatically with "Task action budget exhausted. Review partial progress before continuing." It did not reach final verification or produce the requested updated result comparison. Final AX inspection showed Oct 3/9 in the open picker; this is not sufficient to claim completed search. Some CUA screenshots and AX snapshots disagreed during the run, so intermediate wall-clock observations are not used as precise timings.

The new cost-row duration was visibly verified: `Est. $0.0698 · 2m 48s · Partial`. Reported usage was 1,131,980 tokens (1,028,798 input / 103,182 output). After task termination, closing/reopening the panel loaded the readable per-row performance display without another extension reload. Retained in-app diagnostics for request start `2026-09-19T08:31:46.003Z` report a complete envelope:

- Request to blocked result: **167,429 ms**.
- FX turn: **167,396 ms**, including **92,606 ms tools** and **74,790 ms outside tools**.
- **32 Jev decisions**, totaling **33,197 ms**, median **841 ms**. This duration is included in tool time, not additional.
- Planner reasoning: **21,949 characters**.
- Completed browser subgoal timings: 53,320 ms, 14,680 ms and 10,413 ms. Tool total also includes other/error paths.
- No final verification stage occurred before action-budget exhaustion.

Thus the earlier redundant final-verification recovery is a real issue, but not the sole cause of slowness. This repeat demonstrates calendar-target/selection mistakes, too many browser actions, and prolonged planner recovery. It cannot validate the verification-scope mitigation because the final verifier was never reached. The compact planner previews in this run were approximately 6.4–7.8 KB. Exporter build was `0733378a-8e41-46db-9fb4-1c4e919930d6`; exporter identity alone does not identify earlier worker code.

## Date typing, verification payload, approval wait and planner reasoning

A diagnostic prompt explicitly asking to type into Return completed the Oct 3–10 search with the correct Norwegian SEK 1,365 / SWISS SEK 2,368 rows. Retained diagnostics (`2026-09-19T08:38:15.976Z`) report 128,476 ms total, six Jev decisions, FX 74,864 ms (47,930 tools / 26,934 outside tools), and final verification 53,573 ms. Final verification received 119,268 characters versus 270,497 raw characters. An operator approved the requested Return-field Enter; the total includes approval wait. This is a diagnostic success, not a matched autonomous speed benchmark.

Implemented a generic editable-date preference in Jev and the browsing skill, preserving calendar fallback and other endpoints. A new widget-state field initially contained explicit undefined values and failed live JSON validation before action; the regression now checks JSON compatibility and the serialization was corrected. A subsequent natural prompt produced TYPE_TEXT first and preserved departure, but the existing 30-second approval expiry denied Enter before CUA reached Allow. Removed default approval expiry; explicit denial, Stop, replacement, failed publication and explicitly requested deadlines remain fail-closed. No action approval policy was relaxed.

Verification encoding now reuses identical rows across slightly changed control tables, preserving every row, order, changed value and removal. References point only to full base tables. A reconstruction regression proves semantic equality across eight snapshots, including reordered and removed controls; encoded tables are below 35% of the previous full-table representation. Live verifier latency after this change remains unmeasured.

Reloaded build `220d3bd5-1830-46fa-9460-6c4826eac21c` successfully through a fresh Extensions tab. The next Oct 9 prompt encountered a search already committed to Oct 3–9, independently confirmed through fields, applied-search tracking text and matching results. Therefore this run cannot test a new date change. The planner repeatedly reconsidered the same stale Oct 10 accessibility announcement and cheapest-tab versus result-row price distinction. It did not finish before operator stop; the UI reported 1m 59s and partial usage. This exposes a separate planner reasoning loop, not final-verifier latency.

The FX Gateway adapter now explicitly sends `reasoning: 'none'`, matching the reasoning setting already used by field generation and verification. Added failing wire-contract assertions before the change, then passed all checks: 304 tests, 1,593 assertions, TypeScript and build. No task timeout was introduced. Build `146127d1-df9d-4253-b000-e8199a0778bd` at 08:51:34 UTC contains this change.

Reload of that latest build was invoked, but CUA then returned only the stale Extensions sidebar menu, including after reconnect/reset, switching to the controlled Flights tab and opening a new blank window. Coordinate capture reported `noWindowsAvailable`. Latest runtime identity and post-change live completion are **not confirmed**. Do not claim a measured speedup or general performance parity. Pending: repeat the already-correct Oct 9 read/comparison, then natural return-date changes to Oct 10 and back, recording exact terminal timings and independent result checks.

## Live revalidation after explicit planner reasoning setting

On the existing You profile, reloaded the extension and opened a fresh controlled Google Flights Oct 3–9 search. Natural prompt requested return Oct 10 with the same route, departure, passenger/class and two prices, without booking.

**Completed:** request `2026-09-19T08:56:08.117Z`, 115,649 ms, 410,379 tokens, estimated $0.0584. Independent UI inspection confirmed Oct 3/10 and Norwegian SEK 1,365 / SWISS SEK 2,368. First final-verification attempt rejected an intermediate state; recovery reread settled results and passed. Planner reasoning characters were zero for both turns. First FX turn took 89,710 ms, including 76,793 tool time and 12,917 outside tools; recovery took 10,529 ms. Final checks took approximately 13,321 ms and 1,971 ms including host observation. Verifier inputs were 75,810 and 81,040 characters. These are individual live measurements, not a controlled causal benchmark against the earlier 53.6-second check.

Trace revealed five successful TYPE_TEXT executions on the same Return input after an initial stale trigger, with repeated unchanged writes, before a separate Done click. Six field-generation/review pairs ran; one generation took 28,494 ms. Added a narrowly scoped decision guard: immediately after a successful date write, if the full observed value equals the written text and an observed Apply/Done/Confirm button is available, exclude only that duplicate typing choice. Confirmation and other edits remain possible; editing returns after a confirmation attempt, changed/truncated value, or absent confirmation. Regression failed before fix, then all 305 tests/typecheck/build passed.

**Second natural reversal completed:** request `2026-09-19T09:01:59.048Z`, 100,850 ms, Oct 3/9 committed, 398,803 tokens, estimated $0.0295. One field-generation/review pair was reported (2,195 / 3,837 ms). Initial edit subgoal 12,241 ms; commit/wait subgoal 57,696 ms with seven decisions. FX 88,398 ms (70,249 tools / 18,149 outside tools), zero reasoning characters. Final verification passed on first attempt in 12,399 ms including host observation, input 50,240 versus raw 116,919 characters. Remaining long commit/wait behavior needs action-trace inspection; these two passes do not establish consistently fast operation.

User requested Copy logs instead of downloads. Live Copy logs returned Clipboard unavailable, so added a read-only selected-text fallback for Command+C/Ctrl+C without requesting clipboard permissions. Build/typecheck passed. Created a temporary local-only paste viewer at `/private/tmp/ulka-log-viewer.html` to inspect copied traces without reading browser storage or using alternate browser automation. After reloading the fallback, CUA again exposed only the stale Extensions menu; requested the user refocus the controlled viewer/panel. Latest clipboard fallback still needs live confirmation.

## Copied-log investigation and browser-subgoal boundaries

Copy logs succeeded through the Ulka UI. Pasted the sanitized JSON into the local-only viewer. The 100,850 ms date reversal contained six WAIT actions: four observations changed, then two unchanged waits consumed about 10.3 seconds each before the old wait checkpoint stopped the subgoal. Added an unverified short-wait checkpoint only for subgoals with explicit `busy: false`, no visible loading text, and unchanged state. Visible loading and standalone task waits keep their longer observation budget. Regression tests passed, but the next live repeat regressed and was stopped at the displayed 3m 03s: after committing Oct 10, Jev requested repeated Enter approvals and resumed field generation. This is not a successful speed fix; approval delays are included in that elapsed time.

Changed the interaction boundary: a browser subgoal returns an **unverified checkpoint** when its action changes URL. The planner must inspect the new document/search before further edits. Final task verification remains required; no navigation checkpoint claims goal completion. This addresses repeated edits after a committed search rather than merely shortening waits.

After this change:

- Natural Oct 10 → Oct 9 date change passed in the displayed **47s**, 121,510 tokens, estimated $0.0179. One ordinary date-field Enter approval was granted. UI confirmed Oct 3/9, Stockholm–Venice, round trip, one adult, economy, Norwegian SEK 1,679 and SWISS SEK 2,368. No repeated date-entry loop appeared.
- Conversational reversal to Oct 10 passed in **1m 39s**, 212,704 tokens, estimated $0.0342. It encountered a transient service error during the commit subgoal, recovered, requested date Enter approval, and returned the correct Oct 3/10 and SEK 1,365 / SEK 2,368 rows. This slower run is retained; consistent speed is not established. Exact provider error details remain pending copied-log inspection.
- Independent Wikipedia research comparing Voyager 1/2 launch dates and sites passed in **42s**, 103,962 tokens, estimated $0.0323. Returned September 5, 1977 / August 20, 1977, both Cape Canaveral LC-41, with both article links. However, an unnecessary verification recovery claimed the deliverable table was missing despite the first streamed answer containing it.

The research failure exposed missing final-verifier input: the existing final check received user messages and browser evidence but not the proposed answer. Now its input includes `proposedAnswer` as an explicitly untrusted candidate, checked against host evidence. Instructions distinguish answer delivery from page state and reject unsupported ranking claims (the flight answers had unnecessarily called displayed choices cheapest despite a lower Cheapest-tab price). Answer-only corrections are instructed to reuse evidence without repeating browser actions. This adds no model request. Contract regressions failed before the fix, then all **308 tests, 1,621 assertions, typecheck and build passed**.

Latest build `8a66b92f-40f9-49d3-9943-006db9c5b33b` (09:23:24 UTC) includes answer verification. Reload was invoked, but CUA again exposed only the stale Extensions menu on the Voyager 2 tab. Dock activation timed out. Requested a window/panel refocus for the final live repeat. The latest answer-verification fix is therefore unit/build validated, not yet live validated. Pending: repeat a two-article research task, confirm first-pass final verification, and inspect copied logs for the earlier service error. No general latency guarantee or jev-ultrafast parity is claimed.

## Latest verifier fix confirmed live (09:27–09:29 UTC)

CUA recovered without another user action request. Opened a controlled Voyager 2 page and used the installed latest build to ask: "Use Wikipedia to compare Pioneer 10 and Pioneer 11: launch date and launch site. Give a brief table with links to both articles."

**Passed, first verification attempt.** Retained diagnostics show request `2026-09-19T09:27:13.036Z`, complete envelope, status done, **28,985 ms** total. FX took 23,237 ms (5,239 tools / 17,998 outside tools), zero reasoning characters. Two article navigations and two read_page calls followed initial observation. Final verification took **5,679 ms**, satisfied true, input 74,355 versus 326,322 raw characters, five evidence items. No second planner turn or verification recovery occurred. Reported usage: 73,233 tokens, estimated $0.0230. Exporter build was `8a66b92f-40f9-49d3-9943-006db9c5b33b`; the complete current-run trace and observed first-pass behavior validate the changed flow, not older worker runs.

The answer provided both links and noted Pioneer 11's differing 36A body / 36B infobox launch-pad claims rather than silently hiding the conflict. Independent CUA article inspection confirmed Pioneer 11's LC-36B infobox and UTC launch date and Pioneer 10's March 3, 1972 / LC-36A. Pioneer 10's body gives 01:49:00 UTC while its infobox shows 01:49:04; the user requested date/site, and the answer's added seconds followed the body. This is a source-based retrieval pass, not independent resolution of Wikipedia inconsistencies.

Conversational follow-up: "Which one launched first, and how many days apart were their launches using the UTC dates? Answer in one sentence." **Passed requested calculation:** Pioneer 10 first, 399 calendar days apart. Independently calculated with Python date arithmetic. Diagnostics: request `2026-09-19T09:28:34.824Z`, complete envelope, status idle (read-only answer), **7,602 ms**, FX 7,543 ms, tools 152 ms, zero reasoning. Three read_page calls, no browser mutation or final browser-outcome check. Usage 17,517 tokens, estimated $0.0055. Output included extra progress narration despite the one-sentence request; factual/context continuity passed, concision is imperfect.

Copy logs was used and UI confirmed "Logs copied"; no new download was used. CUA paste into the temporary viewer remained unreliable, so exact stage timings above were read directly from Show performance. Earlier Voyager task remains the baseline example: 41,788 ms, first verification rejected, unnecessary answer rewrite, then pass. The new Pioneer task is similar but not identical; do not characterize the 42-to-29-second difference as a controlled universal speedup. Latest code checks remain 308 passing tests/typecheck/build. Provider latency and transient errors seen in prior flight runs remain unresolved variability; general speed/parity is not established.
