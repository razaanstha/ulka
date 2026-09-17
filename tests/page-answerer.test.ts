import { expect, test } from "bun:test";
import { PageAnswerer } from "../apps/extension/src/agent/page-answerer";
import type { PageSnapshot } from "../packages/protocol/src";

test("page answerer receives only structured visible observation", async () => {
  const page: PageSnapshot = { snapshotId: "s", fingerprint: "f", pageIdentity: "p", url: "https://example.test", title: "Example", text: "Visible fare SEK 1200",
    scroll: { y: 0, height: 100, viewportHeight: 100 }, elements: [], guards: {}, createdAt: 1 };
  const generator = async (input: any) => {
    const payload = JSON.parse(input.prompt);
    expect(payload.page.text).toBe("Visible fare SEK 1200");
    expect(payload.page).not.toHaveProperty("html");
    return { output: { answer: "Fare is SEK 1200.", evidence: ["Visible fare SEK 1200"] } };
  };
  expect(await new PageAnswerer("test-key", generator).answer([{ role: "user", content: "What is the fare?" }], page))
    .toEqual({ answer: "Fare is SEK 1200.", evidence: ["Visible fare SEK 1200"] });
});
