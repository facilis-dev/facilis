// The kernel's listening ports — what the Ports view lists.
//
// A port -> pid map fed by the kernel's "listen" and "exit" events. Split out of the
// controller (file-length ratchet) so the bookkeeping, and the pruning a dying process
// needs, are testable without a kernel.

/** One live in-VM listener: the port it bound and the process that owns it. */
export interface PortListener {
  port: number;
  pid: number;
}

export class KernelPorts {
  private readonly live = new Map<number, number>(); // port -> pid

  /** A process bound a port. */
  add(port: number, pid: number): void {
    this.live.set(port, pid);
  }

  /** Drop one port; true when it was there and is now gone. */
  forget(port: number): boolean {
    return this.live.delete(port);
  }

  /** Drop every port a process owned (it exited); true when anything went. */
  forgetProcess(pid: number): boolean {
    let changed = false;
    for (const [port, owner] of this.live) {
      if (owner !== pid) continue;
      this.live.delete(port);
      changed = true;
    }
    return changed;
  }

  /** The Ports view's rows, ordered by port. */
  list(): PortListener[] {
    return [...this.live]
      .map(([port, pid]) => ({ port, pid }))
      .sort((a, b) => a.port - b.port);
  }
}
