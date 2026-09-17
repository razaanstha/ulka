import { bundleLicenses } from './licenses';

const result = await Bun.build({
  entrypoints: ["apps/extension/src/background.ts", "apps/extension/src/sidepanel.ts", "apps/extension/src/overlay.ts"],
  outdir: "apps/extension/dist",
  target: "browser",
  minify: false,
  naming: "[name].js",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await bundleLicenses();
await Promise.all([
  Bun.write("apps/extension/dist/LICENSE", Bun.file("LICENSE")),
  Bun.write("apps/extension/dist/THIRD_PARTY_NOTICES.md", Bun.file("THIRD_PARTY_NOTICES.md")),
  Bun.write("apps/extension/dist/licenses/Apache-2.0.txt", Bun.file("licenses/Apache-2.0.txt")),
  ...[16, 32, 48, 128].map(size => Bun.write(`apps/extension/dist/icons/icon-${size}.png`, Bun.file(`apps/extension/public/icons/icon-${size}.png`))),
  Bun.write("apps/extension/dist/ulka-logo.jpg", Bun.file("ulka-logo.jpg")),
  Bun.write("apps/extension/dist/fx-core.wasm", Bun.file("node_modules/libfx/fx-core.wasm")),
  Bun.write("apps/extension/dist/build-info.json", JSON.stringify({ builtAt: new Date().toISOString(), id: crypto.randomUUID() })),
  Bun.write("apps/extension/dist/manifest.json", Bun.file("apps/extension/public/manifest.json")),
  Bun.write("apps/extension/dist/sidepanel.html", Bun.file("apps/extension/public/sidepanel.html")),
  Bun.write("apps/extension/dist/sidepanel.css", Bun.file("apps/extension/public/sidepanel.css")),
  Bun.write("apps/extension/dist/chat.css", Bun.file("apps/extension/public/chat.css")),
]);
