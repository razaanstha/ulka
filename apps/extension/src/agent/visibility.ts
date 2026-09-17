// Shared by observation and last-moment target validation. No page-supplied code.
export const VISIBILITY_HELPERS = String.raw`
  const visibilityReason = (element) => {
    if (element.closest('[aria-hidden="true"],[inert]')) return 'hidden-subtree';
    const style = getComputedStyle(element);
    if (['hidden', 'collapse'].includes(style.visibility)) return 'css-hidden';
    for (let node = element; node; node = node.parentElement) {
      const ancestorStyle = getComputedStyle(node);
      if (ancestorStyle.display === 'none' || ancestorStyle.opacity === '0') return 'css-hidden';
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 'no-layout';
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return 'offscreen';
    return null;
  };
  const visible = (element) => visibilityReason(element) === null;
  const interactionPoint = (element) => {
    // Client rects avoid gaps in wrapped inline links. Clip before sampling so
    // partially visible controls do not require their original center onscreen.
    const fragments = [...element.getClientRects()];
    const rects = fragments.length ? fragments : [element.getBoundingClientRect()];
    const samples = [[0.5,0.5],[0.2,0.5],[0.8,0.5],[0.5,0.2],[0.5,0.8],[0.2,0.2],[0.8,0.2],[0.2,0.8],[0.8,0.8]];
    for (const rect of rects.slice(0, 16)) {
      const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
      const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
      if (right <= left || bottom <= top) continue;
      for (const [fx, fy] of samples) {
        const x = left + (right - left) * fx, y = top + (bottom - top) * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === element || element.contains(hit))) return { x, y };
      }
    }
    return null;
  };
`;
