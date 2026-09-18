import type { ActionRecord, PageElement, PageSnapshot } from '../../../../packages/protocol/src';

// Keep observed meanings intact; browser-local IDs and execution records never help models.
export function modelElement({ nodeId: _nodeId, ...element }: PageElement) {
  return element;
}
export function modelPage(page: PageSnapshot) {
  return { url: page.url, title: page.title, text: page.text, elements: page.elements.map(modelElement) };
}
export function modelHistory(history: ActionRecord[], limit = 10) {
  return history.slice(-limit).map(({ operation, targetLabel, text, pageChanged, url }) => ({
    operation, url,
    ...(targetLabel === undefined ? {} : { targetLabel }),
    ...(text === undefined ? {} : { text }),
    ...(pageChanged === undefined ? {} : { pageChanged }),
  }));
}
