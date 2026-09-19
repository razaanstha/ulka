export const LANGUAGE_MODEL = "deepseek/deepseek-v4.1-flash";

// Dedicated field writer/reviewer; planning and final verification stay separate.
// Mercury intermittently refused harmless synthetic field values in live checks.
// Use the existing Gateway route while keeping field reasoning disabled.
export const TEXT_MODEL = LANGUAGE_MODEL;
