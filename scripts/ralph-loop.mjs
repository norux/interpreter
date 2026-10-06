import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const planPath = join(root, 'RALPH_PLAN.md');
const stages = ['core', 'video', 'chrome', 'safari', 'iphone'];
const [stage, count = '5', option] = process.argv.slice(2);
const limit = Number(count);
const complete = '<promise>RALPH_STAGE_COMPLETE</promise>';
const blocked = '<promise>RALPH_BLOCKED</promise>';
const runnerPath = fileURLToPath(import.meta.url);
const runnerSource = readFileSync(runnerPath, 'utf8');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} interrupted (${result.signal}); plan preserved.`);
  return result;
}

function git(args) {
  const result = run('git', args, { stdio: 'pipe' });
  if (result.status !== 0) throw new Error(`Git inspection failed: ${result.stderr}`);
  return result.stdout;
}

function requireClean() {
  const changes = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0').filter(Boolean);
  const dirty = changes.filter((item) => !(item.startsWith('?? ') && item.slice(3).split('/').at(-1) === '.DS_Store'));
  if (dirty.length) throw new Error('Review and commit intended changes before running Ralph; user files are preserved.');
}

function section(plan, selected) {
  const headings = [...plan.matchAll(/^## Stage ([a-z]+)\r?$/gm)];
  const index = headings.findIndex((match) => match[1] === selected);
  if (index < 0) throw new Error(`Plan is missing Stage ${selected}.`);
  const end = headings[index + 1]?.index ?? plan.indexOf('\n## Progress log', headings[index].index);
  if (end < 0) throw new Error('Plan is missing its Progress log boundary.');
  const text = plan.slice(headings[index].index, end);
  if (!/^- \[[ x]\] /m.test(text)) throw new Error(`Stage ${selected} has no checklist.`);
  return text;
}

function finished(plan, selected) {
  const text = section(plan, selected);
  return /^- \[x\] /m.test(text) && !/^- \[ \] /m.test(text);
}

function prompt(iteration, verificationLog = '.ralph/media-framework/<run>-verification.txt', selected = stage) {
  return `Work only in ${root}. Read AGENTS.md if present, RALPH_PLAN.md,
docs/architecture/media-framework.md and docs/verification/media-framework/${selected}.md if it exists.
Read ${verificationLog} if it exists for independent runner acceptance failures.
This is the media-framework Ralph stage ${selected}, iteration ${iteration}/${limit}.
Implement the next unfinished item in Stage ${selected} only. Follow the full framework
architecture and preserve the published companion and existing user settings.
Run acceptance checks, record exact passing/failing/unverified evidence in the stage
report and plan progress log, check only actually completed items, and commit the work.
Do not change scripts/ralph-loop.mjs, weaken acceptance, delete the plan, launch other
agents, push, publish, install apps without authorization or advance to another stage.
Preserve unrelated files, active recordings, mounted images and running user apps.
Do not bypass blocked browser access through alternative tools or profile files.
Use only repository changes, ordinary dependency/model caches and explicit local tests.
Never commit credentials, model weights, user audio/transcripts or temporary .ralph state.
Do not confuse mocks, PCM acquisition or model loading with real transcription accuracy.
If a required environment/device/permission is absent, preserve unfinished checkboxes,
record the blocker and resume condition, commit progress and end with exactly:
${blocked}
Stop after the second independent attempt at the same blocker without new evidence.
When all selected-stage checklist items and acceptance checks actually pass, all intended
changes are committed and the worktree is clean, end with exactly:
${complete}
The runner will independently rerun npm run verify and npm run test:framework:${selected}.
The core stage additionally requires the existing correction and transcript browser checks.
Do not claim whole-framework or iPhone completion at an earlier stage. Otherwise end with
a concise account of the next unfinished item and omit both terminal markers.\n`;
}

function verify(logPath, selected = stage) {
  const plan = readFileSync(planPath, 'utf8');
  if (!finished(plan, selected)) return `Stage ${selected} checklist is unfinished.`;
  const report = join(root, 'docs', 'verification', 'media-framework', `${selected}.md`);
  if (!existsSync(report) || !readFileSync(report, 'utf8').trim()) return 'Stage verification report is missing.';
  const commands = [...(selected === stage ? ['verify'] : []), `test:framework:${selected}`];
  if (selected === 'core') commands.push('test:captions-correction-browser', 'test:transcript-browser');
  writeFileSync(logPath, '');
  for (const script of commands) {
    const result = run('npm', ['run', script], { stdio: 'pipe' });
    const output = `npm run ${script}\n${result.stdout ?? ''}${result.stderr ?? ''}\n`;
    writeFileSync(logPath, readFileSync(logPath, 'utf8') + output);
    process.stdout.write(output);
    if (result.status !== 0) return `Acceptance failed: npm run ${script}.`;
  }
  if (run('git', ['diff', '--check']).status !== 0) return 'Whitespace verification failed.';
  requireClean();
  return undefined;
}

function finishStage(logs, runId) {
  if (stage !== 'iphone') {
    console.log(`Stage ${stage} completed. Acceptance passed; plan preserved.`);
    return;
  }
  for (const selected of stages.slice(0, -1)) {
    const failure = verify(join(logs, `${runId}-final-${selected}.txt`), selected);
    if (failure) throw new Error(`Final cleanup rejected: ${failure} Plan preserved.`);
  }
  const readmePath = join(root, 'README.md');
  const readme = readFileSync(readmePath, 'utf8');
  const block = /<!-- ralph-plan:begin -->[\s\S]*?<!-- ralph-plan:end -->\n?/;
  if (!block.test(readme)) throw new Error('Ralph README block is missing; plan preserved for review.');
  writeFileSync(readmePath, readme.replace(block, ''));
  try {
    if (run('git', ['rm', '--', 'RALPH_PLAN.md']).status !== 0) throw new Error('Cannot remove completed plan.');
    if (run('git', ['add', '--', 'README.md']).status !== 0) throw new Error('Cannot stage README cleanup.');
    if (run('git', ['commit', '-m', 'chore: remove completed framework Ralph plan']).status !== 0) throw new Error('Cannot commit plan cleanup.');
  } catch (error) {
    run('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'README.md', 'RALPH_PLAN.md']);
    throw error;
  }
  console.log('All framework stages verified. Plan deleted and cleanup committed. No push performed.');
}

function main() {
  if ((!stages.includes(stage) && stage !== 'all') || !Number.isSafeInteger(limit) || limit < 1
    || process.argv.length > 5 || (option !== undefined && option !== '--dry-run')) {
    throw new Error('Usage: node scripts/ralph-loop.mjs <all|core|video|chrome|safari|iphone> [positive iterations per stage] [--dry-run]');
  }
  if (!existsSync(planPath)) throw new Error('RALPH_PLAN.md is missing.');
  const plan = readFileSync(planPath, 'utf8');
  if (stage === 'all') {
    for (const selected of stages) section(plan, selected);
    if (option === '--dry-run') {
      for (const selected of stages) process.stdout.write(prompt(1, undefined, selected));
      return;
    }
    for (const selected of stages) {
      const result = run(process.execPath, [runnerPath, selected, count]);
      if (result.status !== 0) throw new Error(`All-stage run stopped at ${selected}; review the plan/logs and rerun all to continue.`);
    }
    return;
  }
  section(plan, stage);
  const otherSections = stages.filter((selected) => selected !== stage).map((selected) => [selected, section(plan, selected)]);
  for (const earlier of stages.slice(0, stages.indexOf(stage))) {
    if (!finished(plan, earlier)) throw new Error(`Complete Stage ${earlier} before ${stage}.`);
  }
  if (option === '--dry-run') { process.stdout.write(prompt(1)); return; }
  requireClean();
  const branch = git(['branch', '--show-current']).trim();
  if (!branch || branch === 'main' || branch === 'master') throw new Error('Run Ralph on a feature branch, not main/master or detached HEAD.');
  const logs = join(root, '.ralph', 'media-framework');
  mkdirSync(logs, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  let noProgress = 0;
  let failedVerifications = 0;
  const verificationLog = join(logs, `${runId}-${stage}-verification.txt`);
  if (finished(plan, stage)) {
    const failure = verify(verificationLog);
    if (failure) throw new Error(failure);
    finishStage(logs, runId);
    return;
  }
  for (let iteration = 1; iteration <= limit; iteration++) {
    const before = git(['rev-parse', 'HEAD']).trim();
    const messagePath = join(logs, `${runId}-${stage}-${iteration}.txt`);
    writeFileSync(messagePath, '');
    console.log(`Ralph stage ${stage}, iteration ${iteration}/${limit}`);
    const result = run('codex', [
      '--search', '--ask-for-approval', 'never', '--sandbox', 'danger-full-access',
      '--cd', root, 'exec', '--output-last-message', messagePath, '-',
    ], { input: prompt(iteration, verificationLog), stdio: ['pipe', 'inherit', 'inherit'] });
    if (result.status !== 0) throw new Error(`Codex exited ${result.status}; plan preserved.`);
    if (!existsSync(planPath)) throw new Error('Agent removed the plan; inspect the changes.');
    if (readFileSync(runnerPath, 'utf8') !== runnerSource) throw new Error('Runner changed during iteration; stopped.');
    const updatedPlan = readFileSync(planPath, 'utf8');
    for (const [selected, beforeSection] of otherSections) {
      if (section(updatedPlan, selected) !== beforeSection) throw new Error(`Unselected Stage ${selected} changed; stopped.`);
    }
    if (git(['branch', '--show-current']).trim() !== branch) throw new Error('Branch changed during iteration; stopped.');
    requireClean();
    const last = readFileSync(messagePath, 'utf8').trim().split('\n').at(-1);
    if (last === blocked) throw new Error(`Stage ${stage} blocked; see the plan and ${messagePath}.`);
    noProgress = git(['rev-parse', 'HEAD']).trim() === before ? noProgress + 1 : 0;
    if (last === complete) {
      const failure = verify(verificationLog);
      if (!failure) {
        finishStage(logs, runId);
        return;
      }
      console.error(failure);
      writeFileSync(verificationLog, `${existsSync(verificationLog) ? readFileSync(verificationLog, 'utf8') : ''}\n${failure}\n`);
      failedVerifications++;
      if (failedVerifications >= 2) throw new Error('Completion verification failed twice; stopped with plan preserved.');
    } else failedVerifications = 0;
    if (noProgress >= 2) throw new Error('Two iterations without a progress commit; stopped with plan preserved.');
  }
  throw new Error(`Reached ${limit} iterations for ${stage}; review the plan/logs and rerun the same command to continue.`);
}

try { main(); }
catch (error) { console.error(error.message); process.exitCode = 1; }
