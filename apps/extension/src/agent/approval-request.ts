import type { AgentDecision, PageSnapshot } from '../../../../packages/protocol/src';

export interface ApprovalRequest {
  id: string;
  operation: string;
  label: string;
  origin: string;
  text?: string;
}

export function createApprovalRequest(decision: AgentDecision, snapshot: PageSnapshot, text?: string): ApprovalRequest {
  const element = snapshot.elements.find(item => item.id === decision.target?.split(':')[0]);
  const tab = snapshot.tabs?.find(item => item.id === decision.target);
  const url = new URL(tab?.url ?? snapshot.url);
  return {
    id: crypto.randomUUID(), operation: decision.operation,
    label: element?.label ?? tab?.title ?? 'Browser item',
    origin: url.origin === 'null' ? url.protocol : url.origin,
    ...(text === undefined ? {} : { text }),
  };
}

export function formatApprovalRequest(request: ApprovalRequest): string {
  const action = request.operation.toLowerCase().replaceAll('_', ' ');
  return `Allow ${action} on “${request.label}”?\nWebsite: ${request.origin}` +
    (request.text === undefined ? '' : `\n\n${request.operation === 'WEBMCP_CALL' ? 'Tool arguments' : 'Text to enter'}:\n${request.text}`);
}

// One pending action. Late responses cannot authorize a later request.
export class ApprovalGate {
  private pending?: { id: string; resolve: (approved: boolean) => void };

  request(id: string, publish: () => Promise<unknown>, timeoutMs = 30_000): Promise<boolean> {
    this.cancel();
    return new Promise(resolve => {
      const timer = setTimeout(() => this.respond(id, false), timeoutMs);
      this.pending = { id, resolve: approved => { clearTimeout(timer); resolve(approved); } };
      void Promise.resolve().then(() => {
        if (this.pending?.id === id) return publish();
      }).catch(() => this.respond(id, false));
    });
  }

  respond(id: unknown, approved: boolean): boolean {
    if (!this.pending || id !== this.pending.id) return false;
    const pending = this.pending;
    this.pending = undefined;
    pending.resolve(approved);
    return true;
  }

  cancel(): void {
    if (this.pending) this.respond(this.pending.id, false);
  }
}
