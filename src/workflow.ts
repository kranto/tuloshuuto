// This file deliberately uses only Node built-ins: summary works even if install/tests fail.
import { readFile, appendFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GenerationReport } from './generate.js';

export async function readReport(path = '.reports/generation.json'): Promise<GenerationReport> {
  const value = JSON.parse(await readFile(path, 'utf8')) as GenerationReport;
  if (value.schemaVersion !== 1 || typeof value.runId !== 'string' || !value.runId ||
      !['success', 'failed'].includes(value.status) || !Array.isArray(value.teams)) throw new Error('Invalid generation report.');
  const ids = new Set<string>();
  for (const team of value.teams) {
    if (typeof team.id !== 'string' || !/^[a-z0-9_-]+$/.test(team.id) || ids.has(team.id) || typeof team.prefix !== 'string' ||
        !['success', 'failed'].includes(team.status) || typeof team.url !== 'string' ||
        !URL.canParse(team.url) || new URL(team.url).protocol !== 'https:' || /[\s<>]/.test(team.url) ||
        (team.status === 'success' && (!Number.isInteger(team.events) || team.events! < 1 || typeof team.changed !== 'boolean')) ||
        (team.status === 'failed' && (team.events !== null || team.changed !== null || typeof team.error !== 'string'))) {
      throw new Error('Invalid team result in generation report.');
    }
    ids.add(team.id);
  }
  if (value.status === 'success' && (!value.teams.length || value.teams.some(team => team.status !== 'success') || value.error)) {
    throw new Error('Inconsistent generation report.');
  }
  return value;
}

export function successfulPaths(report: GenerationReport): string[] {
  return report.teams.filter(team => team.status === 'success' && team.changed).map(team => `docs/${team.id}.ics`);
}

function markdown(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[\\`*_[\]{}()|#!]/g, '\\$&').replace(/[\r\n]/g, ' ');
}

export function renderSummary(report: GenerationReport | undefined, states: {
  generation: string; commit: string; deployment: string;
}): string {
  let text = '# Tuloshuuto – Calendar Generation\n\n' +
    `Generation step: **${markdown(states.generation)}**  \nRepository update: **${markdown(states.commit)}**  \nPages deployment: **${markdown(states.deployment)}**\n\n`;
  if (!report) return text + 'No valid report is available. Generation may not have run; no new calendars can be confirmed.\n';
  text += '| Team | Generation | Events | Calendar target |\n|------|------------|--------|-----------------|\n';
  for (const team of report.teams) {
    text += `| ${markdown(team.prefix)} (${team.id}) | ${team.status === 'success' ? `Success${team.changed ? '' : ' (unchanged)'}` : 'Failed'} | ${team.events ?? '–'} | ${team.status === 'success' ? `[Calendar](<${team.url}>)` : '–'} |\n`;
  }
  if (report.error || report.teams.some(team => team.error)) {
    text += '\n## Errors\n\n';
    if (report.error) text += markdown(report.error) + '\n\n';
    for (const team of report.teams.filter(team => team.status === 'failed')) {
      text += `**${team.id}:** ${markdown(team.error ?? 'Generation failed.')} Previous calendar file was preserved.\n\n`;
    }
  }
  const successful = report.teams.filter(team => team.status === 'success');
  if (successful.length) {
    text += '\n## Copy calendar target URLs\n\n';
    text += states.deployment === 'success'
      ? 'Pages deployment succeeded. Updated content may take a moment to become available.\n\n'
      : '**Publication of these results is not confirmed. These URLs may serve previous content or return 404.**\n\n';
    text += '```text\n' + successful.map(team => team.url).join('\n') + '\n```\n';
  }
  return text;
}

function git(args: string[]): number {
  const result = spawnSync('git', args, { stdio: 'inherit' });
  if (result.error || result.status === null) throw new Error('Cannot run git.');
  return result.status;
}

async function main(command: string | undefined): Promise<void> {
  if (command === 'prepare') {
    const report = await readReport();
    if ((process.env.GENERATION_OUTCOME === 'success') !== (report.status === 'success')) {
      throw new Error('Generation exit status and report disagree.');
    }
    if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is missing.');
    await appendFile(process.env.GITHUB_OUTPUT,
      `any_success=${report.teams.some(team => team.status === 'success')}\nstatus=${report.status}\n`);
  } else if (command === 'commit') {
    const paths = successfulPaths(await readReport());
    if (!paths.length) return;
    if (git(['add', '--', ...paths]) !== 0) throw new Error('Staging calendars failed.');
    const diff = git(['diff', '--cached', '--quiet', '--', ...paths]);
    if (diff === 0) return;
    if (diff !== 1) throw new Error('Checking calendar changes failed.');
    if (git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', 'Update generated calendars', '--', ...paths]) !== 0 ||
        git(['push', 'origin', 'HEAD:main']) !== 0) throw new Error('Saving calendar updates to main failed. No deployment will run.');
  } else if (command === 'summary') {
    let report: GenerationReport | undefined;
    try { report = await readReport(); } catch { /* Show workflow outcomes even without a usable report. */ }
    if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('GITHUB_STEP_SUMMARY is missing.');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, renderSummary(report, {
      generation: process.env.GENERATION_OUTCOME ?? 'not run',
      commit: process.env.COMMIT_OUTCOME ?? 'not run',
      deployment: process.env.DEPLOYMENT_OUTCOME ?? 'not run',
    }));
  } else throw new Error('Expected prepare, commit, or summary command.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch(() => {
    console.error('Workflow reporting or repository update failed. Inspect step logs; no publication success is implied.');
    process.exitCode = 1;
  });
}
