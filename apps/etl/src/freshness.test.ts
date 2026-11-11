import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkFreshness, freshnessCli } from './freshness.js';

describe('freshness', () => {
  it('accepts the deadline and warns the next day', () => {
    expect(checkFreshness('2026-09-30', '2026-11-30')).toEqual({
      overdue: false,
      message: expect.stringContaining('31.10.2026 г., срок 30.11.2026'),
    });
    expect(checkFreshness('2026-09-30', '2026-12-01')).toEqual({
      overdue: true,
      message: expect.stringContaining('срокът беше 30.11.2026'),
    });
  });
  it('counts several overdue reports', () => {
    expect(checkFreshness('2026-09-30', '2027-02-01').message).toContain('Липсват 3 отчета');
  });
  it('handles the year boundary and February deadlines', () => {
    expect(checkFreshness('2026-11-30', '2027-02-01').message).toContain(
      '31.12.2026 г. закъснява: срокът беше 31.01.2027',
    );
    expect(checkFreshness('2026-12-31', '2027-02-28').overdue).toBe(false);
    expect(checkFreshness('2026-12-31', '2027-03-01').message).toContain('28.02.2027');
    expect(checkFreshness('2027-12-31', '2028-02-29').overdue).toBe(false);
    expect(checkFreshness('2027-12-31', '2028-03-01').message).toContain('29.02.2028');
  });
  it('rejects missing and invalid dates', () => {
    for (const value of [undefined, '2026-02-30', '2026-09-29'])
      expect(() => checkFreshness(value, '2026-11-08')).toThrow();
  });
  it('takes today from the Sofia clock, in winter and summer time', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'freshness-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
    const late = async (asOf: string, instant: string) => {
      await writeFile(join(dir, 'execution.json'), JSON.stringify({ latest: { asOf } }));
      vi.setSystemTime(new Date(instant));
      log.mockClear();
      expect(await freshnessCli(['--release', dir])).toBe(0);
      return String(log.mock.calls[0]?.[0]).includes('закъснява');
    };
    try {
      // UTC+2: Sofia reaches 1 December at 22:00 UTC on 30 November
      expect(await late('2026-09-30', '2026-11-30T21:59:59Z')).toBe(false);
      expect(await late('2026-09-30', '2026-11-30T22:00:00Z')).toBe(true);
      // UTC+3: Sofia reaches 1 July at 21:00 UTC on 30 June
      expect(await late('2027-04-30', '2027-06-30T20:59:59Z')).toBe(false);
      expect(await late('2027-04-30', '2027-06-30T21:00:00Z')).toBe(true);
    } finally {
      vi.useRealTimers();
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('handles files and emits Actions warning and summary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'freshness-'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const oldActions = process.env.GITHUB_ACTIONS,
      oldSummary = process.env.GITHUB_STEP_SUMMARY;
    try {
      expect(await freshnessCli(['--release', dir])).toBe(2);
      await writeFile(join(dir, 'execution.json'), JSON.stringify({ latest: {} }));
      expect(await freshnessCli(['--release', dir])).toBe(2);
      await writeFile(
        join(dir, 'execution.json'),
        JSON.stringify({ latest: { asOf: '2026-09-30' } }),
      );
      process.env.GITHUB_ACTIONS = 'true';
      process.env.GITHUB_STEP_SUMMARY = join(dir, 'summary');
      expect(await freshnessCli(['--release', dir, '--today', '2026-12-01'])).toBe(0);
      expect(log.mock.calls.some(([s]) => String(s).startsWith('::warning title='))).toBe(true);
      expect(await readFile(join(dir, 'summary'), 'utf8')).toContain('31.10.2026');
    } finally {
      if (oldActions === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = oldActions;
      if (oldSummary === undefined) delete process.env.GITHUB_STEP_SUMMARY;
      else process.env.GITHUB_STEP_SUMMARY = oldSummary;
      log.mockRestore();
      error.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
