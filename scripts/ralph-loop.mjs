import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const planPath = join(root, 'RALPH_PLAN.md');
const statePath = join(root, '.ralph');
const maxIterations = Number(process.argv[2] ?? 30);
const completion = '<promise>INTERPRETER_COMPLETE</promise>';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} interrupted: ${result.signal}`);
  return result;
}

function cleanWorktree() {
  const result = run('git', ['status', '--porcelain'], { stdio: 'pipe' });
  if (result.status !== 0) throw new Error('Cannot inspect Git status.');
  return result.stdout.trim() === '';
}

function main() {
  if (!Number.isInteger(maxIterations) || maxIterations < 1 || process.argv.length > 3) {
    throw new Error('Usage: node scripts/ralph-loop.mjs [positive iteration count]');
  }
  if (!existsSync(planPath)) throw new Error('RALPH_PLAN.md is missing; nothing to run.');
  if (!cleanWorktree()) throw new Error('Review and commit current changes before starting the loop.');
  mkdirSync(statePath, { recursive: true });
  const verificationPath = join(statePath, 'verification.txt');
  writeFileSync(verificationPath, 'No completion verification attempted in this run.\n');

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const lastMessagePath = join(statePath, `iteration-${iteration}.txt`);
    const prompt = `Work only in ${root}. Read AGENTS.md if present, RALPH_PLAN.md, and
.ralph/verification.txt. This is Ralph iteration ${iteration}/${maxIterations}.
Choose the next unfinished checklist item, implement it, verify it, record evidence,
update its checkbox only after its acceptance checks pass, and commit that work using
Conventional Commits. Keep progress durable in the plan so a fresh iteration can resume.
Keep the required capture, model, and output abstractions small and feature-local.
Do not expand scope, publish, push, read unrelated credentials, or launch other agents.
Do not modify scripts/ralph-loop.mjs, remove RALPH_PLAN.md, weaken acceptance criteria,
or bypass tests to achieve completion. Fix failed checks instead.
When credentials or interactive browser access are unavailable, follow the plan's
verification rules and record the exact limitation; never invent successful evidence.
If required work cannot proceed without user input or an external change, record the
blocker in the plan, commit progress, and end with <promise>INTERPRETER_BLOCKED</promise>.
The runner can execute commands without sandboxing: stay inside this repository except
for normal dependency/model caches and explicit local app verification.
Commit all intended repository changes before ending the iteration. Never commit secrets,
model weights, audio/transcripts from the user, or temporary .ralph state.
When every checklist item and required acceptance check has passed, the real local
audio-to-caption path and subtitle appearance have been verified, npm run verify passes,
and the worktree is clean, end your final response with this exact line:
${completion}
Otherwise explain the next task or actual blocker without emitting the completion line.
The runner owns deletion and the final cleanup commit after independent checks pass.\n`;

    writeFileSync(lastMessagePath, '');
    console.log(`\nRalph iteration ${iteration}/${maxIterations}`);
    const agent = run('codex', [
      '--search', '--ask-for-approval', 'never', '--sandbox', 'danger-full-access',
      '--cd', root, 'exec', '--output-last-message', lastMessagePath, '-',
    ], { input: prompt, stdio: ['pipe', 'inherit', 'inherit'] });
    if (agent.status !== 0) throw new Error(`Codex exited with ${agent.status}; plan preserved.`);
    if (!existsSync(planPath)) throw new Error('Agent removed the plan prematurely; inspect Git history.');

    const finalLines = readFileSync(lastMessagePath, 'utf8').trim().split('\n');
    if (finalLines.at(-1) === '<promise>INTERPRETER_BLOCKED</promise>') {
      throw new Error('Required work is blocked; plan preserved. See the plan and .ralph output.');
    }
    if (finalLines.at(-1) !== completion) continue;
    const plan = readFileSync(planPath, 'utf8');
    if (!/^- \[x\] /m.test(plan) || /^- \[ \] /m.test(plan)) {
      writeFileSync(verificationPath, 'Completion rejected: the plan checklist is unfinished.\n');
      continue;
    }
    if (!existsSync(join(root, 'docs', 'verification.md'))) {
      writeFileSync(verificationPath, 'Completion rejected: docs/verification.md is missing.\n');
      continue;
    }
    const verification = run('npm', ['run', 'verify'], { stdio: 'pipe' });
    writeFileSync(verificationPath, `${verification.stdout ?? ''}${verification.stderr ?? ''}`);
    process.stdout.write(readFileSync(verificationPath, 'utf8'));
    if (verification.status !== 0) continue;
    const diff = run('git', ['diff', '--check']);
    if (diff.status !== 0 || !cleanWorktree()) {
      writeFileSync(verificationPath, 'Completion rejected: commit intended changes and fix whitespace errors.\n');
      continue;
    }

    if (run('git', ['rm', '--', 'RALPH_PLAN.md']).status !== 0) {
      throw new Error('Could not remove the completed plan.');
    }
    if (run('git', ['commit', '-m', 'chore: remove completed Ralph plan']).status !== 0) {
      run('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', 'RALPH_PLAN.md']);
      throw new Error('Cleanup commit failed; attempted to restore the plan.');
    }
    console.log('Ralph completed. Verification passed; plan deletion committed.');
    return;
  }
  throw new Error(`Reached ${maxIterations} iterations; plan preserved. Review .ralph and rerun to continue.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
