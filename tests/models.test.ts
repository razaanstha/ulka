import { expect, test } from "bun:test";
import { LANGUAGE_MODEL } from "../apps/extension/src/agent/models";

test("uses configured language model", () => {
  expect(LANGUAGE_MODEL).toBe("deepseek/deepseek-v4.1-flash");
});
