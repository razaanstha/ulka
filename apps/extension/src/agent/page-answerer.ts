import { generateStructuredText, type StructuredRequest } from './structured-generation';
import { currentTimeContext, TIME_RULES } from "./time-context";
import { modelPage } from "./model-context";
import type { UsageReporter } from "./model-usage";
import { createGateway, Output } from "ai";
import { z } from "zod";
import { LANGUAGE_MODEL } from "./models";
import type { PageSnapshot } from "../../../../packages/protocol/src";
import type { ConversationMessage } from "./conversation";

const schema = z.object({ answer: z.string().min(1).max(8_000), evidence: z.array(z.string().max(500)).max(12) });
export interface PageAnswer { answer: string; evidence: string[] }
type GenerateFunction = (input: StructuredRequest) => Promise<{ output: PageAnswer; usage?: unknown; totalUsage?: unknown }>;

export class PageAnswerer {
  private readonly generate: GenerateFunction;
  constructor(private readonly apiKey: string, generator?: GenerateFunction, private readonly reportUsage?: UsageReporter) { this.generate = generator ?? (generateStructuredText as GenerateFunction); }
  async answer(messages: ConversationMessage[], page: PageSnapshot): Promise<PageAnswer> {
    const gateway = createGateway({ apiKey: this.apiKey });
    const result = await this.generate({
      model: gateway(LANGUAGE_MODEL),
      system: TIME_RULES + " Answer only from supplied visible page observation. State when evidence is insufficient. Never claim hidden or unobserved content.",
      prompt: JSON.stringify({ currentTime: currentTimeContext(), conversation: messages.slice(-12), page: modelPage(page) }),
      output: Output.object({ schema, name: "ulka_page_answer" }), maxOutputTokens: 2_000,
    });
    this.reportUsage?.("page_answer", result.totalUsage ?? result.usage);
    return schema.parse(result.output);
  }
}
