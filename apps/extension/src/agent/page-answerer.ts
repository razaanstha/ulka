import { createGateway, generateText, Output } from "ai";
import { z } from "zod";
import { LANGUAGE_MODEL } from "./models";
import type { PageSnapshot } from "../../../../packages/protocol/src";
import type { ConversationMessage } from "./conversation";

const schema = z.object({ answer: z.string().min(1).max(8_000), evidence: z.array(z.string().max(500)).max(12) });
export interface PageAnswer { answer: string; evidence: string[] }
type GenerateFunction = (input: Parameters<typeof generateText>[0]) => Promise<{ output: PageAnswer }>;

export class PageAnswerer {
  private readonly generate: GenerateFunction;
  constructor(private readonly apiKey: string, generator?: GenerateFunction) { this.generate = generator ?? (generateText as GenerateFunction); }
  async answer(messages: ConversationMessage[], page: PageSnapshot): Promise<PageAnswer> {
    const gateway = createGateway({ apiKey: this.apiKey });
    const result = await this.generate({
      model: gateway(LANGUAGE_MODEL),
      system: "Answer only from supplied visible page observation. State when evidence is insufficient. Never claim hidden or unobserved content.",
      prompt: JSON.stringify({ conversation: messages.slice(-12), page: { url: page.url, title: page.title, text: page.text, elements: page.elements } }),
      output: Output.object({ schema, name: "ulka_page_answer" }), maxOutputTokens: 2_000,
    });
    return schema.parse(result.output);
  }
}
