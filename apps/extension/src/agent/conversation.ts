import { currentTimeContext, TIME_RULES } from "./time-context";
import type { UsageReporter } from "./model-usage";
import { createGateway, generateText, Output } from "ai";
import { z } from "zod";
import { LANGUAGE_MODEL } from "./models";

// Approved design: LLM handles conversation and goal extraction only. Jev remains sole browser decision engine.
export interface ConversationMessage { role: "user" | "assistant"; content: string }
export interface ConversationIntent { shouldAct: boolean; shouldReadPage: boolean; goal: string; reply: string; navigationUrl: string | null }

const intentSchema = z.object({
  shouldAct: z.boolean(),
  shouldReadPage: z.boolean(),
  goal: z.string().max(2_000),
  reply: z.string().min(1).max(2_000),
  navigationUrl: z.string().max(2_000).nullable(),
}).refine((value) => !(value.shouldAct && value.shouldReadPage), { message: "Cannot act and read page simultaneously" });

type GenerateFunction = (input: Parameters<typeof generateText>[0]) => Promise<{ output: ConversationIntent; usage?: unknown; totalUsage?: unknown }>;

export class ConversationPlanner {
  private readonly generate: GenerateFunction;
  constructor(private readonly apiKey: string, generator?: GenerateFunction, private readonly reportUsage?: UsageReporter) {
    if (!apiKey.trim()) throw new Error("Vercel AI Gateway API key required");
    this.generate = generator ?? (generateText as GenerateFunction);
  }

  async interpret(messages: ConversationMessage[]): Promise<ConversationIntent> {
    if (!messages.length || messages.at(-1)?.role !== "user") throw new Error("Conversation needs a user message");
    const gateway = createGateway({ apiKey: this.apiKey });
    const result = await this.generate({
      model: gateway(LANGUAGE_MODEL),
      system: [
        TIME_RULES,
        `Current host time: ${JSON.stringify(currentTimeContext())}`,
        "You are Ulka's conversational interface.",
        "Decide whether latest user message requests a browser action.",
        "Set shouldReadPage true only for reading the already-open current page without navigation or interaction. Requests to search, navigate then read, compare results, or fill forms are browser actions.",
        "shouldAct and shouldReadPage cannot both be true.",
        "If yes, preserve EVERY requested outcome and constraint in the browser goal. For multi-step tasks, write ordered milestones within that goal, ending with the user's requested final result. Opening a website is only the first milestone when further work was requested.",
        "Plan before choosing a URL: identify the requested outcome, constraints, required information, and ordered milestones. Do not jump straight to navigation because a URL or website name is mentioned.",
        "Set navigationUrl to a canonical fully-qualified HTTPS starting URL when navigation is needed, including an appropriate search site for web or flight searches. This is a starting point, never a completion signal. Otherwise set it null.",
        "Ask a concise clarification with shouldAct false when essential information is missing, such as required travel dates. Do not invent user preferences or dates.",
        "Never produce selectors, coordinates, JavaScript, shell commands, CDP commands, or implementation instructions.",
        "If no browser action is requested, set shouldAct false and answer conversationally.",
        "The reply is a short acknowledgement, not a claim that an unexecuted action succeeded.",
      ].join(" "),
      messages,
      output: Output.object({ schema: intentSchema, name: "ulka_conversation_intent" }),
      maxOutputTokens: 2_000,
    });
    this.reportUsage?.("conversation", result.totalUsage ?? result.usage);
    return intentSchema.parse(result.output);
  }
}
