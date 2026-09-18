import skill from "./web-browsing/SKILL.md" with { type: "text" };

// Bundle the maintained runtime skill locally; omit discovery metadata from the prompt.
export const WEB_BROWSING_SKILL = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
