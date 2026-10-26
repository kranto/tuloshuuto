import * as fs from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { publicUrl, validateConfig } from './config.js';
import { parseCalendar, transformCalendar } from './transform.js';
import { SafeError, safeMessage } from './errors.js';

export interface TeamResult {
  id: string;
  prefix: string;
  status: 'success' | 'failed';
  events: number | null;
  changed: boolean | null;
  url: string;
  error?: string;
}
export interface GenerationReport {
  schemaVersion: 1;
  runId: string;
  status: 'success' | 'failed';
  teams: TeamResult[];
  error?: string;
}

export function emptyReport(): GenerationReport {
  return { schemaVersion: 1, runId: randomUUID(), status: 'failed', teams: [] };
}

export async function fetchCalendar(url: string, fetcher: typeof fetch = fetch, timeoutMs = 30_000): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetcher(url, { signal, headers: { Accept: 'text/calendar' } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SafeError(`Calendar download failed: HTTP ${response.status}.`);
    }
    // The same signal remains active while the body is consumed.
    const bytes = await response.arrayBuffer();
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new SafeError('Calendar response is not valid UTF-8.'); }
    if (!content.trim()) throw new SafeError('Calendar response is empty.');
    return content;
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError(signal.aborted ? 'Calendar download timed out.' : 'Calendar download failed: network error.');
  }
}

/** Keep the previous file until all validation has completed and rename succeeds. */
export async function atomicWrite(path: string, content: string, io = fs): Promise<boolean> {
  await io.mkdir(dirname(path), { recursive: true });
  try {
    if ((await io.readFile(path)).equals(Buffer.from(content, 'utf8'))) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    await io.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await io.rename(temporary, path);
    return true;
  } finally {
    await io.unlink(temporary).catch(() => {});
  }
}

export async function generateCalendars(config: Config, options: {
  outputDir: string;
  teamId?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): Promise<GenerationReport> {
  config = validateConfig(config);
  const report = emptyReport();
  const teams = options.teamId === undefined ? config.teams : config.teams.filter(team => team.id === options.teamId);
  if (!teams.length) throw new SafeError('Requested team is not configured.');
  for (const team of teams) {
    const result: TeamResult = {
      id: team.id, prefix: team.prefix, status: 'failed', events: null, changed: null,
      url: publicUrl(config.pagesBaseUrl, team.id),
    };
    try {
      const source = await fetchCalendar(team.url, options.fetcher, options.timeoutMs);
      const output = transformCalendar(source, team.prefix);
      const count = parseCalendar(output).getAllSubcomponents('vevent').length;
      let changed: boolean;
      try { changed = await atomicWrite(join(options.outputDir, `${team.id}.ics`), output); }
      catch { throw new SafeError('Calendar file write failed. Previous calendar file was preserved.'); }
      Object.assign(result, { status: 'success', events: count, changed });
    } catch (error) {
      result.error = safeMessage(error);
    }
    report.teams.push(result);
  }
  report.status = report.teams.every(team => team.status === 'success') ? 'success' : 'failed';
  return report;
}
