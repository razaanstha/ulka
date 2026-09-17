import { Marked } from "marked";

const markdown = new Marked({ renderer: { html: () => "" } });

// Parse Markdown, then rebuild a small safe DOM allowlist. Never attach model HTML.
export function renderMarkdown(target: HTMLElement, source: string): void {
  const doc = target.ownerDocument;
  const template = doc.createElement("template");
  template.innerHTML = markdown.parse(source, { async: false, gfm: true });
  const allowed = new Set(["P","BR","HR","STRONG","EM","DEL","CODE","PRE","BLOCKQUOTE","UL","OL","LI","TABLE","THEAD","TBODY","TR","TH","TD","H1","H2","H3","H4","H5","H6","A"]);
  function copy(node: Node, parent: Node) {
    if (node.nodeType === 3) { parent.appendChild(doc.createTextNode(node.textContent ?? "")); return; }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    if (!allowed.has(element.tagName)) return;
    const tag = /^H[1-6]$/.test(element.tagName) ? `h${Math.min(6, Number(element.tagName[1]) + 2)}` : element.tagName.toLowerCase();
    const clean = doc.createElement(tag);
    if (tag === "a") {
      const href = element.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) { for (const child of Array.from(element.childNodes)) copy(child, parent); return; }
      clean.setAttribute("href", href); clean.setAttribute("target", "_blank"); clean.setAttribute("rel", "noopener noreferrer");
    }
    if (tag === "ol" && /^\d+$/.test(element.getAttribute("start") ?? "")) clean.setAttribute("start", element.getAttribute("start")!);
    for (const child of Array.from(element.childNodes)) copy(child, clean);
    parent.appendChild(clean);
  }
  const fragment = doc.createDocumentFragment();
  for (const child of Array.from(template.content.childNodes)) copy(child, fragment);
  target.replaceChildren(fragment);
}
