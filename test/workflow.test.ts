import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyReport } from '../src/generate.js';
import { readReport, renderSummary, successfulPaths } from '../src/workflow.js';

const workflow = fileURLToPath(new URL('../src/workflow.ts', import.meta.url));
function partialReport() {
  const report = emptyReport();
  report.teams = [
    { id: 'm50', prefix: 'M50', status: 'failed', events: null, changed: null, url: 'https://example.org/m50.ics', error: 'Source calendar contains zero events.' },
    { id: 'm45', prefix: 'M45', status: 'success', events: 12, changed: true, url: 'https://example.org/m45.ics' },
    { id: '7idv', prefix: '7IDV', status: 'success', events: 2, changed: false, url: 'https://example.org/7idv.ics' },
  ];
  return report;
}

test('summary distinguishes partial generation from publication and lists only successful target URLs', () => {
  const report = partialReport();
  const summary = renderSummary(report, { generation: 'failure', commit: 'success', deployment: 'failure' });
  assert.match(summary, /Generation step: \*\*failure\*\*/);
  assert.match(summary, /Pages deployment: \*\*failure\*\*/);
  assert.match(summary, /\[Calendar\]\(<https:\/\/example.org\/m45.ics>\)/);
  assert.match(summary, /12/);
  assert.match(summary, /Previous calendar file was preserved/);
  assert.match(summary, /may serve previous content/);
  assert.doesNotMatch(summary, /https:\/\/example.org\/m50.ics/);
  assert.deepEqual(successfulPaths(report), ['docs/m45.ics']);
  assert.match(renderSummary(undefined, { generation: 'not run', commit: 'not run', deployment: 'skipped' }), /No valid report/);
  report.teams[1]!.prefix = '<script>|injection';
  assert.doesNotMatch(renderSummary(report, { generation: 'failure', commit: 'success', deployment: 'success' }), /<script>/);
});

test('report preparation preserves generation failure and validates machine-readable schema', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'tuloshuuto-workflow-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, '.reports'));
  const path = join(cwd, '.reports/generation.json');
  await writeFile(path, JSON.stringify(partialReport()));
  const output = join(cwd, 'output');
  const run = (outcome: string) => spawnSync(process.execPath, [workflow, 'prepare'], {
    cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, GENERATION_OUTCOME: outcome },
  });
  assert.equal(run('failure').status, 0);
  assert.equal(await readFile(output, 'utf8'), 'any_success=true\nstatus=failed\n');
  assert.equal(run('success').status, 1);
  for (const bad of ['{}', 'not json', JSON.stringify({ ...partialReport(), status: 'success' })]) {
    await writeFile(path, bad);
    await assert.rejects(readReport(path));
  }
});

test('summary runs with Node alone even when no dependencies or generation report exist', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'tuloshuuto-workflow-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const summary = join(cwd, 'summary.md');
  const result = spawnSync(process.execPath, [workflow, 'summary'], {
    cwd, encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: summary, GENERATION_OUTCOME: 'not run' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(summary, 'utf8'), /No valid report/);
});

test('commit helper pushes only successful changed calendars and never creates empty commits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tuloshuuto-git-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cwd = join(directory, 'checkout');
  const remote = join(directory, 'remote.git');
  await mkdir(cwd);
  const git = (...args: string[]) => {
    const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.org', ...args], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  await mkdir(join(cwd, 'docs'));
  await mkdir(join(cwd, '.reports'));
  await writeFile(join(cwd, 'docs/m50.ics'), 'previous failed team');
  await writeFile(join(cwd, 'docs/m45.ics'), 'previous good team');
  git('add', 'docs');
  git('commit', '-m', 'Initial calendars');
  git('remote', 'add', 'origin', remote);
  git('push', '-u', 'origin', 'main');
  const initial = git('rev-parse', 'HEAD');
  await writeFile(join(cwd, 'docs/m45.ics'), 'new good team');
  await writeFile(join(cwd, 'docs/m50.ics'), 'unrelated change must not be committed');
  await writeFile(join(cwd, 'unrelated.txt'), 'keep local');
  await writeFile(join(cwd, '.reports/generation.json'), JSON.stringify(partialReport()));
  const commit = () => spawnSync(process.execPath, [workflow, 'commit'], { cwd, encoding: 'utf8' });
  const first = commit();
  assert.equal(first.status, 0, first.stderr);
  const updated = git('rev-parse', 'HEAD');
  assert.notEqual(initial, updated);
  assert.equal(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'), 'docs/m45.ics');
  assert.equal(git('rev-parse', 'origin/main'), updated);
  assert.equal(git('show', 'HEAD:docs/m50.ics'), 'previous failed team');
  assert.match(git('status', '--porcelain'), /unrelated.txt/);
  assert.equal(commit().status, 0);
  assert.equal(git('rev-parse', 'HEAD'), updated);
});
