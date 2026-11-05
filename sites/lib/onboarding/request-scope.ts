export type RequestTicket = Readonly<{ companyId: string; generation: number; signal: AbortSignal }>;

/** Cancellation saves work; ticket identity prevents even uncancellable late work committing. */
export class RequestScope {
  private generation = 0;
  private ticket: RequestTicket | null = null;
  private controller: AbortController | null = null;

  begin(companyId: string): RequestTicket {
    this.invalidate();
    this.controller = new AbortController();
    this.ticket = Object.freeze({ companyId, generation: this.generation, signal: this.controller.signal });
    return this.ticket;
  }

  current(ticket: RequestTicket): boolean {
    return this.ticket === ticket && ticket.generation === this.generation && ticket.companyId === this.ticket.companyId && !ticket.signal.aborted;
  }

  invalidate(): void {
    this.controller?.abort();
    this.controller = null;
    this.ticket = null;
    this.generation += 1;
  }
}
