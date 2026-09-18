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

## Background tasks

Choose **Settings → Tab behavior → Background** before starting a task. Start on the tab Ulka should use, then switch to another tab to keep browsing. Ulka keeps its task target, creates inactive tabs, and switches its own target without activating tabs. The setting applies to both engines and is fixed for each running task. Keep the side panel open for progress and approvals. Foreground remains the default.

Background mode uses the original task tab, not a duplicate. Some sites may pause work when hidden or require visible interaction; background compatibility is not guaranteed. Closing the current task tab stops work.

## Models and capabilities

- Language model: `zai/glm-5.2-fast`, configured in `apps/extension/src/agent/models.ts`.
- Action selection: `typesafe-ai/jev`, configured in `apps/extension/src/agent/vercel-jev.ts`.
- Model availability and usage costs depend on Gateway and its providers. No subscriptions or credits are included.

Supported tools include page reading, typing, clicks, keyboard input, scrolling, navigation, tab creation/switching/grouping, download-link clicks, and download metadata. Conversations are saved locally. Streamed answers support Markdown; exposed reasoning is shown separately when available.

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

Each completed task logs `model_usage_summary`, with reported input/output tokens separated into FX turns, Jev evaluations, text generation, and verification (plus Classic planning/page answers when used). Missing provider usage is counted explicitly; totals are not a billing estimate and may exclude failed requests or provider-internal retries.

`model_unavailable` / `system_overloaded` indicates a provider failure. A blocked result can also mean stale targets, missing approvals, unsuccessful verification, or a bounded retry/scroll limit. Automated tests do not establish live-site compatibility.

## License

Ulka's original code, documentation, logo, and derived icons are licensed under the [MIT License](LICENSE). Dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
