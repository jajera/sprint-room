#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { minimatch } from 'minimatch';
import YAML from 'yaml';

const EXIT_OK = 0;
const EXIT_VIOLATIONS = 1;
const EXIT_TOOL_FAILURE = 2;

const RULE_IDS = [
  'trailing-whitespace',
  'consecutive-blank-lines',
  'blanks-around-headings',
  'blanks-around-fences',
  'heading-increment',
  'single-h1',
  'line-length',
  'list-marker-style',
  'table-column-style',
  'table-column-count',
  'no-bare-urls',
  'fenced-code-language',
];

const DEFAULT_CONFIG = {
  mode: 'fix',
  files: 'staged',
  include: ['**/*.md', '**/*.markdown'],
  exclude: ['**/node_modules/**', '**/.git/**'],
  failFast: false,
  rules: {
    'trailing-whitespace': { severity: 'error', fix: true, options: {} },
    'consecutive-blank-lines': { severity: 'error', fix: true, options: { max: 1 } },
    'blanks-around-headings': { severity: 'error', fix: true, options: {} },
    'blanks-around-fences': { severity: 'error', fix: true, options: {} },
    'heading-increment': { severity: 'error', fix: false, options: {} },
    'single-h1': { severity: 'warning', fix: false, options: { required: true } },
    'line-length': { severity: 'warning', fix: false, options: { max: 120, ignoreUrls: true } },
    'list-marker-style': { severity: 'error', fix: true, options: { style: '-' } },
    // Mirrors markdownlint MD060 "compact": `| cell |` with spaces around pipes
    'table-column-style': { severity: 'error', fix: true, options: { style: 'compact' } },
    // Mirrors markdownlint MD056: rows must match header column count
    'table-column-count': { severity: 'error', fix: true, options: {} },
    // Mirrors markdownlint MD034: wrap bare http(s) URLs in <>
    'no-bare-urls': { severity: 'error', fix: true, options: {} },
    // Mirrors markdownlint MD040: require fence info string; infer or default plaintext
    'fenced-code-language': {
      severity: 'error',
      fix: true,
      options: { defaultLanguage: 'plaintext' },
    },
  },
};

function parseArgs(argv) {
  const out = {
    modeOverride: null,
    configPath: null,
    hook: false,
    onSave: false,
    dirty: false,
    paths: [],
    installHook: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') {
      out.modeOverride = 'check';
      continue;
    }
    if (arg === '--fix') {
      out.modeOverride = 'fix';
      continue;
    }
    if (arg === '--hook') {
      out.hook = true;
      continue;
    }
    if (arg === '--on-save') {
      out.onSave = true;
      continue;
    }
    if (arg === '--dirty') {
      // Agent Hook fallback: only the single most-recently saved dirty Markdown file
      out.dirty = true;
      continue;
    }
    if (arg === '--install-hook') {
      out.installHook = true;
      continue;
    }
    if (arg === '--config') {
      const next = argv[i + 1];
      if (!next) throw new Error('--config requires a path');
      out.configPath = next;
      i++;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(EXIT_OK);
    }
    // Kiro Agent Hooks inject `{file}` for file triggers; skip if unsubstituted
    if (!arg || arg === '{file}' || arg === '${file}') continue;
    out.paths.push(arg);
  }
  return out;
}

function extractPathFromPayload(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const data = JSON.parse(trimmed);
    return (
      data.file ||
      data.filePath ||
      data.path ||
      data.tool_input?.path ||
      data.tool_input?.operations?.[0]?.path ||
      null
    );
  } catch {
    const line = trimmed.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (line && isMarkdownPath(line)) return line;
    return null;
  }
}

function readPathFromEnv() {
  for (const key of ['USER_PROMPT', 'KIRO_HOOK_INPUT', 'HOOK_INPUT']) {
    const raw = process.env[key];
    if (!raw || raw === '{}') continue;
    const found = extractPathFromPayload(raw);
    if (found) return found;
  }
  return null;
}

/**
 * Kiro may leave stdin open with no data. Never wait forever — that times out
 * the Agent Hook (exit -1, "No output was captured").
 */
async function readFilePathFromStdin(timeoutMs = 100) {
  if (process.stdin.isTTY) return null;
  if (process.stdin.readableEnded) {
    return extractPathFromPayload('');
  }

  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.off('end', onEnd);
      process.stdin.off('error', onEnd);
      try {
        process.stdin.pause();
      } catch {
        /* ignore */
      }
      resolve(extractPathFromPayload(Buffer.concat(chunks).toString('utf8')));
    };

    const onData = (chunk) => {
      chunks.push(chunk);
    };
    const onEnd = () => finish();
    const timer = setTimeout(finish, timeoutMs);

    process.stdin.on('data', onData);
    process.stdin.once('end', onEnd);
    process.stdin.once('error', onEnd);
    process.stdin.resume();
  });
}

function printHelp() {
  process.stdout.write(`md-practice

Usage:
  node scripts/md-practice.mjs [--check|--fix] [--config path] [paths...]
  node scripts/md-practice.mjs --hook
  node scripts/md-practice.mjs --on-save [--fix] <file>
  node scripts/md-practice.mjs --dirty [--fix]
  node scripts/md-practice.mjs --install-hook

Notes:
  --on-save strictly targets the saved Markdown file
  --hook uses config mode/files defaults (for git pre-commit)
  --dirty fixes only the most recently saved dirty Markdown file (Kiro fallback)
  exit 0 = no error violations, 1 = error violations remain, 2 = tool/config failure
`);
}

function toPosixRelative(repoRoot, absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function isMarkdownPath(filePath) {
  return /\.md$|\.markdown$/i.test(filePath);
}

function inRepo(filePath, repoRoot) {
  const rel = path.relative(repoRoot, filePath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function getRepoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

function readMaybe(filePath) {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf8');
}

function parseConfigText(filePath, text) {
  if (filePath.endsWith('.json')) return JSON.parse(text);
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return YAML.parse(text);
  throw new Error(`Unsupported config extension: ${filePath}`);
}

function normalizeRuleConfig(ruleId, raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG.rules[ruleId] };
  const base = DEFAULT_CONFIG.rules[ruleId];
  const severity = raw.severity ?? base.severity;
  const fix = raw.fix ?? base.fix;
  const options = { ...(base.options || {}), ...(raw.options || {}) };
  if (!['error', 'warning', 'off'].includes(severity)) {
    throw new Error(`Rule "${ruleId}" has invalid severity "${severity}"`);
  }
  if (typeof fix !== 'boolean') {
    throw new Error(`Rule "${ruleId}" fix must be boolean`);
  }
  return { severity, fix, options };
}

function mergeConfig(userConfig) {
  const cfg = { ...DEFAULT_CONFIG };

  if (!userConfig || typeof userConfig !== 'object') return cfg;
  if (userConfig.mode !== undefined) {
    if (!['check', 'fix'].includes(userConfig.mode)) throw new Error('mode must be check|fix');
    cfg.mode = userConfig.mode;
  }
  if (userConfig.files !== undefined) {
    if (!['staged', 'all'].includes(userConfig.files)) throw new Error('files must be staged|all');
    cfg.files = userConfig.files;
  }
  if (userConfig.include !== undefined) {
    if (!Array.isArray(userConfig.include)) throw new Error('include must be array');
    cfg.include = userConfig.include;
  }
  if (userConfig.exclude !== undefined) {
    if (!Array.isArray(userConfig.exclude)) throw new Error('exclude must be array');
    cfg.exclude = userConfig.exclude;
  }
  if (userConfig.failFast !== undefined) {
    if (typeof userConfig.failFast !== 'boolean') throw new Error('failFast must be boolean');
    cfg.failFast = userConfig.failFast;
  }

  const rules = {};
  for (const ruleId of RULE_IDS) {
    rules[ruleId] = normalizeRuleConfig(ruleId, userConfig.rules?.[ruleId]);
  }
  cfg.rules = rules;
  return cfg;
}

function loadConfig(repoRoot, configPath) {
  const candidates = configPath
    ? [path.isAbsolute(configPath) ? configPath : path.join(repoRoot, configPath)]
    : [
        path.join(repoRoot, '.md-practice.yml'),
        path.join(repoRoot, '.md-practice.yaml'),
        path.join(repoRoot, '.md-practice.json'),
      ];

  for (const candidate of candidates) {
    const text = readMaybe(candidate);
    if (text == null) continue;
    const parsed = parseConfigText(candidate, text);
    const merged = mergeConfig(parsed);
    return { config: merged, source: candidate };
  }
  return { config: mergeConfig({}), source: null };
}

async function walkDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      out.push(...(await walkDir(p)));
    } else if (entry.isFile()) {
      out.push(p);
    }
  }
  return out;
}

function filterByConfig(paths, repoRoot, config) {
  return paths.filter((p) => {
    const rel = toPosixRelative(repoRoot, p);
    if (!isMarkdownPath(rel)) return false;
    const matchInclude = config.include.some((g) => minimatch(rel, g, { dot: true }));
    if (!matchInclude) return false;
    const matchExclude = config.exclude.some((g) => minimatch(rel, g, { dot: true }));
    return !matchExclude;
  });
}

function getStagedFiles(repoRoot) {
  const output = execFileSync(
    'git',
    ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return output
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rel) => path.join(repoRoot, rel));
}

function getRepoMarkdownFiles(repoRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '-co', '--exclude-standard', '--', '*.md', '*.markdown'],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return output
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((rel) => path.join(repoRoot, rel));
}

/** Unstaged + staged + untracked paths from git status -z. */
function getDirtyFiles(repoRoot) {
  // -uall: list every untracked file (default collapses new dirs to `?? docs/`)
  const output = execFileSync('git', ['status', '--porcelain', '-z', '-uall'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const names = [];
  const parts = output.split('\0').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    // XY PATH or XY ORIG -> PATH for renames
    const pathPart = entry.slice(3);
    if (entry[0] === 'R' || entry[0] === 'C') {
      const dest = parts[++i];
      if (dest) names.push(dest);
      continue;
    }
    if (pathPart) names.push(pathPart);
  }
  return [...new Set(names)].map((rel) => path.join(repoRoot, rel));
}

/**
 * Single most-recently modified dirty Markdown file (Agent Hook fallback when
 * `{file}` was not injected). Never returns the whole tree.
 */
async function getMostRecentlyDirtyMarkdown(repoRoot, withinMs = 15_000) {
  const now = Date.now();
  let best = null;
  let bestMtime = -Infinity;
  for (const abs of getDirtyFiles(repoRoot)) {
    if (!isMarkdownPath(abs)) continue;
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) continue;
    if (now - info.mtimeMs > withinMs) continue;
    if (info.mtimeMs > bestMtime) {
      bestMtime = info.mtimeMs;
      best = abs;
    }
  }
  return best ? [best] : [];
}

/**
 * For save hooks when no explicit file path is provided, pick the latest
 * markdown file touched recently from repo-known files (tracked + untracked).
 */
async function getMostRecentlySavedMarkdown(repoRoot, config, withinMs = 20_000) {
  const now = Date.now();
  let best = null;
  let bestMtime = -Infinity;
  const candidates = filterByConfig(getRepoMarkdownFiles(repoRoot), repoRoot, config);
  for (const abs of candidates) {
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) continue;
    if (now - info.mtimeMs > withinMs) continue;
    if (info.mtimeMs > bestMtime) {
      bestMtime = info.mtimeMs;
      best = abs;
    }
  }
  return best ? [best] : [];
}

async function expandPathArgs(repoRoot, paths) {
  const expanded = [];
  for (const given of paths) {
    const abs = path.isAbsolute(given) ? given : path.join(process.cwd(), given);
    if (!inRepo(abs, repoRoot) && abs !== repoRoot) continue;
    const info = await stat(abs).catch(() => null);
    if (!info) continue;
    if (info.isDirectory()) expanded.push(...(await walkDir(abs)));
    else if (info.isFile()) expanded.push(abs);
  }
  return expanded;
}

async function resolveTargetFiles(repoRoot, config, args) {
  if (args.paths.length > 0) {
    const expanded = await expandPathArgs(repoRoot, args.paths);
    if (expanded.length > 0) {
      return filterByConfig(expanded, repoRoot, config);
    }
    // `{file}` may be wrong/unresolved — fall through to --dirty when set
    if (!args.dirty) {
      return [];
    }
  }

  if (args.onSave) {
    return await getMostRecentlySavedMarkdown(repoRoot, config);
  }

  if (args.dirty) {
    return filterByConfig(await getMostRecentlyDirtyMarkdown(repoRoot), repoRoot, config);
  }

  if (args.hook || config.files === 'staged') {
    return filterByConfig(getStagedFiles(repoRoot), repoRoot, config);
  }

  return filterByConfig(await walkDir(repoRoot), repoRoot, config);
}

function splitLinesPreserve(text) {
  const hasTrailingNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (!hasTrailingNewline && lines.length > 0) return { lines, hasTrailingNewline: false };
  if (hasTrailingNewline) lines.pop();
  return { lines, hasTrailingNewline };
}

function joinLines(lines, hasTrailingNewline) {
  const joined = lines.join('\n');
  return hasTrailingNewline ? `${joined}\n` : joined;
}

function fenceMask(lines) {
  const mask = [];
  let inFence = false;
  for (const line of lines) {
    mask.push(inFence);
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
  }
  return mask;
}

/** Parse an opening/closing fence line. Returns null if not a fence. */
function parseFenceLine(line) {
  const m = line.match(/^(\s*)(```+|~~~+)(.*)$/);
  if (!m) return null;
  const indent = m[1];
  const marker = m[2];
  const info = (m[3] || '').trim();
  const lang = info.split(/\s+/)[0] || '';
  return { indent, marker, info, lang };
}

/**
 * Infer a fence language from block body. Heuristics only — falls back to defaultLang.
 */
function inferFencedLanguage(bodyLines, defaultLang = 'plaintext') {
  const nonEmpty = bodyLines.map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
  if (nonEmpty.length === 0) return defaultLang;
  const body = nonEmpty.join('\n').trim();

  if ((body.startsWith('{') || body.startsWith('[')) && (() => {
    try {
      JSON.parse(body);
      return true;
    } catch {
      return false;
    }
  })()) {
    return 'json';
  }

  if (nonEmpty.some((l) => /^(diff --git |@@ |\+\+\+ |--- a\/)/.test(l))) return 'diff';

  if (nonEmpty.some((l) => /^\s*<(!DOCTYPE|html|head|body|div|span|script|style)\b/i.test(l))) {
    return 'html';
  }

  const shellRe =
    /^\s*(#!\/|\$\s|npm |npx |yarn |pnpm |bun |aws |git |export |cd |curl |chmod |mkdir |source |\.\/|node |python3? )/;
  const shellHits = nonEmpty.filter((l) => shellRe.test(l)).length;
  if (
    nonEmpty.some((l) => /^#!/.test(l)) ||
    shellHits >= Math.max(1, Math.ceil(nonEmpty.length * 0.35))
  ) {
    return 'bash';
  }

  const envHits = nonEmpty.filter((l) => /^[A-Z][A-Z0-9_]*=/.test(l.trim())).length;
  if (envHits >= Math.max(1, Math.ceil(nonEmpty.length * 0.5))) return 'bash';

  const yamlHits = nonEmpty.filter(
    (l) => l.trim() === '---' || /^[\w.-]+:(\s|$)/.test(l.trim()) || /^\s*-\s+\S/.test(l),
  ).length;
  if (yamlHits >= Math.max(2, Math.ceil(nonEmpty.length * 0.5))) return 'yaml';

  const tsJsRe = /^\s*(import |export |const |let |var |function |class |interface |type |return |async |await )/;
  const jsHits = nonEmpty.filter((l) => tsJsRe.test(l) || /=>/.test(l)).length;
  if (jsHits >= Math.max(1, Math.ceil(nonEmpty.length * 0.3))) {
    if (nonEmpty.some((l) => /\b(interface|type|as const|:\s*[A-Z]\w*)\b/.test(l))) return 'typescript';
    return 'javascript';
  }

  if (nonEmpty.some((l) => /^\s*[\w.#@-][\w.#@\s,-]*\{/.test(l) || /;\s*$/.test(l.trim()))) {
    const cssHits = nonEmpty.filter((l) => /[{};]|^\s*[@.][\w-]+/.test(l)).length;
    if (cssHits >= Math.ceil(nonEmpty.length * 0.4)) return 'css';
  }

  return defaultLang;
}

/** Open fence indexes lacking a language info string + body for inference. */
function findFencesMissingLanguage(lines) {
  const missing = [];
  let i = 0;
  while (i < lines.length) {
    const open = parseFenceLine(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    // Closing fence while "in fence" — only treat as open when not already inside.
    // We walk linearly: this hit is always an open if we're not inside.
    let j = i + 1;
    while (j < lines.length) {
      const close = parseFenceLine(lines[j]);
      if (close && close.marker[0] === open.marker[0]) break;
      j++;
    }
    if (!open.lang) {
      const body = lines.slice(i + 1, j);
      missing.push({ openIndex: i, closeIndex: j, open, body });
    }
    i = j < lines.length ? j + 1 : j;
  }
  return missing;
}

function pushViolation(violations, filePath, line, ruleId, severity, message) {
  violations.push({ filePath, line, ruleId, severity, message });
}

function checkTrailingWhitespace(lines, filePath, severity, violations) {
  for (let i = 0; i < lines.length; i++) {
    if (/[ \t]+$/.test(lines[i])) {
      pushViolation(violations, filePath, i + 1, 'trailing-whitespace', severity, 'Trailing whitespace');
    }
  }
}

function fixTrailingWhitespace(lines) {
  return lines.map((l) => l.replace(/[ \t]+$/g, ''));
}

function checkConsecutiveBlank(lines, filePath, severity, max, violations) {
  let streak = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') {
      streak++;
      if (streak > max) {
        pushViolation(
          violations,
          filePath,
          i + 1,
          'consecutive-blank-lines',
          severity,
          `More than ${max} consecutive blank lines`,
        );
      }
    } else {
      streak = 0;
    }
  }
}

function fixConsecutiveBlank(lines, max) {
  const out = [];
  let streak = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      streak++;
      if (streak <= max) out.push('');
    } else {
      streak = 0;
      out.push(line);
    }
  }
  return out;
}

function checkBlanksAroundHeadings(lines, filePath, severity, violations) {
  const mask = fenceMask(lines);
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    if (!/^\s{0,3}#{1,6}\s+\S/.test(lines[i])) continue;
    if (i > 0 && lines[i - 1].trim() !== '') {
      pushViolation(violations, filePath, i + 1, 'blanks-around-headings', severity, 'Missing blank line before heading');
    }
    if (i < lines.length - 1 && lines[i + 1].trim() !== '') {
      pushViolation(violations, filePath, i + 1, 'blanks-around-headings', severity, 'Missing blank line after heading');
    }
  }
}

function fixBlanksAroundHeadings(lines) {
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const isHeading = !inFence && /^\s{0,3}#{1,6}\s+\S/.test(line);
    if (isHeading && out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push(line);
    const next = lines[i + 1];
    if (isHeading && next !== undefined && next.trim() !== '') out.push('');
  }
  return out;
}

function checkBlanksAroundFences(lines, filePath, severity, violations) {
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(```|~~~)/.test(lines[i])) continue;
    const isOpening = !inFence;
    if (isOpening) {
      if (i > 0 && lines[i - 1].trim() !== '') {
        pushViolation(
          violations,
          filePath,
          i + 1,
          'blanks-around-fences',
          severity,
          'Missing blank line before fenced block',
        );
      }
    } else {
      if (i < lines.length - 1 && lines[i + 1].trim() !== '') {
        pushViolation(
          violations,
          filePath,
          i + 1,
          'blanks-around-fences',
          severity,
          'Missing blank line after fenced block',
        );
      }
    }
    inFence = !inFence;
  }
}

function fixBlanksAroundFences(lines) {
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFence = /^\s*(```|~~~)/.test(line);
    if (!isFence) {
      out.push(line);
      continue;
    }

    const isOpening = !inFence;
    if (isOpening && out.length > 0 && out[out.length - 1].trim() !== '') out.push('');
    out.push(line);

    const next = lines[i + 1];
    const isClosing = inFence;
    if (isClosing && next !== undefined && next.trim() !== '') out.push('');
    inFence = !inFence;
  }
  return out;
}

function checkHeadingIncrement(lines, filePath, severity, violations) {
  const mask = fenceMask(lines);
  let lastLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const m = lines[i].match(/^\s{0,3}(#{1,6})\s+\S/);
    if (!m) continue;
    const level = m[1].length;
    if (lastLevel > 0 && level > lastLevel + 1) {
      pushViolation(
        violations,
        filePath,
        i + 1,
        'heading-increment',
        severity,
        `Heading level jump from H${lastLevel} to H${level}`,
      );
    }
    lastLevel = level;
  }
}

function checkSingleH1(lines, filePath, severity, required, violations) {
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{0,3}#\s+\S/.test(lines[i])) count++;
  }
  if (!required) return;
  if (count === 0) {
    pushViolation(violations, filePath, null, 'single-h1', severity, 'Missing top-level H1 heading');
  } else if (count > 1) {
    pushViolation(violations, filePath, null, 'single-h1', severity, 'More than one top-level H1 heading');
  }
}

function checkLineLength(lines, filePath, severity, options, violations) {
  const max = Number(options.max || 120);
  const ignoreUrls = Boolean(options.ignoreUrls);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length <= max) continue;
    if (ignoreUrls && /https?:\/\//.test(line)) continue;
    pushViolation(violations, filePath, i + 1, 'line-length', severity, `Line length ${line.length} exceeds ${max}`);
  }
}

function checkListMarkerStyle(lines, filePath, severity, style, violations) {
  const mask = fenceMask(lines);
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    const m = lines[i].match(/^(\s*)([-*])\s+/);
    if (!m) continue;
    if (m[2] !== style) {
      pushViolation(
        violations,
        filePath,
        i + 1,
        'list-marker-style',
        severity,
        `Expected "${style}" list marker`,
      );
    }
  }
}

function fixListMarkerStyle(lines, style) {
  const out = [...lines];
  const mask = fenceMask(lines);
  for (let i = 0; i < out.length; i++) {
    if (mask[i]) continue;
    out[i] = out[i].replace(/^(\s*)[-*](\s+)/, `$1${style}$2`);
  }
  return out;
}

/** GFM table row: starts/ends with | (ignoring outer indentation). */
function isTableRow(line) {
  const t = line.trim();
  return t.startsWith('|') && t.endsWith('|') && t.length >= 2;
}

/** Split table cells; `\|` is a literal pipe, not a column boundary. */
function splitTableCells(line) {
  const trimmed = line.trim();
  if (!isTableRow(trimmed)) return [];
  const inner = trimmed.slice(1, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && inner[i + 1] === '|') {
      cur += '|';
      i++;
      continue;
    }
    if (inner[i] === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += inner[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Escape literal pipes inside a cell for GFM table safety. */
function escapeTableCell(cell) {
  let out = '';
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === '|' && cell[i - 1] !== '\\') out += '\\|';
    else out += cell[i];
  }
  return out;
}

function formatTableRow(indent, cells) {
  const body = cells.map((c) => escapeTableCell(c).trim()).join(' | ');
  return `${indent}| ${body} |`;
}

/** Compact MD060 form: `| cell | cell |` (single spaces around pipe separators). */
function toCompactTableRow(line) {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  if (!isTableRow(line)) return line;
  return formatTableRow(indent, splitTableCells(line));
}

function findTableBlocks(lines) {
  const mask = fenceMask(lines);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (mask[i] || !isTableRow(lines[i])) {
      i++;
      continue;
    }
    const start = i;
    while (i < lines.length && !mask[i] && isTableRow(lines[i])) i++;
    blocks.push({ start, end: i });
  }
  return blocks;
}

function isSeparatorCells(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.trim()) || c.trim() === '');
}

function alignTableCells(cells, expected) {
  if (cells.length === expected) return cells.map((c) => c.trim());
  if (cells.length < expected) {
    return [...cells.map((c) => c.trim()), ...Array(expected - cells.length).fill('')];
  }
  if (isSeparatorCells(cells)) {
    return cells.slice(0, expected).map((c) => c.trim() || '---');
  }
  const head = cells.slice(0, expected - 1).map((c) => c.trim());
  const merged = cells
    .slice(expected - 1)
    .map((c) => c.trim())
    .join(' | ');
  return [...head, merged];
}

function checkTableColumnStyle(lines, filePath, severity, style, violations) {
  if (style !== 'compact') return;
  const mask = fenceMask(lines);
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    if (!isTableRow(lines[i])) continue;
    const fixed = toCompactTableRow(lines[i]);
    if (fixed !== lines[i]) {
      pushViolation(
        violations,
        filePath,
        i + 1,
        'table-column-style',
        severity,
        'Table pipe is missing space for compact style',
      );
    }
  }
}

function fixTableColumnStyle(lines, style) {
  if (style !== 'compact') return lines;
  const out = [...lines];
  const mask = fenceMask(lines);
  for (let i = 0; i < out.length; i++) {
    if (mask[i]) continue;
    if (!isTableRow(out[i])) continue;
    out[i] = toCompactTableRow(out[i]);
  }
  return out;
}

function checkTableColumnCount(lines, filePath, severity, violations) {
  for (const block of findTableBlocks(lines)) {
    const expected = splitTableCells(lines[block.start]).length;
    if (expected === 0) continue;
    for (let i = block.start + 1; i < block.end; i++) {
      const count = splitTableCells(lines[i]).length;
      if (count !== expected) {
        pushViolation(
          violations,
          filePath,
          i + 1,
          'table-column-count',
          severity,
          `Table column count [Expected: ${expected}; Actual: ${count}]`,
        );
      }
    }
  }
}

function fixTableColumnCount(lines) {
  const out = [...lines];
  for (const block of findTableBlocks(out)) {
    const expected = splitTableCells(out[block.start]).length;
    if (expected === 0) continue;
    for (let i = block.start; i < block.end; i++) {
      const indent = out[i].match(/^\s*/)?.[0] ?? '';
      const aligned = alignTableCells(splitTableCells(out[i]), expected);
      out[i] = formatTableRow(indent, aligned);
    }
  }
  return out;
}

/** Split a line into inline-code vs prose segments (keeps fence ticks in code parts). */
function splitInlineCode(line) {
  const parts = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let j = i + 1;
      while (j < line.length && line[j] === '`') j++;
      const ticks = j - i;
      const close = line.indexOf('`'.repeat(ticks), j);
      if (close === -1) {
        parts.push({ code: false, text: line.slice(i) });
        break;
      }
      parts.push({ code: true, text: line.slice(i, close + ticks) });
      i = close + ticks;
    } else {
      let j = i + 1;
      while (j < line.length && line[j] !== '`') j++;
      parts.push({ code: false, text: line.slice(i, j) });
      i = j;
    }
  }
  return parts;
}

function trimUrlMatch(raw) {
  let url = raw;
  while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
  // Trailing ) only when it looks like sentence punctuation, not part of path
  while (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
    url = url.slice(0, -1);
  }
  return url;
}

function isInsideMarkdownLinkDest(text, start) {
  const before = text.slice(0, start);
  const open = before.lastIndexOf('](');
  if (open === -1) return false;
  return !before.slice(open + 2).includes(')');
}

/** Autolink wrap for bare http(s) URLs (MD034). Skips code, <url>, and ](url). */
function wrapBareUrlsInText(text) {
  const re = /https?:\/\/[^\s<>`]+/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const url = trimUrlMatch(m[0]);
    if (!url) continue;
    const start = m.index;
    const end = start + url.length;
    out += text.slice(last, start);
    const already = text[start - 1] === '<' && text[end] === '>';
    const shortcut = text[start - 1] === '[';
    const inDest = isInsideMarkdownLinkDest(text, start);
    out += already || shortcut || inDest ? url : `<${url}>`;
    last = end;
    re.lastIndex = end;
  }
  out += text.slice(last);
  return out;
}

function lineHasBareUrl(line) {
  return splitInlineCode(line).some((part) => {
    if (part.code) return false;
    const wrapped = wrapBareUrlsInText(part.text);
    return wrapped !== part.text;
  });
}

function fixBareUrlsInLine(line) {
  return splitInlineCode(line)
    .map((part) => (part.code ? part.text : wrapBareUrlsInText(part.text)))
    .join('');
}

function checkNoBareUrls(lines, filePath, severity, violations) {
  const mask = fenceMask(lines);
  for (let i = 0; i < lines.length; i++) {
    if (mask[i]) continue;
    if (lineHasBareUrl(lines[i])) {
      pushViolation(violations, filePath, i + 1, 'no-bare-urls', severity, 'Bare URL used');
    }
  }
}

function fixNoBareUrls(lines) {
  const out = [...lines];
  const mask = fenceMask(lines);
  for (let i = 0; i < out.length; i++) {
    if (mask[i]) continue;
    out[i] = fixBareUrlsInLine(out[i]);
  }
  return out;
}

function checkFencedCodeLanguage(lines, filePath, severity, violations) {
  for (const fence of findFencesMissingLanguage(lines)) {
    pushViolation(
      violations,
      filePath,
      fence.openIndex + 1,
      'fenced-code-language',
      severity,
      'Fenced code blocks should have a language specified',
    );
  }
}

function fixFencedCodeLanguage(lines, defaultLanguage = 'plaintext') {
  const out = [...lines];
  for (const fence of findFencesMissingLanguage(out)) {
    const lang = inferFencedLanguage(fence.body, defaultLanguage);
    const { indent, marker } = fence.open;
    out[fence.openIndex] = `${indent}${marker}${lang}`;
  }
  return out;
}

function applyFixes(lines, config) {
  let next = [...lines];
  if (config.rules['trailing-whitespace'].fix) {
    next = fixTrailingWhitespace(next);
  }
  if (config.rules['consecutive-blank-lines'].fix) {
    const max = Number(config.rules['consecutive-blank-lines'].options.max || 1);
    next = fixConsecutiveBlank(next, max);
  }
  if (config.rules['blanks-around-headings'].fix) {
    next = fixBlanksAroundHeadings(next);
  }
  if (config.rules['blanks-around-fences'].fix) {
    next = fixBlanksAroundFences(next);
  }
  if (config.rules['list-marker-style'].fix) {
    const style = config.rules['list-marker-style'].options.style === '*' ? '*' : '-';
    next = fixListMarkerStyle(next, style);
  }
  // Column count before compact spacing so merged cells keep literal pipes escaped
  if (config.rules['table-column-count']?.fix) {
    next = fixTableColumnCount(next);
  }
  if (config.rules['table-column-style']?.fix) {
    const style = config.rules['table-column-style'].options?.style || 'compact';
    next = fixTableColumnStyle(next, style);
  }
  if (config.rules['no-bare-urls']?.fix) {
    next = fixNoBareUrls(next);
  }
  if (config.rules['fenced-code-language']?.fix) {
    const defaultLanguage =
      config.rules['fenced-code-language'].options?.defaultLanguage || 'plaintext';
    next = fixFencedCodeLanguage(next, defaultLanguage);
  }
  return next;
}

function collectViolations(lines, filePath, config) {
  const violations = [];
  const rc = config.rules;

  if (rc['trailing-whitespace'].severity !== 'off') {
    checkTrailingWhitespace(lines, filePath, rc['trailing-whitespace'].severity, violations);
  }
  if (rc['consecutive-blank-lines'].severity !== 'off') {
    const max = Number(rc['consecutive-blank-lines'].options.max || 1);
    checkConsecutiveBlank(lines, filePath, rc['consecutive-blank-lines'].severity, max, violations);
  }
  if (rc['blanks-around-headings'].severity !== 'off') {
    checkBlanksAroundHeadings(lines, filePath, rc['blanks-around-headings'].severity, violations);
  }
  if (rc['blanks-around-fences'].severity !== 'off') {
    checkBlanksAroundFences(lines, filePath, rc['blanks-around-fences'].severity, violations);
  }
  if (rc['heading-increment'].severity !== 'off') {
    checkHeadingIncrement(lines, filePath, rc['heading-increment'].severity, violations);
  }
  if (rc['single-h1'].severity !== 'off') {
    checkSingleH1(
      lines,
      filePath,
      rc['single-h1'].severity,
      rc['single-h1'].options.required !== false,
      violations,
    );
  }
  if (rc['line-length'].severity !== 'off') {
    checkLineLength(lines, filePath, rc['line-length'].severity, rc['line-length'].options, violations);
  }
  if (rc['list-marker-style'].severity !== 'off') {
    checkListMarkerStyle(
      lines,
      filePath,
      rc['list-marker-style'].severity,
      rc['list-marker-style'].options.style === '*' ? '*' : '-',
      violations,
    );
  }
  if (rc['table-column-style']?.severity && rc['table-column-style'].severity !== 'off') {
    checkTableColumnStyle(
      lines,
      filePath,
      rc['table-column-style'].severity,
      rc['table-column-style'].options?.style || 'compact',
      violations,
    );
  }
  if (rc['table-column-count']?.severity && rc['table-column-count'].severity !== 'off') {
    checkTableColumnCount(lines, filePath, rc['table-column-count'].severity, violations);
  }
  if (rc['no-bare-urls']?.severity && rc['no-bare-urls'].severity !== 'off') {
    checkNoBareUrls(lines, filePath, rc['no-bare-urls'].severity, violations);
  }
  if (rc['fenced-code-language']?.severity && rc['fenced-code-language'].severity !== 'off') {
    checkFencedCodeLanguage(lines, filePath, rc['fenced-code-language'].severity, violations);
  }

  return violations;
}

function summarize(violations) {
  let errors = 0;
  let warnings = 0;
  for (const v of violations) {
    if (v.severity === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}

function printReport({ violations, fixedFiles, filesChecked }) {
  const { errors, warnings } = summarize(violations);
  process.stdout.write(`md-practice report\n`);
  process.stdout.write(`- files checked: ${filesChecked}\n`);
  process.stdout.write(`- errors: ${errors}\n`);
  process.stdout.write(`- warnings: ${warnings}\n`);
  process.stdout.write(`- files fixed: ${fixedFiles.length}\n`);

  if (fixedFiles.length > 0) {
    process.stdout.write(`\nModified files:\n`);
    for (const file of fixedFiles) {
      process.stdout.write(`  - ${file}\n`);
    }
  }

  if (violations.length > 0) {
    process.stdout.write(`\nViolations:\n`);
    for (const v of violations) {
      const at = v.line == null ? '' : `:${v.line}`;
      process.stdout.write(`  ${v.severity.toUpperCase()} ${v.filePath}${at} [${v.ruleId}] ${v.message}\n`);
    }
  }
}

function installHook(repoRoot) {
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  if (!existsSync(path.join(repoRoot, '.git'))) {
    throw new Error('Not a git repository (.git not found)');
  }
  mkdirSync(hooksDir, { recursive: true });

  const hookPath = path.join(hooksDir, 'pre-commit');
  const start = '# >>> md-practice-hook >>>';
  const end = '# <<< md-practice-hook <<<';
  const templatePath = path.join(repoRoot, 'hooks', 'pre-commit.sh');
  const template =
    readMaybe(templatePath) ||
    `node scripts/md-practice.mjs --hook
status=$?
if [ $status -ne 0 ]; then
  exit $status
fi`;
  const block = `${start}
${template.trim()}
${end}`;

  let existing = '';
  if (existsSync(hookPath)) existing = readFileSync(hookPath, 'utf8');

  let next = existing;
  const startIdx = existing.indexOf(start);
  const endIdx = existing.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    next = `${existing.slice(0, startIdx)}${block}${existing.slice(endIdx + end.length)}`.trim();
  } else if (existing.trim().length === 0) {
    next = `#!/bin/sh\n${block}\n`;
  } else {
    next = `${existing.trimEnd()}\n\n${block}\n`;
  }

  writeFileSync(hookPath, `${next.endsWith('\n') ? next : `${next}\n`}`);
  chmodSync(hookPath, 0o755);
  process.stdout.write(`Installed pre-commit hook: ${hookPath}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let repoRoot;
  try {
    repoRoot = getRepoRoot();
  } catch {
    throw new Error('Git repository not found');
  }

  if (args.installHook) {
    installHook(repoRoot);
    return EXIT_OK;
  }

  if (args.paths.length === 0) {
    const fromEnv = readPathFromEnv();
    if (fromEnv) args.paths.push(fromEnv);
  }
  if (args.paths.length === 0) {
    const fromStdin = await readFilePathFromStdin();
    if (fromStdin) args.paths.push(fromStdin);
  }

  const { config, source } = loadConfig(repoRoot, args.configPath);
  const runMode = args.modeOverride || config.mode;
  const targetFiles = await resolveTargetFiles(repoRoot, config, args);

  if (targetFiles.length === 0) {
    process.stdout.write('No Markdown files matched.\n');
    return EXIT_OK;
  }

  const stagedSet = new Set(getStagedFiles(repoRoot).map((p) => path.resolve(p)));
  const fixedFiles = [];
  const violations = [];

  for (const absPath of targetFiles) {
    const rel = toPosixRelative(repoRoot, absPath);
    try {
      const originalText = await readFile(absPath, 'utf8');
      const { lines, hasTrailingNewline } = splitLinesPreserve(originalText);
      let workingLines = [...lines];

      if (runMode === 'fix') {
        workingLines = applyFixes(workingLines, config);
      }

      const finalViolations = collectViolations(workingLines, rel, config);
      violations.push(...finalViolations);

      if (runMode === 'fix') {
        const nextText = joinLines(workingLines, hasTrailingNewline);
        if (nextText !== originalText) {
          await writeFile(absPath, nextText, 'utf8');
          fixedFiles.push(rel);
          if (args.hook && stagedSet.has(path.resolve(absPath))) {
            execFileSync('git', ['add', '--', rel], { cwd: repoRoot });
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      violations.push({
        filePath: rel,
        line: null,
        ruleId: 'file-read',
        severity: 'error',
        message,
      });
      if (config.failFast) break;
    }
  }

  printReport({
    violations,
    fixedFiles,
    filesChecked: targetFiles.length,
    configSource: source,
  });

  const { errors } = summarize(violations);
  return errors > 0 ? EXIT_VIOLATIONS : EXIT_OK;
}

export {
  EXIT_OK,
  EXIT_VIOLATIONS,
  EXIT_TOOL_FAILURE,
  RULE_IDS,
  DEFAULT_CONFIG,
  mergeConfig,
  normalizeRuleConfig,
  parseConfigText,
  filterByConfig,
  applyFixes,
  collectViolations,
  summarize,
  splitLinesPreserve,
  joinLines,
  inferFencedLanguage,
  fixFencedCodeLanguage,
  installHook,
};

const isDirectRun =
  process.argv[1] != null && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`md-practice failed: ${message}\n`);
      process.exit(EXIT_TOOL_FAILURE);
    });
}
