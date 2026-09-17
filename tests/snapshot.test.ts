import { expect, test } from "bun:test";
import { snapshotFingerprint } from "../packages/protocol/src";

test("snapshot fingerprint is stable and changes with semantics", () => {
  const base = { pageIdentity: "1", url: "https://x.test", title: "x", text: "hello", scroll: { y: 0, height: 10, viewportHeight: 10 }, elements: [], guards: {} };
  expect(snapshotFingerprint(base)).toBe(snapshotFingerprint(structuredClone(base)));
  expect(snapshotFingerprint({ ...base, text: "changed" })).not.toBe(snapshotFingerprint(base));
});
