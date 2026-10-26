import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { GenerationReport } from '../src/generate.js';

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const fixture = await readFile(new URL('./fixtures/source.ics', import.meta.url), 'utf8');

test('CLI exits nonzero on partial failure, prints only successful URLs, writes a fresh report and preserves files', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'tuloshuuto-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const mock = join(cwd, 'fetch.mjs');
  await writeFile(mock, `globalThis.fetch = async url => new Response(String(url).endsWith('/bad') ? '' : ${JSON.stringify(fixture)});`);
  await writeFile(join(cwd, 'teams.json'), JSON.stringify({ pagesBaseUrl: 'https://example.org/cal/', teams: [
    { id: 'm50', prefix: 'M50', url: 'https://example.org/bad' },
    { id: 'm45', prefix: 'M45', url: 'https://example.org/good' },
  ] }));
  await mkdir(join(cwd, 'docs'));
  await writeFile(join(cwd, 'docs/m50.ics'), 'previous');
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), '--import', mock, entry, ...args], { cwd, encoding: 'utf8' });
  const first = run(['--report', '.reports/result.json']);
  assert.equal(first.status, 1, first.stderr);
  assert.match(first.stdout, /^https:\/\/example.org\/cal\/m45.ics$/m);
  assert.doesNotMatch(first.stdout, /https:\/\/example.org\/cal\/m50.ics/);
  assert.match(first.stderr, /m50: FAILED/);
  const report = JSON.parse(await readFile(join(cwd, '.reports/result.json'), 'utf8')) as GenerationReport;
  assert.deepEqual(report.teams.map(team => team.status), ['failed', 'success']);
  assert.equal(await readFile(join(cwd, 'docs/m50.ics'), 'utf8'), 'previous');
  const second = run(['--team', 'm45', '--report', '.reports/result.json']);
  assert.equal(second.status, 0, second.stderr);
  const next = JSON.parse(await readFile(join(cwd, '.reports/result.json'), 'utf8')) as GenerationReport;
  assert.notEqual(next.runId, report.runId);
  assert.equal(next.teams.length, 1);
  assert.equal(next.teams[0]!.changed, false);
});

test('CLI configuration/argument errors produce failure reports without exposing source data', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'tuloshuuto-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  for (const args of [[], ['--unknown'], ['--team'], ['--report', 'docs/private.json'], ['--report', 'docs/..private.json']]) {
    const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), entry, ...args], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(join(cwd, '.reports/generation.json'), 'utf8')) as GenerationReport;
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.teams, []);
    assert.ok(report.error);
  }
});

test('CLI returns failure when the report cannot be saved', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'tuloshuuto-cli-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, '.reports'), 'blocking file');
  const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), entry], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot write generation report/);
});
