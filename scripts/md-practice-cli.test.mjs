/**
 * @vitest-environment node
 */
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { EXIT_OK, EXIT_TOOL_FAILURE, EXIT_VIOLATIONS } from './md-practice.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'scripts/md-practice.mjs');

const temps = [];

function tempDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'md-practice-cli-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function runEngine(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [ENGINE, ...args], {
      encoding: 'utf8',
      cwd: opts.cwd ?? ROOT,
      env: { ...process.env, ...opts.env },
      input: opts.input,
      timeout: opts.timeout ?? 15000,
    });
    return { code: EXIT_OK, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status ?? (error.killed ? 124 : EXIT_TOOL_FAILURE),
      stdout: error.stdout?.toString?.() ?? '',
      stderr: error.stderr?.toString?.() ?? '',
    };
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function initRepo() {
  const dir = tempDir();
  git(dir, ['init']);
  git(dir, ['config', 'user.email', 'md-practice@test.local']);
  git(dir, ['config', 'user.name', 'md-practice']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(
    path.join(dir, '.md-practice.json'),
    JSON.stringify(
      {
        mode: 'fix',
        files: 'staged',
        rules: {
          'line-length': { severity: 'off' },
          'single-h1': { severity: 'off' },
        },
      },
      null,
      2,
    ),
  );
  mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  writeFileSync(
    path.join(dir, 'hooks', 'pre-commit.sh'),
    `node "${ENGINE}" --hook
status=$?
if [ $status -ne 0 ]; then
  exit $status
fi
`,
  );
  return dir;
}

describe('CLI integration', () => {
  it('check fails on remaining errors', () => {
    const dir = tempDir();
    writeFileSync(path.join(dir, 'bad.md'), '# A\n\n### skip\n');
    writeFileSync(
      path.join(dir, '.md-practice.json'),
      JSON.stringify({
        mode: 'check',
        files: 'all',
        rules: {
          'single-h1': { severity: 'off' },
          'heading-increment': { severity: 'error', fix: false },
        },
      }),
    );
    // Engine discovers git root; copy into real repo path scope via --config + path under ROOT
    // Use temp as isolated: need git root = dir
    git(dir, ['init']);
    const result = runEngine(['--check', '--config', '.md-practice.json', 'bad.md'], { cwd: dir });
    expect(result.code).toBe(EXIT_VIOLATIONS);
    expect(result.stdout).toMatch(/heading-increment/);
  });

  it('fix cleans trailing whitespace and exits 0', () => {
    const dir = initRepo();
    const file = path.join(dir, 'doc.md');
    writeFileSync(file, '# Title\n\nhello  \n');
    const result = runEngine(['--fix', '--config', '.md-practice.json', 'doc.md'], { cwd: dir });
    expect(result.code).toBe(EXIT_OK);
    expect(readFileSync(file, 'utf8')).toBe('# Title\n\nhello\n');
    expect(result.stdout).toMatch(/files fixed:\s*1/);
  });

  it('warnings-only exits 0', () => {
    const dir = initRepo();
    writeFileSync(
      path.join(dir, '.md-practice.json'),
      JSON.stringify({
        mode: 'check',
        files: 'all',
        rules: {
          'trailing-whitespace': { severity: 'off' },
          'consecutive-blank-lines': { severity: 'off' },
          'blanks-around-headings': { severity: 'off' },
          'blanks-around-fences': { severity: 'off' },
          'heading-increment': { severity: 'off' },
          'list-marker-style': { severity: 'off' },
          'table-column-style': { severity: 'off' },
          'no-bare-urls': { severity: 'off' },
          'fenced-code-language': { severity: 'off' },
          'single-h1': { severity: 'warning', fix: false },
          'line-length': { severity: 'warning', fix: false, options: { max: 5 } },
        },
      }),
    );
    writeFileSync(path.join(dir, 'w.md'), '# One\n\n# Two\n\ntoolongline\n');
    const result = runEngine(['--check', 'w.md'], { cwd: dir });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toMatch(/WARNING/);
  });

  it('invalid config exits 2', () => {
    const dir = initRepo();
    writeFileSync(path.join(dir, '.md-practice.json'), '{"mode":"nope"}');
    const result = runEngine(['--check', 'README.md'], { cwd: dir });
    expect(result.code).toBe(EXIT_TOOL_FAILURE);
  });
});

describe('git hook integration', () => {
  it('install is idempotent and managed-block only', () => {
    const dir = initRepo();
    const a = runEngine(['--install-hook'], { cwd: dir });
    expect(a.code).toBe(EXIT_OK);
    const hookPath = path.join(dir, '.git', 'hooks', 'pre-commit');
    const first = readFileSync(hookPath, 'utf8');
    expect(first).toMatch(/md-practice-hook/);
    writeFileSync(hookPath, `${first}\n# keep-me\n`);
    const b = runEngine(['--install-hook'], { cwd: dir });
    expect(b.code).toBe(EXIT_OK);
    const second = readFileSync(hookPath, 'utf8');
    expect(second.match(/>>> md-practice-hook >>>/g)?.length).toBe(1);
    expect(second).toMatch(/keep-me/);
  });

  it('fix mode cleans staged markdown and allows commit', () => {
    const dir = initRepo();
    runEngine(['--install-hook'], { cwd: dir });
    chmodSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 0o755);

    const file = path.join(dir, 'staged.md');
    writeFileSync(file, '# Title\n\nline with spaces  \n');
    git(dir, ['add', 'staged.md', '.md-practice.json']);
    git(dir, ['commit', '-m', 'clean md']);
    expect(readFileSync(file, 'utf8')).toBe('# Title\n\nline with spaces\n');
    const staged = git(dir, ['show', 'HEAD:staged.md']);
    expect(staged).toBe('# Title\n\nline with spaces\n');
  });

  it('blocks commit when non-fixable error remains', () => {
    const dir = initRepo();
    writeFileSync(
      path.join(dir, '.md-practice.json'),
      JSON.stringify({
        mode: 'fix',
        files: 'staged',
        rules: {
          'line-length': { severity: 'off' },
          'single-h1': { severity: 'off' },
          'heading-increment': { severity: 'error', fix: false },
        },
      }),
    );
    runEngine(['--install-hook'], { cwd: dir });
    chmodSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 0o755);

    writeFileSync(path.join(dir, 'bad.md'), '# Title\n\n### skip\n');
    git(dir, ['add', 'bad.md', '.md-practice.json']);
    expect(() => git(dir, ['commit', '-m', 'should fail'])).toThrow();
  });

  it('no staged markdown exits 0 from --hook', () => {
    const dir = initRepo();
    const result = runEngine(['--hook'], { cwd: dir });
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toMatch(/No Markdown files matched/);
  });

  it('--dirty fixes only the most recently saved markdown', async () => {
    const dir = initRepo();
    git(dir, ['add', '.md-practice.json']);
    git(dir, ['commit', '-m', 'init config']);
    const older = path.join(dir, 'older.md');
    const newer = path.join(dir, 'newer.md');
    writeFileSync(older, '# Title\n\nolder  \n');
    const past = new Date(Date.now() - 5_000);
    const { utimesSync } = await import('node:fs');
    utimesSync(older, past, past);
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(newer, '# Title\n\nnewer  \n');
    const result = runEngine(['--fix', '--dirty'], { cwd: dir });
    expect(result.code).toBe(EXIT_OK);
    expect(readFileSync(newer, 'utf8')).toBe('# Title\n\nnewer\n');
    expect(readFileSync(older, 'utf8')).toBe('# Title\n\nolder  \n');
    expect(result.stdout).toMatch(/files fixed:\s*1/);
  });

  it('explicit path fixes only that file', () => {
    const dir = initRepo();
    git(dir, ['add', '.md-practice.json']);
    git(dir, ['commit', '-m', 'init config']);
    const keep = path.join(dir, 'keep.md');
    const target = path.join(dir, 'target.md');
    writeFileSync(keep, '# Title\n\nkeep  \n');
    writeFileSync(target, '# Title\n\ntarget  \n');
    const result = runEngine(['--fix', 'target.md'], { cwd: dir });
    expect(result.code).toBe(EXIT_OK);
    expect(readFileSync(target, 'utf8')).toBe('# Title\n\ntarget\n');
    expect(readFileSync(keep, 'utf8')).toBe('# Title\n\nkeep  \n');
  });

  it('skips unsubstituted {file} and uses --dirty fallback', () => {
    const dir = initRepo();
    git(dir, ['add', '.md-practice.json']);
    git(dir, ['commit', '-m', 'init config']);
    const file = path.join(dir, 'dirty.md');
    writeFileSync(file, '# Title\n\nspaces  \n');
    const result = runEngine(['--fix', '--dirty', '{file}'], { cwd: dir });
    expect(result.code).toBe(EXIT_OK);
    expect(readFileSync(file, 'utf8')).toBe('# Title\n\nspaces\n');
  });

  it('exits quickly when stdin stays open (Kiro Agent Hook)', async () => {
    const dir = initRepo();
    const started = Date.now();
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [ENGINE, '--fix', '--dirty'], {
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Leave stdin open — never write or end (mirrors IDE hook pipes).
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('hung waiting on stdin'));
      }, 3000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        try {
          expect(code).toBe(EXIT_OK);
          expect(Date.now() - started).toBeLessThan(2000);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  });
});
