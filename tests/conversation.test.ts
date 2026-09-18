import { describe, expect, test } from "bun:test";
import { ConversationPlanner } from "../apps/extension/src/agent/conversation";

describe("conversation planner", () => {
  test("uses current Gateway model and returns structured browser goal", async () => {
    const generator = async (input: any) => {
      expect(input.model.modelId).toBe("deepseek/deepseek-v4.1-flash");
      expect(input.providerOptions).toBeUndefined();
      expect(input.system).toContain("Current host time:");
      expect(input.system).toContain("timeZone");
      expect(input.messages.at(-1)).toEqual({ role: "user", content: "Could you open About?" });
      return { output: { shouldAct: true, shouldReadPage: false, goal: "Open the About page.", reply: "I'll open About.", navigationUrl: null } };
    };
    const result = await new ConversationPlanner("test-key", generator).interpret([{ role: "user", content: "Could you open About?" }]);
    expect(result).toEqual({ shouldAct: true, shouldReadPage: false, goal: "Open the About page.", reply: "I'll open About.", navigationUrl: null });
  });

  test("rejects malformed structured output", async () => {
    const generator = async () => ({ output: { shouldAct: true, goal: "", reply: "" } as any });
    await expect(new ConversationPlanner("test-key", generator).interpret([{ role: "user", content: "hello" }])).rejects.toThrow();
  });
});
