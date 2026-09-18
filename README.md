https://x.com/razaanstha/status/2100708222847853043

# Ulka

> **Experimental:** Ulka is an early preview. Expect bugs and incomplete tasks. Supervise browser actions and review results.

## Core stack

- **FX** orchestrates browser tasks and tool calls.
- **Jev** (`typesafe-ai/jev`) selects constrained browser actions from observed page elements.
- **Vercel AI Gateway** routes AI requests using the user's API key.
- **Ulka browser runtime** reads Chromium’s accessibility tree for roles, names, states, and UI hierarchy, validates targets, requests approvals, executes actions, and records evidence.

An experimental browser-agent extension. Runs locally in your browser, with model requests sent through Vercel AI Gateway. No application backend required.

fx plans browser subgoals, GLM handles language tasks, and Jev selects constrained actions from observed page elements. Ulka validates targets, executes browser actions, and checks outcomes. It can still make mistakes: supervise it, especially on signed-in sites.

## Setup

Requirements: [Bun](https://bun.sh) 1.4.2, a Chromium-based browser with side panels and the debugger API, and your own [Vercel AI Gateway](https://vercel.com/ai-gateway) key with access to the configured models. Development has been tested in Helium on macOS. Other browsers/platforms are not yet verified. Run the commands below from the repository root.

```sh
bun install --frozen-lockfile
bun run build
```

1. Open your browser's extensions page (`helium://extensions` or `chrome://extensions`).
2. Enable Developer mode, choose **Load unpacked**, and select `apps/extension/dist`.
3. Open Ulka's side panel, click **··· (Settings)**, paste your **Gateway API key**, and click **Save**. The status should say **Saved**.
4. Start with a low-risk task, such as opening Wikipedia and summarizing an article.

You can add or replace the key in Settings at any time. **No rebuild or extension reload is needed for key changes.** New requests use the saved key; stop an active task before replacing it. The key persists in this browser profile only. Each user supplies their own key, and no key belongs in source code, build files, or an `.env` file. **Saved** confirms local storage, not whether the key or model access is valid.

After rebuilding code, reload the extension **and refresh existing web pages** to update the injected progress controls. A separate test browser profile is recommended.

The default **fx + Jev** engine requires WebAssembly JSPI. If unsupported, select **Classic** in advanced settings. WASM is bundled at build time; it is not fetched as executable code at runtime.

### WebMCP (FX)

FX observations discover native WebMCP tools through `document.modelContext` (or the compatible `navigator.modelContext` alias). FX is instructed to prefer relevant website tools over equivalent UI actions; unsupported browsers and pages retain the existing Jev browser controls. No browser flags or permissions are changed automatically. Classic remains UI-only.

The initial integration supports tools registered in the task's main document, not iframe tools, remote MCP servers, page polyfills, or the older `modelContextTesting` API. Discovery runs in an isolated world and bounds metadata size. Each call requires approval with the website, tool name, and arguments, regardless of site-provided read-only hints. Handles are document-scoped, revalidated after approval, and consumed before invocation. Failed or interrupted executions stop the run rather than replaying potentially successful writes through another path. Successful calls still go through the final completion check. Tool metadata and output remain untrusted website content.

Rebuild and reload Ulka to enable this path. Native browser/site availability is feature-detected; integration tests use a mocked native API, not a live-site certification. API reference: [WebMCP draft](https://webmachinelearning.github.io/webmcp/).

## Background tasks

Choose **Settings → Tab behavior → Background** before starting a task. Start on the tab Ulka should use, then switch to another tab to keep browsing. Ulka keeps its task target, creates inactive tabs, and switches its own target without activating tabs. The setting applies to both engines and is fixed for each running task. Keep the side panel open for progress and approvals. Foreground remains the default.

Background mode uses the original task tab, not a duplicate. Some sites may pause work when hidden or require visible interaction; background compatibility is not guaranteed. Closing the current task tab stops work.

## Models and capabilities

- Language model: `deepseek/deepseek-v4.1-flash`, configured in `apps/extension/src/agent/models.ts`.
- Action selection: `typesafe-ai/jev`, configured in `apps/extension/src/agent/vercel-jev.ts`.
- FX browsing skill: [`web-browsing/SKILL.md`](apps/extension/src/agent/skills/web-browsing/SKILL.md), bundled into the runtime prompt. Edit this file to maintain research, interaction, recovery, and evidence guidance; rebuild and reload the extension afterward. Classic retains its existing planner and Jev rules.
- Model availability and usage costs depend on Gateway and its providers. No subscriptions or credits are included.

Supported tools include page reading, typing, clicks, keyboard input, scrolling, navigation, tab creation/switching/closing/grouping, download-link clicks, and download metadata. Native tab closing requires a prior inventory and the existing close approval, verifies the requested tabs disappeared, and keeps one tab open in the window. Background mode protects the visible and current task tabs. Conversations are saved locally. Streamed answers support Markdown; exposed reasoning is shown separately when available.

Accessibility semantics drive observation; DOM nodes provide execution targets and last-moment validation. Disabled, occluded, and offscreen accessibility controls remain context without executable actions. Diagnostics report `accessibility` or `dom-fallback` when Chromium cannot provide a tree. There are no dedicated Facebook, X, or flight-booking scripts. Iframes, shadow DOM, complex widgets, browser-internal pages, and native browser menus have limited or no support. Verification is model-based, not proof that a task succeeded. Stop or Take over cancels the run; it does not undo completed actions.

## Privacy and permissions

Page text, element labels, relevant field values, task history, and your messages may be sent to Gateway and its selected model providers. This is **not an offline assistant**.

The Gateway key, chats, and diagnostic events live in `chrome.storage.local`. The key is not an encrypted secret vault. Use a personal, limited-budget key. Never share it or put it in source files.

Permissions: `debugger` executes and observes page actions; `tabs` and `tabGroups` manage tabs; `downloads` reads download status; `storage` saves local settings/history; `sidePanel` provides the UI; `activeTab` supports current-tab access. HTTP(S) content scripts display progress controls. Gateway host access permits model requests.

Approval checks are heuristic and not a comprehensive security boundary. Do not rely on them to protect sensitive accounts or prevent every destructive action. See [SECURITY.md](SECURITY.md).

## Development

```sh
bun run check
bun run test-page
```

`check` runs typechecking, builds the extension, then runs tests. `bun run scripts/smoke-accessibility.ts` additionally tests delayed chat opening and editor targeting in isolated headless Chrome (set `BROWSER_BINARY` when Chrome is installed elsewhere). Build must precede tests because asset tests inspect `dist`. The optional fixture server runs at `http://localhost:8765`; override with `PORT`.

- `apps/extension/src/agent`: observation, execution, orchestration, verification.
- `apps/extension/src`: background worker, chat UI, progress controls, diagnostics.
- `apps/extension/public`: manifest, styles, icons.
- `packages/protocol`: shared schemas and types.
- `tests`: unit tests and local page fixtures.

See [CONTRIBUTING.md](CONTRIBUTING.md). Generated output and dependencies are ignored; keep them out of commits.

## Troubleshooting and reports

Use settings → **Download logs** after a failure. Include reproduction steps, browser version, build ID, and expected versus actual behavior. Review logs before sharing: redaction is best-effort, and error/reason strings can include page-derived information. Never attach browser profiles, API keys, or private conversation exports.

Each reply shows reported input/output tokens and estimated USD cost underneath it, saved with chat history. Totals update as model usage arrives; FX planner usage arrives at the end of its turn, not token by token. Old chats without usage show unavailable. Interrupted runs, missing usage, and missing model prices are marked partial or unavailable.

Cost uses the [Gateway public model catalog](https://vercel.com/docs/ai-gateway/models-and-providers), refreshed hourly while the worker remains active. These are estimates at input/output catalog rates, not bills: cache discounts, provider routing, extra fees, failed requests, and provider-internal retries can differ. Pricing lookup needs no API key or model call, and failure does not block browsing.

Each completed task also logs `model_usage_summary`, separating FX turns, Jev evaluations, text generation, verification, and Classic planning/page answers. Missing provider usage is counted explicitly.

Completion checks use low reasoning effort, an initial 1,200-token output cap, and no SDK retries. The harness retries a transient service error or invalid structured response once after 250ms using identical observations. Permanent errors and failed retries remain unverified and never replay browser actions. FX planning, Jev decisions, verification, and overall tasks have no harness time limits. Stop remains available; action-count and repeated-failure safeguards remain in place.

Use `verification_start`, `verification_retry`, `verification_end`, and `verification_error` for input size, duration, usage, failure, and cancellation. `fx_turn_end` records tool time, reasoning/answer character counts, and time to first delta. Outside-tool time includes transport and FX overhead. Browser navigation waits, approval expiry, pricing lookups, and the standalone connection diagnostic retain their own bounded waits.

The follow-up run completed two subgoal checks in 5 and 12 seconds, then timed out on a final check with 99,813 input characters. Verification now packs control rows and repeated grouping context into shared tables, preserving every observed control and chronological state change. Evidence stays valid JSON instead of being cut at 12,000 characters. Compare `rawInputChars` with `inputChars` in `verification_start` to measure compression. Timed-out verification requests now count as missing usage, not an apparent complete usage report. Field generation and its independent content review also use low reasoning effort and no SDK retries; `text_model_start/end/error` report their separate durations and usage without logging field content.

`model_unavailable` / `system_overloaded` indicates a provider failure. A blocked result can also mean stale targets, missing approvals, unsuccessful verification, or a bounded retry/scroll limit. Automated tests do not establish live-site compatibility.

## License

Ulka's original code, documentation, logo, and derived icons are licensed under the [MIT License](LICENSE). Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The 17:02 diagnostic run stopped at verification with HTTP 405 (`isRetryable: false`), after browser actions succeeded. FX used Gateway streaming transport while structured helpers used non-streaming transport. Structured helpers now also stream internally, awaiting complete schema-validated output before returning. Original stream errors are preserved for retry classification; partial output never becomes a completion verdict. This transport change is regression-tested with a mocked Gateway; live provider confirmation is still required.

The 17:10 run still returned HTTP 405 after switching to streaming, so streaming alone did not resolve the failure. Use **Help & diagnostics → Test model** to compare four synthetic requests in the extension service worker: FX-style headers, SDK plain output, SDK schema output, and SDK schema plus low reasoning. Checks run concurrently with 10-second deadlines and no SDK retries, consume API credits, and never read pages or perform browser actions. Results include safe transport metadata and a bounded, credential-redacted error response; copy diagnostics afterward. This is an isolation tool, not a confirmed provider fix.

The 17:35 connection checks passed for DeepSeek V4.1 Flash, including structured output with low reasoning. Its real final verification instead failed JSON parsing after 24 seconds. Verification now allows one fresh attempt on invalid structured output using identical evidence and strict validation. A provider-confirmed `length` finish raises the retry output budget from 1,200 to 8,192 tokens; other malformed output keeps the original budget. Logs record finish reason, generated character count, and failed-generation usage without recording generated text. Browser actions are never replayed by this recovery. Earlier StepFun errors explicitly rejected `json_schema`; those are separate from the DeepSeek parsing failure.

FX exposes `ask_user` for essential missing preferences, dates, or ambiguous targets. Questions support two to six choices plus custom text, or free text alone. The running task pauses without an answer deadline and resumes with its tool history and user clarification intact. Stop/Cancel task cancels the pending question; stale and empty replies are rejected. Reopening the panel restores the question while the same background worker remains alive. Browser/extension restarts do not persist running task execution. Clarifications do not replace action approvals or turn user answers into observed evidence.
