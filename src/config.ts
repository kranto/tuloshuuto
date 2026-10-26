import { readFile } from 'node:fs/promises';
import { SafeError } from './errors.js';

export interface Team { id: string; prefix: string; url: string }
export interface Config { pagesBaseUrl: string; teams: Team[] }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function httpsUrl(value: unknown, base = false): value is string {
  if (typeof value !== 'string' || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !value.includes('#') && (!base || !value.includes('?'));
  } catch { return false; }
}

export function validateConfig(value: unknown): Config {
  if (!record(value) || !httpsUrl(value.pagesBaseUrl, true) ||
      !Array.isArray(value.teams) || value.teams.length === 0) {
    throw new SafeError('Invalid configuration: HTTPS pagesBaseUrl and a nonempty teams list are required.');
  }
  const ids = new Set<string>();
  const teams: Team[] = value.teams.map((team: unknown, index: number) => {
    if (!record(team) || typeof team.id !== 'string' || !/^[a-z0-9_-]+$/.test(team.id) ||
        ids.has(team.id) || typeof team.prefix !== 'string' || !team.prefix.trim() ||
        /[\r\n\x00-\x1f\x7f]/.test(team.prefix) || !httpsUrl(team.url)) {
      throw new SafeError(`Invalid configuration at team ${index + 1}: require a unique lowercase ID, nonempty prefix, and HTTPS URL.`);
    }
    ids.add(team.id);
    return { id: team.id, prefix: team.prefix, url: team.url };
  });
  return { pagesBaseUrl: value.pagesBaseUrl, teams };
}

export async function loadConfig(path: string): Promise<Config> {
  let data: unknown;
  try { data = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new SafeError('Cannot read configuration JSON.'); }
  return validateConfig(data);
}

export function publicUrl(base: string, id: string): string {
  return new URL(`${base.replace(/\/+$/, '')}/${id}.ics`).href;
}
