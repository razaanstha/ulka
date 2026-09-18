import { z } from 'zod';

export const userQuestionSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(200)).min(2).max(6).optional(),
});
export type UserQuestion = z.infer<typeof userQuestionSchema>;
export type PendingQuestion = UserQuestion & { id: string };

export class UserQuestionGate {
  private pending?: { request: PendingQuestion; resolve: (answer: string) => void; reject: (reason: unknown) => void };
  get current(): PendingQuestion | undefined { return this.pending?.request; }

  async ask(input: UserQuestion, signal: AbortSignal, publish: (request: PendingQuestion) => Promise<unknown>): Promise<string> {
    signal.throwIfAborted();
    if (this.pending) throw new Error('A user question is already pending');
    const request = { ...userQuestionSchema.parse(input), id: crypto.randomUUID() };
    let abort!: () => void;
    try {
      return await new Promise<string>((resolve, reject) => {
        this.pending = { request, resolve, reject };
        abort = () => this.cancel(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        void Promise.resolve().then(() => {
          if (this.pending?.request.id === request.id) return publish(request);
        }).catch(error => {
          if (this.pending?.request.id === request.id) this.cancel(error);
        });
      });
    } finally { signal.removeEventListener('abort', abort); }
  }

  respond(id: unknown, answer: unknown): boolean {
    if (!this.pending || this.pending.request.id !== id || typeof answer !== 'string' || !answer.trim() || answer.length > 4000) return false;
    const pending = this.pending; this.pending = undefined;
    pending.resolve(answer.trim()); return true;
  }

  cancel(reason: unknown = new Error('Question cancelled')): void {
    const pending = this.pending; this.pending = undefined; pending?.reject(reason);
  }
}
