// Accumulate streamed data immediately, but paint it at most once per frame.
// Call flush before moving a message, or cancel before rendering a final result.
export function createRenderBatch(
  render: () => void,
  schedule = (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancel = (id: number) => cancelAnimationFrame(id),
) {
  let frame: number | undefined;
  const batch = {
    request() {
      if (frame === undefined) frame = schedule(() => {
        frame = undefined;
        render();
      });
    },
    flush() {
      if (frame === undefined) return;
      cancel(frame);
      frame = undefined;
      render();
    },
    cancel() {
      if (frame !== undefined) cancel(frame);
      frame = undefined;
    },
  };
  return batch;
}
