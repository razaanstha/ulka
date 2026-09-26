"""Real Chromium UI regression and synthetic streaming benchmark.

Requires Python Playwright and local Chrome. Uses the built panel with simulated
Chrome storage/messages, never a user's profile, API key, or live model request.
"""
import argparse
import json
import mimetypes
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "apps/extension/dist"
MOCK = """
window.fixture = { stored: {}, listeners: [], renders: 0,
 emit(message) { this.listeners.forEach(fn => fn(message)); } };
window.chrome = {
 storage: { local: { get: async () => structuredClone(fixture.stored),
   set: async data => Object.assign(fixture.stored, structuredClone(data)) } },
 runtime: { onMessage: { addListener: fn => fixture.listeners.push(fn) },
   sendMessage: async message => {
     if (message.type === 'CHAT') {
       fixture.request = message;
       return new Promise(resolve => fixture.finish = resolve);
     }
     if (message.type === 'STOP') fixture.finish({ok:true,result:{status:'stopped',reply:'Stopped.'}});
     return {ok:true};
   } }
};
const original = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function(...args) {
 if (this.matches('.streaming, .thinking-content')) fixture.renders++;
 return original.apply(this, args);
};
"""
BENCHMARK = """async () => {
 const chunk = '**Finding:** Browser evidence stays visible. [Reference](https://example.test/)\\n\\n';
 fixture.renders = 0;
 const start = performance.now();
 for (let i=0; i<400; i++) fixture.emit({type:'FX_PROGRESS',text:chunk});
 const dispatchMs = performance.now() - start;
 await new Promise(requestAnimationFrame);
 return {dispatchMs, totalMs:performance.now()-start, renders:fixture.renders,
   characters:document.querySelector('.streaming').textContent.length};
} """


def open_panel(browser, bundle=None):
    page = browser.new_page(viewport={"width": 380, "height": 760})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script(MOCK)

    def route(request):
        name = request.request.url.removeprefix("https://ulka.test/") or "sidepanel.html"
        if "/" in name or name.startswith("."):
            request.abort()
            return
        path = bundle if name == "sidepanel.js" and bundle else DIST / name
        request.fulfill(body=path.read_bytes(), content_type=mimetypes.guess_type(str(path))[0] or "application/octet-stream")

    page.route("https://ulka.test/**", route)
    page.goto("https://ulka.test/", wait_until="networkidle")
    assert not errors, errors
    page.get_by_role("button", name="Open previous chats").wait_for()
    return page, errors


def start(page, prompt):
    page.get_by_role("textbox", name="Message Ulka", exact=True).fill(prompt)
    page.get_by_role("button", name="Send message", exact=True).click()
    page.wait_for_function("document.body.dataset.busy === 'true'")


def idle(page):
    page.wait_for_function("document.body.dataset.busy === 'false'")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-bundle", type=Path)
    parser.add_argument("--screenshot", type=Path)
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            results = {}
            if args.baseline_bundle:
                page, errors = open_panel(browser, args.baseline_bundle.resolve())
                start(page, "Benchmark streaming")
                results["baseline"] = page.evaluate(BENCHMARK)
                assert not errors, errors
                page.close()

            page, errors = open_panel(browser)
            page.get_by_role("button", name="Settings", exact=True).click()
            assert page.get_by_role("textbox", name="Gateway API key").evaluate("el => el === document.activeElement")
            page.keyboard.press("Escape")
            assert page.get_by_role("button", name="Settings", exact=True).evaluate("el => el === document.activeElement")
            start(page, "Benchmark streaming")
            results["current"] = page.evaluate(BENCHMARK)
            assert results["current"]["renders"] == 1, results
            assert results["current"]["characters"] == 20400, results

            # A reader moving upward must not be pulled back to the bottom.
            page.locator("#chat").hover()
            page.mouse.wheel(0, -500)
            page.wait_for_function("document.querySelector('#chat').scrollTop < document.querySelector('#chat').scrollHeight - document.querySelector('#chat').clientHeight - 100")
            before = page.locator("#chat").evaluate("el => el.scrollTop")
            page.evaluate("fixture.emit({type:'FX_PROGRESS',text:'Extra finding.'})")
            page.wait_for_function("document.querySelector('.streaming').textContent.includes('Extra finding.')")
            after = page.locator("#chat").evaluate("el => el.scrollTop")
            assert abs(before-after) < 2, (before, after)
            page.get_by_role("button", name="Stop current task").click()
            idle(page)
            assert "Extra finding." in page.locator("#chat").inner_text()
            assert "Completion not verified" in page.locator("#chat").inner_text()

            # Complete before the queued paint: final text must win and persist.
            start(page, "Finish immediately")
            page.evaluate("""() => {
              fixture.emit({type:'FX_REASONING',text:'Checked the evidence.'});
              fixture.emit({type:'FX_PROGRESS',text:'Pending draft'});
              fixture.finish({ok:true,result:{status:'done',reply:'Final **verified** response.'}});
            }""")
            idle(page)
            page.evaluate("() => new Promise(requestAnimationFrame)")
            assert page.locator(".message.assistant").last.inner_text() == "Final verified response."
            reasoning = page.locator(".thinking-content").last.text_content().strip()
            assert reasoning == "Checked the evidence.", repr(reasoning)
            page.get_by_role("button", name="New chat", exact=True).click()
            page.get_by_role("button", name="Open previous chats").click()
            page.locator(".history-entry").first.click()
            assert page.locator(".message.assistant").last.inner_text() == "Final verified response."
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            assert not errors, errors
            if args.screenshot:
                args.screenshot.parent.mkdir(parents=True, exist_ok=True)
                page.evaluate("() => Promise.all(document.getAnimations().filter(a => a.effect.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))")
                page.screenshot(path=str(args.screenshot))
            results["checks"] = ["settings keyboard focus", "stream batching", "complete text", "paused scroll", "Stop preserves partial output", "completion before paint", "history restoration", "380px layout", "no page errors"]
            print(json.dumps(results, indent=2))
        finally:
            browser.close()


if __name__ == "__main__":
    main()
