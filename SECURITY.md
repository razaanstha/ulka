# Security and privacy

Ulka is an experimental agent with powerful browser access. Use a separate profile and supervise actions. Approval rules depend on element labels and action types; they can miss sensitive actions. Model output and page content are untrusted. Outcome verification is fallible.

## Data handling

- Requests can transmit messages, page content, field values, URLs, and action history to Vercel AI Gateway and its model providers.
- API keys, chats, and the latest 400 diagnostic events are stored locally by the extension. Local storage is not an encrypted credentials vault.
- Logs redact known keys and selected fields, but free-form errors and failure reasons can retain sensitive page text. Inspect reports manually before sharing.
- Thinking output is not stored with saved chat messages. It may still be processed by model providers.
- Stop cancels ongoing work but cannot reverse actions already performed.

Use a dedicated Gateway key with appropriate spending limits. Revoke it if exposed. Removing the extension clears its local data, but not data already sent to providers or downloaded/exported files.

## Reporting

Do not put credentials, private page content, or exploit details in public issues. Use the repository's private vulnerability reporting feature if enabled. If unavailable, ask the maintainer for a private reporting channel without disclosing sensitive details publicly. A private reporting channel should be configured before public launch.

No comprehensive security audit or guaranteed response timeframe is claimed.
