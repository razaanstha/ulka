import { expect, test } from "bun:test";
import { waitForNavigation } from "../apps/extension/src/agent/navigation";

test("waits for the task tab rather than another already-loaded tab", async () => {
  let calls = 0;
  await waitForNavigation(1, async () => {
    calls++;
    return [{ id: 1, url: "https://example.test", status: calls === 1 ? "loading" : "complete" }, { id: 2, url: "https://other.test", status: "complete" }];
  });
  expect(calls).toBe(2);
});

test("closed task tab does not silently redirect work to another tab", async () => {
  await expect(waitForNavigation(1, async () => [{ id: 2, url: "https://other.test", status: "complete" }])).rejects.toThrow("closed");
});

test("load timeout is not reported as success", async () => {
  await expect(waitForNavigation(1, async () => [], 0)).rejects.toThrow("has not completed");
});
