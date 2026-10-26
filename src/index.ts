import { parseArgs } from 'node:util';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { atomicWrite, emptyReport, generateCalendars } from './generate.js';
import { SafeError, safeMessage } from './errors.js';

function inside(directory: string, path: string): boolean {
  const rel = relative(directory, path);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export async function runCli(args: string[], cwd = process.cwd()): Promise<number> {
  let report = emptyReport();
  let reportPath = resolve(cwd, '.reports/generation.json');
  const docs = resolve(cwd, 'docs');
  try {
    let values;
    try {
      ({ values } = parseArgs({ args: args[0] === '--' ? args.slice(1) : args, options: {
        team: { type: 'string' }, config: { type: 'string', default: 'teams.json' }, report: { type: 'string' },
      }, allowPositionals: false, strict: true }));
    } catch { throw new SafeError('Invalid arguments. Use --team ID, --config PATH, or --report PATH.'); }
    const configPath = resolve(cwd, values.config!);
    if (values.report !== undefined) {
      const candidate = resolve(cwd, values.report);
      if (inside(docs, candidate) || candidate === configPath || !candidate.endsWith('.json')) {
        throw new SafeError('Report must be a .json file outside docs and separate from configuration.');
      }
      reportPath = candidate;
    }
    const config = await loadConfig(configPath);
    report = await generateCalendars(config, { outputDir: docs, teamId: values.team });
  } catch (error) {
    report.error = safeMessage(error);
  }
  try { await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`); }
  catch {
    report.status = 'failed';
    report.error = 'Cannot write generation report.';
  }
  console.log(`Calendar generation ${report.status === 'success' ? 'completed' : 'failed'} (publication is separate).`);
  for (const team of report.teams) {
    if (team.status === 'success') console.log(`${team.id}: ${team.events} events${team.changed ? '' : ' (unchanged)'}`);
    else console.error(`${team.id}: FAILED — ${team.error}`);
  }
  if (report.error) console.error(report.error);
  const successful = report.teams.filter(team => team.status === 'success');
  if (successful.length) {
    console.log('\nSuccessfully generated calendar target URLs (Pages may still serve previous content):');
    for (const team of successful) console.log(team.url);
  }
  return report.status === 'success' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
