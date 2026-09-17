import { expect, test } from "bun:test";
import { LANGUAGE_MODEL } from "../apps/extension/src/agent/models";

test("uses GLM Fast", () => {
  expect(LANGUAGE_MODEL).toBe("zai/glm-5.2-fast");
});
