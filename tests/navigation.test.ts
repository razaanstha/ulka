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

test("supported internal URLs normalize and finish loading", async () => {
  const { validateNavigationUrl, samePageUrl, internalPageSnapshot } = await import('../apps/extension/src/agent/navigation');
  for (const page of ['extensions', 'history', 'downloads', 'bookmarks', 'settings', 'newtab', 'version']) {
    expect(validateNavigationUrl('chrome://' + page)).toBe('chrome://' + page + '/');
    expect(samePageUrl('chrome://' + page, 'chrome://' + page + '/')).toBe(true);
    await waitForNavigation(1, async () => [{ id: 1, url: 'chrome://' + page + '/', status: 'complete' }]);
  }
  const snapshot = internalPageSnapshot({ id: 1, url: 'chrome://extensions/', title: 'Extensions', status: 'complete' });
  expect(snapshot?.url).toBe('chrome://extensions/');
  expect(snapshot?.elements).toEqual([]);
  expect(snapshot?.text).toContain('cannot verify settings changes');
  expect(internalPageSnapshot({ url: 'https://example.test/' })).toBeUndefined();
});

test("unsafe schemes and internal command pages stay rejected", async () => {
  const { validateNavigationUrl } = await import('../apps/extension/src/agent/navigation');
  for (const url of ['chrome://quit/', 'chrome://restart/', 'chrome://crash/', 'chrome://flags/', 'chrome://user@extensions/', 'chrome://extensions:123/', 'javascript:alert(1)', 'file:///tmp/test', 'data:text/html,test', 'chrome-extension://abc/', 'https://user:pass@example.test/']) {
    expect(() => validateNavigationUrl(url)).toThrow();
  }
});
