import { createGateway, generateText, Output } from "ai";
import { z } from "zod";
import { LANGUAGE_MODEL } from "./models";
import type { ActionRecord, PageElement, PageSnapshot } from "../../../../packages/protocol/src";

const schema = z.object({ text: z.string().min(1).max(2_000) });
export class TextGenerator {
  constructor(private readonly apiKey: string, private readonly signal?: AbortSignal) {}
  async generate(goal: string, field: PageElement, page: PageSnapshot, history: ActionRecord[]): Promise<string> {
    const gateway = createGateway({ apiKey: this.apiKey });
    const result = await generateText({
      abortSignal: this.signal,
      model: gateway(LANGUAGE_MODEL),
      system: "Return only text value needed for selected browser field. Never return actions, selectors, code, or explanation.",
      prompt: JSON.stringify({ goal, field: { label: field.label, role: field.role, inputType: field.inputType, currentValue: field.value }, page: { title: page.title, text: page.text }, recentActions: history.slice(-6) }),
      output: Output.object({ schema }), maxOutputTokens: 2_000,
    });
    return schema.parse(result.output).text;
  }
}
