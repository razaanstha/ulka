import { expect, test } from "bun:test";
import { sanitize } from "../apps/extension/src/diagnostics";

test("diagnostic export redacts nested input, credentials, and URL details", () => {
  const result = JSON.stringify(sanitize({
    history: [{ text: "private form value", targetLabel: "personal label", url: "https://example.com/private?token=abc#secret" }],
    error: new Error("Request failed with custom-secret and vck_example123"),
    operation: "TYPE_TEXT", latencyMs: 42,
  }, "", ["custom-secret"]));
  for (const secret of ["private form value", "personal label", "custom-secret", "vck_example123", "token=abc"]) expect(result).not.toContain(secret);
  expect(result).toContain("TYPE_TEXT");
  expect(result).toContain("latencyMs");
  expect(result).toContain("example.com");
});
