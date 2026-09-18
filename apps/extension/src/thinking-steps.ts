import { renderMarkdown } from './markdown';

interface ThinkingState {
  row: HTMLElement;
  spinner: HTMLElement;
  text: HTMLElement;
  step: number;
  html: string;
  spin?: Animation;
  transition?: Animation;
}
const states = new WeakMap<HTMLElement, ThinkingState>();

// Parse accumulated output so token updates extend the latest step in place.
export function renderThinkingSteps(target: HTMLElement, source: string, finished = false): void {
  const doc = target.ownerDocument;
  const parsed = doc.createElement('div');
  renderMarkdown(parsed, source);
  const steps: Node[] = [];
  for (const block of Array.from(parsed.children)) {
    if (block.matches('ul, ol')) {
      for (const child of Array.from(block.children)) {
        const content = doc.createElement('div');
        content.append(...Array.from(child.childNodes)); steps.push(content);
      }
    } else if (block.matches('p') && block.children.length === 0) {
      const segments = new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(block.textContent ?? '');
      for (const { segment } of segments) if (segment.trim()) steps.push(doc.createTextNode(segment.trim()));
    } else {
      steps.push(block);
    }
  }
  let state = states.get(target);
  if (!state || state.row.parentElement !== target) {
    state?.spin?.cancel(); state?.transition?.cancel();
    const row = doc.createElement('div'); row.className = 'thinking-latest';
    const spinner = doc.createElement('span'); spinner.className = 'thinking-spinner'; spinner.setAttribute('aria-hidden', 'true');
    const text = doc.createElement('div'); text.className = 'thinking-latest-text';
    row.append(spinner, text); target.replaceChildren(row);
    state = { row, spinner, text, step: -1, html: '' }; states.set(target, state);
  }
  const reducedMotion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  state.row.classList.toggle('is-finished', finished);
  state.row.setAttribute('aria-label', finished ? 'Last thinking step' : 'Thinking');
  if (finished || reducedMotion) {
    state.spin?.cancel(); state.spin = undefined;
    state.transition?.cancel(); state.transition = undefined;
  } else if (!state.spin && typeof state.spinner.animate === 'function') {
    state.spin = state.spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 900, iterations: Infinity });
    void state.spin.finished?.catch(() => {});
  }
  const content = doc.createElement('div');
  content.append(steps.at(-1) ?? doc.createTextNode(finished ? 'Finished thinking.' : 'Working on your request…'));
  const nextStep = steps.length - 1;
  if (content.innerHTML !== state.html) {
    state.text.replaceChildren(...Array.from(content.childNodes));
    // Animate new steps, not each streaming token. Old text leaves the DOM immediately.
    if (nextStep !== state.step && !reducedMotion && !finished && typeof state.text.animate === 'function') {
      state.transition?.cancel();
      state.transition = state.text.animate([
        { opacity: 0, transform: 'translateY(5px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
      void state.transition.finished?.catch(() => {});
    }
    state.html = state.text.innerHTML;
  }
  state.step = nextStep;
}
