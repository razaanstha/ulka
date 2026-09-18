// Preserve reading position during streaming; resume following only at the bottom.
export function createChatScroll(element: HTMLElement) {
  let following = true;
  let lastTop = element.scrollTop;
  const atBottom = () => element.scrollHeight - element.scrollTop - element.clientHeight <= 2;
  element.addEventListener('wheel', event => {
    if (event.deltaY < 0) following = false;
  }, { passive: true });
  element.addEventListener('scroll', () => {
    if (element.scrollTop < lastTop) following = false;
    else if (atBottom()) following = true;
    lastTop = element.scrollTop;
  });
  return {
    update(change: () => void) {
      const top = element.scrollTop;
      change();
      element.scrollTop = following ? element.scrollHeight : top;
      lastTop = element.scrollTop;
    },
    bottom() {
      following = true;
      element.scrollTop = element.scrollHeight;
      lastTop = element.scrollTop;
    },
  };
}
