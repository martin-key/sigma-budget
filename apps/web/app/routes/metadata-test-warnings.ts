import { afterEach, beforeEach, vi } from 'vitest';

/** Metadata render tests must reject missing and colliding React keys. */
export function rejectReactKeyWarnings() {
  const restorers: (() => void)[] = [];
  beforeEach(() => {
    for (const method of ['error', 'warn'] as const) {
      const original = console[method].bind(console);
      const spy = vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        const message = args.map(String).join(' ');
        if (/unique ["']?key|same key/i.test(message)) throw new Error(message);
        original(...args);
      });
      restorers.push(() => spy.mockRestore());
    }
  });
  afterEach(() => {
    while (restorers.length) restorers.pop()!();
  });
}
