import { expect, test } from "bun:test";

test('build preserves nested third-party license notices', async () => {
  const index = await Bun.file('apps/extension/dist/licenses/index.json').json();
  const entry = index.find((item: { name: string }) => item.name === '@ai-sdk/provider-utils');
  const nested = 'src/to-json-schema/zod3-to-json-schema/LICENSE';
  expect(entry.files).toContain(nested);
  expect(await Bun.file(`apps/extension/dist/licenses/${entry.name}@${entry.version}/${nested}`).text()).toContain('Stefan Terdell');
});

test('distribution includes project license, third-party notices and full Apache terms', async () => {
  expect(await Bun.file('apps/extension/dist/LICENSE').text()).toBe(await Bun.file('LICENSE').text());
  expect(await Bun.file('apps/extension/dist/THIRD_PARTY_NOTICES.md').text()).toBe(await Bun.file('THIRD_PARTY_NOTICES.md').text());
  expect(await Bun.file('apps/extension/dist/licenses/Apache-2.0.txt').text()).toContain('END OF TERMS AND CONDITIONS');
});

test('build includes runtime dependency license notices', async () => {
  const index = await Bun.file('apps/extension/dist/licenses/index.json').json();
  for (const name of ['ai', 'libfx', 'marked', 'zod']) {
    const entry = index.find((item: { name: string }) => item.name === name);
    expect(entry).toBeDefined();
    expect(entry.files.length).toBeGreaterThan(0);
    for (const file of entry.files) expect(await Bun.file(`apps/extension/dist/licenses/${name}@${entry.version}/${file}`).exists()).toBe(true);
  }
});

test("manifest icons are packaged PNGs with matching dimensions", async () => {
  const manifest = await Bun.file("apps/extension/dist/manifest.json").json();
  for (const icons of [manifest.icons, manifest.action.default_icon]) {
    for (const [size, path] of Object.entries(icons)) {
      const bytes = Buffer.from(await Bun.file(`apps/extension/dist/${path}`).arrayBuffer());
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      expect(bytes.readUInt32BE(16)).toBe(Number(size));
      expect(bytes.readUInt32BE(20)).toBe(Number(size));
    }
  }
});

test("built panel includes its linked stylesheet", async () => {
  const html = await Bun.file("apps/extension/dist/sidepanel.html").text();
  expect(html).toContain('href="sidepanel.css"');
  expect(await Bun.file("apps/extension/dist/sidepanel.css").text()).toBe(await Bun.file("apps/extension/public/sidepanel.css").text());
});
