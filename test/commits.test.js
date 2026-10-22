import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanCommits, summarizeCommits, modelsInText } from '../src/commits.js';

const BIN = fileURLToPath(new URL('../bin/model-census.js', import.meta.url));

// [author name, author email, message]
const HISTORY = [
  ['Jane Doe', 'jane@example.com', 'Initial commit\n\nCo-authored-by: Sam Lee <sam@example.com>'],
  ['Jane Doe', 'jane@example.com', 'Fix login redirect\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n\nCo-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>'],
  ['Jane Doe (aider)', 'jane@example.com', 'feat: add retry\n\nCo-authored-by: aider (deepseek/deepseek-chat) <aider@aider.chat>'],
  ['Jane Doe', 'jane@example.com', 'Refactor parser\n\nCo-authored-by: Codex <codex@openai.com>'],
  ['Copilot', '198982749+Copilot@users.noreply.github.com', 'Update README'],
  ['Jane Doe', 'jane@example.com', 'Port tests\n\nAssisted-by: Qwen Code:qwen3-coder-plus'],
  ['Jane Doe', 'jane@example.com', 'Update claude docs\n\nModel: gpt-4 is mentioned here only as text.'],
  ['Jane Doe', 'jane@example.com', 'Tidy imports\n\nCo-authored-by: Cursor Agent <cursoragent@cursor.com>'],
  // A human whose username contains a tool name must not be attributed (seen in a real repo).
  ['Jane Doe', 'jane@example.com', 'Fix typo\n\nCo-authored-by: Adam <123+adamdotdevin@users.noreply.github.com>\nCo-authored-by: Sam Spiers <opencode@samspiers.example>'],
];

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-commits-'));
  const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Committer', '-c', 'user.email=committer@example.com', '-c', 'commit.gpgsign=false', ...args], { stdio: 'pipe' });
  git('init', '-q');
  HISTORY.forEach(([name, email, msg], i) => {
    execFileSync('git', ['-C', dir, '-c', 'user.name=Committer', '-c', 'user.email=committer@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', msg], {
      stdio: 'pipe',
      env: { ...process.env, GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: `2026-10-0${i + 1}T12:00:00Z`, GIT_COMMITTER_DATE: `2026-10-0${i + 1}T12:00:00Z` },
    });
  });
  return dir;
}

test('models named in trailer values', () => {
  const ids = (s) => modelsInText(s).map((m) => [m.id.toLowerCase(), m.origins.join('+')]);
  assert.deepEqual(ids('Claude Opus 4.6 <noreply@anthropic.com>'), [['claude-opus-4.6', 'anthropic']]);
  assert.deepEqual(ids('aider (deepseek/deepseek-chat) <aider@aider.chat>'), [['deepseek/deepseek-chat', 'deepseek']]);
  assert.deepEqual(ids('aider (gemini/gemini-2.5-pro) <aider@aider.chat>'), [['gemini/gemini-2.5-pro', 'google']]);
  assert.deepEqual(ids('Qwen Code:qwen3-coder-plus'), [['qwen3-coder-plus', 'qwen']]);
  assert.deepEqual(ids('GPT-5 Codex <noreply@openai.com>'), [['gpt-5-codex', 'openai']]);
  assert.deepEqual(ids('Sam Lee <sam@example.com>'), []);
});

test('attributes commits by trailer, signature and account', () => {
  const dir = makeRepo();
  try {
    const s = scanCommits(dir);
    assert.equal(s.total, HISTORY.length);
    const bySubject = Object.fromEntries(s.attributed.map((a) => [a.evidence.join(' '), a]));
    const find = (re) => s.attributed.find((a) => a.evidence.some((e) => re.test(e)));
    assert.equal(s.attributed.length, 6, JSON.stringify(Object.keys(bySubject)));

    const claude = find(/Claude Opus/);
    assert.deepEqual(claude.tools, ['Claude Code']);
    assert.deepEqual(claude.origins, ['anthropic']);
    assert.equal(claude.modelStated, true);

    const aider = find(/deepseek-chat/);
    assert.deepEqual(aider.tools, ['aider']);
    assert.deepEqual(aider.origins, ['deepseek']);

    const codex = find(/Codex/);
    assert.deepEqual(codex.origins, ['openai']);
    assert.equal(codex.modelStated, false);

    const copilot = s.attributed.find((a) => a.tools.includes('GitHub Copilot'));
    assert.deepEqual(copilot.origins, [], 'Copilot is multi-vendor: no origin without a named model');

    assert.deepEqual(find(/qwen3/).origins, ['qwen']);
    assert.deepEqual(find(/Cursor/).tools, ['Cursor']);

    const sum = summarizeCommits(s);
    assert.equal(sum.byOrigin.deepseek, 1);
    assert.equal(sum.byOrigin.unknown, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI --commits: deny exit code, json, md, since', () => {
  const dir = makeRepo();
  try {
    const run = (...a) => spawnSync(process.execPath, [BIN, dir, '--commits', ...a], { encoding: 'utf8', env: { PATH: process.env.PATH, NO_COLOR: '1' } });
    const deny = run('--deny', 'deepseek');
    assert.equal(deny.status, 1, deny.stderr);
    assert.match(deny.stdout, /DENIED: 1 commit credit/);
    assert.equal(run('--deny', 'mistral').status, 0);
    const j = JSON.parse(run('--json').stdout);
    assert.equal(j.mode, 'commits');
    assert.equal(j.attributedCount, 6);
    assert.match(run('--md').stdout, /\| Tool \| Model \| Origin/);
    const since = JSON.parse(run('--json', '--since', '2026-10-05T00:00:00Z').stdout);
    assert.equal(since.total, 5);
    const notRepo = spawnSync(process.execPath, [BIN, tmpdir(), '--commits'], { encoding: 'utf8' });
    assert.equal(notRepo.status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
