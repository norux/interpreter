import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const stages = ['core', 'video', 'chrome', 'safari', 'iphone'];
const fixturePlan = `${stages.map((stage) => `## Stage ${stage}\n\n- [ ] ${stage} acceptance\n`).join('\n')}\n## Progress log\n`;

function fixture(t, completed = []) {
  const root = mkdtempSync(join(tmpdir(), 'interpreter-ralph-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(new URL('../scripts/ralph-loop.mjs', import.meta.url), join(root, 'scripts/ralph-loop.mjs'));
  let plan = fixturePlan;
  for (const stage of completed) plan = plan.replace(`- [ ] ${stage}`, `- [x] ${stage}`);
  writeFileSync(join(root, 'RALPH_PLAN.md'), plan);
  writeFileSync(join(root, 'README.md'), 'Before\n<!-- ralph-plan:begin -->\n[Plan](RALPH_PLAN.md)\n<!-- ralph-plan:end -->\nAfter\n');
  writeFileSync(join(root, '.gitignore'), '.ralph/\nbin/\n');
  const reports = join(root, 'docs/verification/media-framework');
  mkdirSync(reports, { recursive: true });
  for (const stage of stages) writeFileSync(join(reports, `${stage}.md`), 'Test fixture report, not actual framework acceptance.\n');
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-b', 'test-ralph');
  git('config', 'user.name', 'Ralph runner test');
  git('config', 'user.email', 'ralph-runner@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'test: initialize runner fixture');
  const fakeCodex = `#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
const prompt = fs.readFileSync(0, 'utf8');
const stage = prompt.match(/Ralph stage ([a-z]+),/)[1];
fs.mkdirSync('.ralph', {recursive:true});
fs.appendFileSync('.ralph/codex-calls', 'call\\n');
fs.appendFileSync('.ralph/stage-calls', stage + '\\n');
const action = stage === process.env.RALPH_TEST_STOP_STAGE ? process.env.RALPH_TEST_STOP_ACTION : process.env.RALPH_TEST_ACTION;
if (action === 'exit') process.exit(7);
let plan = fs.readFileSync('RALPH_PLAN.md', 'utf8');
if (action === 'complete' || action === 'partial' || action === 'false-complete' || action === 'blocked') {
  if (action === 'complete') plan = plan.replace('- [ ] ' + stage, '- [x] ' + stage);
  plan += '\\nfixture progress\\n';
  fs.writeFileSync('RALPH_PLAN.md', plan);
  cp.execFileSync('git', ['add', 'RALPH_PLAN.md']);
  cp.execFileSync('git', ['commit', '-m', 'test: record fixture progress']);
}
if (action === 'other-stage') {
  fs.writeFileSync('RALPH_PLAN.md', plan.replace('- [ ] video', '- [x] video'));
  cp.execFileSync('git', ['add', 'RALPH_PLAN.md']);
  cp.execFileSync('git', ['commit', '-m', 'test: change unselected stage']);
}
if (action === 'dirty') fs.writeFileSync('uncommitted.txt', 'fixture');
if (action === 'runner') fs.appendFileSync('scripts/ralph-loop.mjs', '\\n// fixture change\\n');
const marker = action === 'complete' || action === 'false-complete' ? '<promise>RALPH_STAGE_COMPLETE</promise>' : action === 'blocked' ? '<promise>RALPH_BLOCKED</promise>' : 'fixture iteration unfinished';
fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message') + 1], marker + '\\n');
`;
  const fakeNpm = `#!/usr/bin/env node
const fs = require('node:fs');
fs.mkdirSync('.ralph', {recursive:true});
const script = process.argv[3];
fs.appendFileSync('.ralph/npm-calls', script + '\\n');
console.log('Runner test fixture command: ' + script);
if (script === process.env.RALPH_TEST_FAIL_SCRIPT) process.exit(1);
`;
  for (const [name, source] of [['codex', fakeCodex], ['npm', fakeNpm]]) {
    const path = join(root, 'bin', name);
    writeFileSync(path, source);
    chmodSync(path, 0o755);
  }
  return {
    root, git,
    run(args = ['core', '5'], env = {}) {
      return spawnSync(process.execPath, ['scripts/ralph-loop.mjs', ...args], {
        cwd: root, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, ...env },
      });
    },
    calls(name) {
      const path = join(root, '.ralph', `${name}-calls`);
      return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n') : [];
    },
  };
}

test('dry-run prints the selected prompt without invoking tools or writing state', (t) => {
  const f = fixture(t);
  const result = f.run(['core', '5', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /stage core, iteration 1\/5/);
  assert.equal(existsSync(join(f.root, '.ralph')), false);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('all dry-run previews every stage in order without tools or state', (t) => {
  const f = fixture(t);
  const result = f.run(['all', '5', '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual([...result.stdout.matchAll(/Ralph stage ([a-z]+), iteration 1\/5/g)].map((match) => match[1]), stages);
  assert.equal(existsSync(join(f.root, '.ralph')), false);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('all runs stages in order with a separate iteration budget and final cleanup', (t) => {
  const f = fixture(t);
  const result = f.run(['all', '1'], { RALPH_TEST_ACTION: 'complete' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls('stage'), stages);
  assert.equal(f.calls('npm').filter((script) => script === 'verify').length, 5);
  assert.equal(existsSync(join(f.root, 'RALPH_PLAN.md')), false);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('all stops at a blocked, failed, unfinished or unverified stage', (t) => {
  for (const [action, failScript, expected] of [
    ['blocked', undefined, /Stage video blocked/],
    ['exit', undefined, /Codex exited 7/],
    ['partial', undefined, /Reached 1 iterations for video/],
    ['complete', 'test:framework:video', /Acceptance failed/],
  ]) {
    const f = fixture(t);
    const result = f.run(['all', '1'], {
      RALPH_TEST_ACTION: 'complete', RALPH_TEST_STOP_STAGE: 'video', RALPH_TEST_STOP_ACTION: action,
      ...(failScript ? { RALPH_TEST_FAIL_SCRIPT: failScript } : {}),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
    assert.deepEqual(f.calls('stage'), ['core', 'video']);
    assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
    assert.match(readFileSync(join(f.root, 'RALPH_PLAN.md'), 'utf8'), /\[ \] chrome/);
  }
});

test('all rechecks completed stages and resumes at the first unfinished stage', (t) => {
  const f = fixture(t, ['core', 'video']);
  const result = f.run(['all', '1'], { RALPH_TEST_ACTION: 'complete' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls('stage'), ['chrome', 'safari', 'iphone']);
  assert.deepEqual(f.calls('npm').slice(0, 6), [
    'verify', 'test:framework:core', 'test:captions-correction-browser', 'test:transcript-browser',
    'verify', 'test:framework:video',
  ]);
  assert.equal(existsSync(join(f.root, 'RALPH_PLAN.md')), false);
});

test('all cannot skip failing acceptance of an already-completed stage', (t) => {
  const f = fixture(t, ['core']);
  const result = f.run(['all', '1'], { RALPH_TEST_ACTION: 'complete', RALPH_TEST_FAIL_SCRIPT: 'test:framework:core' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Acceptance failed: npm run test:framework:core/);
  assert.deepEqual(f.calls('codex'), []);
  assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
});

test('arguments, unfinished prerequisites and main branch stop before Codex', (t) => {
  const f = fixture(t);
  for (const args of [['core', '0'], ['missing', '5'], ['core', '5', '--bad'], ['video', '5']]) {
    assert.notEqual(f.run(args).status, 0);
  }
  f.git('branch', '-m', 'main');
  assert.match(f.run().stderr, /feature branch/);
  assert.deepEqual(f.calls('codex'), []);
});

test('dirty user files prevent a real run and remain intact', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, 'user.txt'), 'keep me');
  assert.match(f.run().stderr, /Review and commit/);
  assert.equal(readFileSync(join(f.root, 'user.txt'), 'utf8'), 'keep me');
  assert.deepEqual(f.calls('codex'), []);
});

test('partial progress respects the iteration limit and preserves the plan', (t) => {
  const f = fixture(t);
  const result = f.run(['core', '1'], { RALPH_TEST_ACTION: 'partial' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Reached 1 iterations/);
  assert.equal(f.calls('codex').length, 1);
  assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
});

test('two iterations without a commit stop before the limit', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.match(result.stderr, /without a progress commit/);
  assert.equal(f.calls('codex').length, 2);
});

test('blocked marker and CLI failure preserve the plan', (t) => {
  for (const action of ['blocked', 'exit']) {
    const f = fixture(t);
    const result = f.run(undefined, { RALPH_TEST_ACTION: action });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, action === 'blocked' ? /blocked/ : /Codex exited 7/);
    assert.equal(f.calls('codex').length, 1);
    assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
  }
});

test('false completion is rejected twice without accepting unchecked work', (t) => {
  const f = fixture(t);
  const result = f.run(undefined, { RALPH_TEST_ACTION: 'false-complete' });
  assert.match(result.stderr, /Completion verification failed twice/);
  assert.equal(f.calls('codex').length, 2);
  assert.deepEqual(f.calls('npm'), []);
  assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
});

test('completed core reruns all gates and keeps future stages and user metadata', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, '.DS_Store'), 'user metadata');
  const result = f.run(undefined, { RALPH_TEST_ACTION: 'complete' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.calls('npm'), ['verify', 'test:framework:core', 'test:captions-correction-browser', 'test:transcript-browser']);
  const plan = readFileSync(join(f.root, 'RALPH_PLAN.md'), 'utf8');
  assert.match(plan, /\[x\] core/);
  assert.match(plan, /\[ \] video/);
  assert.equal(readFileSync(join(f.root, '.DS_Store'), 'utf8'), 'user metadata');
});

test('completed checkbox cannot bypass a failing independent acceptance command', (t) => {
  const f = fixture(t);
  const result = f.run(undefined, { RALPH_TEST_ACTION: 'complete', RALPH_TEST_FAIL_SCRIPT: 'test:framework:core' });
  assert.match(result.stderr, /Completion verification failed twice/);
  assert.equal(f.calls('codex').length, 2);
  assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
});

test('missing report blocks already-completed stage verification', (t) => {
  const f = fixture(t, ['core']);
  f.git('rm', 'docs/verification/media-framework/core.md');
  f.git('commit', '-m', 'test: remove fixture report');
  assert.match(f.run().stderr, /report is missing/);
  assert.deepEqual(f.calls('codex'), []);
});

test('unselected stage changes, runner changes and uncommitted work stop the run', (t) => {
  for (const action of ['other-stage', 'runner', 'dirty']) {
    const f = fixture(t);
    const result = f.run(undefined, { RALPH_TEST_ACTION: action });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, action === 'other-stage' ? /Unselected Stage video changed/ : action === 'runner' ? /Runner changed/ : /Review and commit/);
    assert.equal(f.calls('codex').length, 1);
  }
});

test('all-stage completion rechecks earlier gates then deletes and commits only owned plan/README cleanup', (t) => {
  const f = fixture(t, stages.slice(0, -1));
  const result = f.run(['iphone', '5'], { RALPH_TEST_ACTION: 'complete' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(f.root, 'RALPH_PLAN.md')), false);
  assert.equal(readFileSync(join(f.root, 'README.md'), 'utf8'), 'Before\nAfter\n');
  for (const stage of stages) assert.ok(f.calls('npm').includes(`test:framework:${stage}`));
  assert.equal(f.calls('npm').filter((script) => script === 'verify').length, 1);
  assert.equal(f.git('log', '-1', '--format=%s'), 'chore: remove completed framework Ralph plan');
  assert.equal(f.git('status', '--porcelain'), '');
  assert.ok(existsSync(join(f.root, 'scripts/ralph-loop.mjs')));
});

test('failure in an earlier stage prevents final deletion even when iphone gate passes', (t) => {
  const f = fixture(t, stages.slice(0, -1));
  const result = f.run(['iphone', '5'], { RALPH_TEST_ACTION: 'complete', RALPH_TEST_FAIL_SCRIPT: 'test:framework:video' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Final cleanup rejected/);
  assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
  assert.match(readFileSync(join(f.root, 'README.md'), 'utf8'), /ralph-plan:begin/);
});

test('cleanup commit failure restores the completed plan and original README', (t) => {
  const f = fixture(t, stages.slice(0, -1));
  const hook = join(f.root, '.git/hooks/pre-commit');
  writeFileSync(hook, `#!/usr/bin/env node
const cp = require('node:child_process');
const deleted = cp.execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=D'], {encoding:'utf8'});
if (deleted.split('\\n').includes('RALPH_PLAN.md')) process.exit(1);
`);
  chmodSync(hook, 0o755);
  const result = f.run(['iphone', '5'], { RALPH_TEST_ACTION: 'complete' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot commit plan cleanup/);
  assert.ok(existsSync(join(f.root, 'RALPH_PLAN.md')));
  assert.match(readFileSync(join(f.root, 'README.md'), 'utf8'), /ralph-plan:begin/);
  assert.equal(f.git('status', '--porcelain'), '');
});
