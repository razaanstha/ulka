// Read loaded, rendered text regardless of viewport position. No scrolling or field values.
export function readPageExpression(query: string, offset: number): string {
  return `(() => {
    const query = ${JSON.stringify(query)}.toLocaleLowerCase(), offset = ${Math.max(0, Math.floor(offset))};
    if (!document.body) return { reading: { notice: 'Document not ready' } };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const lines = []; let node, scanned = 0, chars = 0, scanLimited = false;
    while ((node = walker.nextNode())) {
      if (++scanned > 30000 || chars >= 200000) { scanLimited = true; break; }
      const parent = node.parentElement;
      if (!parent || parent.closest('script,style,noscript,template,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"],[inert]')) continue;
      let hidden = false;
      for (let e = parent; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') { hidden = true; break; }
        if (e.tagName === 'DETAILS' && !e.open && !e.querySelector('summary')?.contains(parent)) { hidden = true; break; }
      }
      if (hidden || !parent.getClientRects().length) continue;
      const text = node.textContent.replace(/\\s+/g, ' ').trim();
      if (!text) continue;
      lines.push(text); chars += text.length;
    }
    const text = lines.join('\\n');
    let content, nextOffset = null, matches = 0;
    if (query) {
      const lower = text.toLocaleLowerCase(), excerpts = []; let cursor = offset, size = 0;
      while (cursor < text.length) {
        const index = lower.indexOf(query, cursor); if (index < 0) break;
        const end = Math.min(text.length, index + query.length + 300);
        const excerpt = text.slice(Math.max(0, index - 200), end);
        if (size + excerpt.length > 6000) { nextOffset = index; break; }
        excerpts.push(excerpt); matches++; size += excerpt.length; cursor = end;
      }
      content = excerpts.join('\\n…\\n');
    } else {
      content = text.slice(offset, offset + 6000);
      if (offset + 6000 < text.length) nextOffset = offset + 6000;
    }
    return { reading: { url: location.href, title: document.title, text: content, query, matches, nextOffset, scanLimited, scope: 'Loaded rendered main-document text only; excludes editable fields. No scrolling performed.' } };
  })()`;
}
