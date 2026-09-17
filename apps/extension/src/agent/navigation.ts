export async function waitForNavigation(
  tabId: number,
  readTabs: () => Promise<Array<{ id?: number; url?: string; status?: string }>>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = (await readTabs()).find(item => item.id === tabId);
    if (!tab) throw new Error("Task tab was closed during navigation.");
    if (tab.status === "complete" && tab.url?.startsWith("https://")) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error("Page did not finish loading within 30 seconds; task has not completed.");
}
