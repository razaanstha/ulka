const file = Bun.file("tests/fixtures/agent-page.html");
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PORT ?? 8765),
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/browser-input.html') return new Response(Bun.file('tests/fixtures/browser-input.html'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (url.pathname === "/" || url.pathname === "/agent-page.html") return new Response(file, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("Not Found", { status: 404 });
  },
});
console.log(`Ulka test page: ${server.url}`);
