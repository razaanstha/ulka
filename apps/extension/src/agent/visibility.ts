// Shared by observation and last-moment target validation. No page-supplied code.
export const VISIBILITY_HELPERS = String.raw`
  // Document hit tests retarget shadow descendants to their host. Check each
  // boundary from the document inward so real overlays still block the target.
  const hitReaches = (element, x, y) => {
    const roots = [];
    for (let root = element.getRootNode(); root.host; root = root.host.getRootNode()) roots.unshift(root);
    let scope = element.ownerDocument;
    for (const root of roots) {
      if (scope.elementFromPoint(x,y) !== root.host) return false;
      scope = root;
    }
    const hit = scope.elementFromPoint(x,y);
    return !!hit && (hit === element || element.contains(hit));
  };
  const visibilityReason = (element) => {
    const view = element.ownerDocument.defaultView;
    if (!view) return 'no-layout';
    if (element.ownerDocument !== document) {
      const frame = view.frameElement;
      if (!frame || !frame.isConnected || frame.contentDocument !== element.ownerDocument) return 'no-layout';
      const frameReason = visibilityReason(frame);
      if (frameReason) return frameReason;
    }
    if (element.closest('[aria-hidden="true"],[inert]')) return 'hidden-subtree';
    const style = view.getComputedStyle(element);
    if (['hidden', 'collapse'].includes(style.visibility)) return 'css-hidden';
    for (let node = element; node; node = node.parentElement || node.getRootNode().host) {
      if (node.matches('[aria-hidden="true"],[inert]')) return 'hidden-subtree';
      const ancestorStyle = view.getComputedStyle(node);
      if (ancestorStyle.display === 'none' || ancestorStyle.opacity === '0') return 'css-hidden';
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return 'no-layout';
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= view.innerHeight || rect.left >= view.innerWidth) return 'offscreen';
    return null;
  };
  const visible = (element) => visibilityReason(element) === null;
  const interactionPoint = (element) => {
    const doc = element.ownerDocument, view = doc.defaultView;
    if (!view) return null;
    // Map frame-local hit points to the top viewport, checking every embedding
    // frame for clipping and overlays. Reject detached/navigated documents.
    const topPoint = (x, y) => {
      let current = view;
      while (current.document !== document) {
        const frame = current.frameElement;
        if (!frame || !frame.isConnected || frame.contentDocument !== current.document) return null;
        const rect = frame.getBoundingClientRect();
        const sx = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
        const sy = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
        x = rect.left + (frame.clientLeft + x) * sx;
        y = rect.top + (frame.clientTop + y) * sy;
        current = frame.ownerDocument.defaultView;
        if (!current || x < 0 || y < 0 || x >= current.innerWidth || y >= current.innerHeight || !hitReaches(frame,x,y)) return null;
      }
      return { x, y };
    };
    // Client rects avoid gaps in wrapped inline links. Clip before sampling so
    // partially visible controls do not require their original center onscreen.
    const fragments = [...element.getClientRects()];
    const rects = fragments.length ? fragments : [element.getBoundingClientRect()];
    const samples = [[0.5,0.5],[0.2,0.5],[0.8,0.5],[0.5,0.2],[0.5,0.8],[0.2,0.2],[0.8,0.2],[0.2,0.8],[0.8,0.8]];
    for (const rect of rects.slice(0, 16)) {
      const left = Math.max(0, rect.left), right = Math.min(view.innerWidth, rect.right);
      const top = Math.max(0, rect.top), bottom = Math.min(view.innerHeight, rect.bottom);
      if (right <= left || bottom <= top) continue;
      for (const [fx, fy] of samples) {
        const x = left + (right - left) * fx, y = top + (bottom - top) * fy;
        if (hitReaches(element,x,y)) {
          const point = topPoint(x,y);
          if (point) return point;
        }
      }
    }
    return null;
  };
`;
