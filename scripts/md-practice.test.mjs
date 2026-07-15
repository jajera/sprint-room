/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  RULE_IDS,
  DEFAULT_CONFIG,
  mergeConfig,
  normalizeRuleConfig,
  parseConfigText,
  filterByConfig,
  applyFixes,
  collectViolations,
  summarize,
  inferFencedLanguage,
} from './md-practice.mjs';

function onlyRules(enabled) {
  const rules = {};
  for (const id of RULE_IDS) {
    rules[id] = enabled[id] ?? { severity: 'off', fix: false };
  }
  return mergeConfig({ rules });
}

function ruleIds(lines, config) {
  return collectViolations(lines, 't.md', config).map((v) => v.ruleId);
}

describe('config merge and validation', () => {
  it('uses defaults for empty user config', () => {
    const cfg = mergeConfig({});
    expect(cfg.mode).toBe(DEFAULT_CONFIG.mode);
    expect(cfg.files).toBe('staged');
    expect(cfg.rules['trailing-whitespace'].severity).toBe('error');
  });

  it('merges JSON and YAML payloads', () => {
    const json = parseConfigText('x.json', '{"mode":"check","failFast":true}');
    expect(mergeConfig(json).mode).toBe('check');
    expect(mergeConfig(json).failFast).toBe(true);

    const yaml = parseConfigText(
      'x.yml',
      'mode: fix\nrules:\n  line-length:\n    severity: off\n',
    );
    expect(mergeConfig(yaml).rules['line-length'].severity).toBe('off');
  });

  it('honors severity off and custom options', () => {
    const cfg = mergeConfig({
      rules: {
        'line-length': { severity: 'off' },
        'list-marker-style': { options: { style: '*' } },
        'consecutive-blank-lines': { options: { max: 2 } },
      },
    });
    expect(cfg.rules['line-length'].severity).toBe('off');
    expect(cfg.rules['list-marker-style'].options.style).toBe('*');
    expect(cfg.rules['consecutive-blank-lines'].options.max).toBe(2);
  });

  it('rejects invalid severity / mode', () => {
    expect(() => normalizeRuleConfig('trailing-whitespace', { severity: 'nope' })).toThrow(
      /invalid severity/,
    );
    expect(() => mergeConfig({ mode: 'warp' })).toThrow(/mode must be/);
  });
});

describe('file selection', () => {
  const root = '/repo';
  const cfg = mergeConfig({
    include: ['**/*.md', 'docs/**/*.markdown'],
    exclude: ['**/node_modules/**', '**/CHANGELOG.md'],
  });

  it('keeps markdown that matches include', () => {
    const paths = [
      path.join(root, 'README.md'),
      path.join(root, 'docs', 'a.markdown'),
      path.join(root, 'src', 'x.ts'),
    ];
    const picked = filterByConfig(paths, root, cfg).map((p) => path.relative(root, p));
    expect(picked.sort()).toEqual(['README.md', path.join('docs', 'a.markdown')].sort());
  });

  it('exclude wins over include', () => {
    const paths = [
      path.join(root, 'CHANGELOG.md'),
      path.join(root, 'node_modules', 'pkg', 'README.md'),
      path.join(root, 'ok.md'),
    ];
    const picked = filterByConfig(paths, root, cfg).map((p) => path.relative(root, p));
    expect(picked).toEqual(['ok.md']);
  });

  it('never returns non-markdown paths', () => {
    const paths = [path.join(root, 'foo.txt'), path.join(root, 'bar.md.bak')];
    expect(filterByConfig(paths, root, cfg)).toEqual([]);
  });
});

describe('built-in rules', () => {
  it('trailing-whitespace detects and fixes', () => {
    const cfg = onlyRules({
      'trailing-whitespace': { severity: 'error', fix: true },
    });
    const dirty = ['hello  ', 'world\t'];
    expect(ruleIds(dirty, cfg)).toContain('trailing-whitespace');
    const fixed = applyFixes(dirty, cfg);
    expect(fixed).toEqual(['hello', 'world']);
    expect(ruleIds(fixed, cfg)).not.toContain('trailing-whitespace');
  });

  it('consecutive-blank-lines respects max', () => {
    const cfg = onlyRules({
      'consecutive-blank-lines': { severity: 'error', fix: true, options: { max: 1 } },
    });
    const dirty = ['a', '', '', '', 'b'];
    expect(ruleIds(dirty, cfg)).toContain('consecutive-blank-lines');
    const fixed = applyFixes(dirty, cfg);
    expect(fixed).toEqual(['a', '', 'b']);
  });

  it('blanks-around-headings and fences', () => {
    const cfg = onlyRules({
      'blanks-around-headings': { severity: 'error', fix: true },
      'blanks-around-fences': { severity: 'error', fix: true },
    });
    const dirty = ['intro', '## H', 'next', '```js', 'x', '```', 'after'];
    expect(ruleIds(dirty, cfg).length).toBeGreaterThan(0);
    const fixed = applyFixes(dirty, cfg);
    expect(ruleIds(fixed, cfg)).toEqual([]);
  });

  it('heading-increment and single-h1 report only', () => {
    const cfg = onlyRules({
      'heading-increment': { severity: 'error', fix: false },
      'single-h1': { severity: 'warning', fix: false, options: { required: true } },
    });
    const lines = ['# One', '### Skip', '# Two'];
    const ids = ruleIds(lines, cfg);
    expect(ids).toContain('heading-increment');
    expect(ids).toContain('single-h1');
    expect(applyFixes(lines, cfg)).toEqual(lines);
  });

  it('line-length and list-marker-style', () => {
    const cfg = onlyRules({
      'line-length': { severity: 'warning', fix: false, options: { max: 10, ignoreUrls: true } },
      'list-marker-style': { severity: 'error', fix: true, options: { style: '-' } },
    });
    const dirty = ['01234567890', '* item', 'see https://example.com/very/long/url/path'];
    const v = collectViolations(dirty, 't.md', cfg);
    expect(v.some((x) => x.ruleId === 'line-length')).toBe(true);
    expect(v.some((x) => x.ruleId === 'list-marker-style')).toBe(true);
    expect(v.every((x) => !x.message.includes('https://example.com') || x.ruleId !== 'line-length')).toBe(
      true,
    );
    const fixed = applyFixes(dirty, cfg);
    expect(fixed[1]).toBe('- item');
  });

  it('table-column-style compact fix', () => {
    const cfg = onlyRules({
      'table-column-style': { severity: 'error', fix: true, options: { style: 'compact' } },
    });
    const dirty = ['| a | b |', '|---|---|', '|1|2|'];
    expect(ruleIds(dirty, cfg)).toContain('table-column-style');
    const fixed = applyFixes(dirty, cfg);
    expect(fixed[1]).toBe('| --- | --- |');
    expect(fixed[2]).toBe('| 1 | 2 |');
  });

  it('table-column-count merges extra cells with escaped pipes', () => {
    const cfg = onlyRules({
      'table-column-count': { severity: 'error', fix: true },
      'table-column-style': { severity: 'error', fix: true, options: { style: 'compact' } },
    });
    const broken = [
      '| Rule id | Options |',
      '| --- | --- |',
      '| list-marker-style | `style`: `-` | `*` |',
    ];
    expect(ruleIds(broken, cfg)).toContain('table-column-count');
    const fixed = applyFixes(broken, cfg);
    expect(fixed[2]).toBe('| list-marker-style | `style`: `-` \\| `*` |');
    expect(ruleIds(fixed, cfg)).not.toContain('table-column-count');
  });

  it('no-bare-urls wraps prose URLs only', () => {
    const cfg = onlyRules({
      'no-bare-urls': { severity: 'error', fix: true },
    });
    const dirty = [
      'Open http://localhost:5173',
      'See [ok](https://a.com) and `https://b.com` and <https://c.com>',
    ];
    expect(ruleIds(dirty, cfg)).toContain('no-bare-urls');
    const fixed = applyFixes(dirty, cfg);
    expect(fixed[0]).toBe('Open <http://localhost:5173>');
    expect(fixed[1]).toBe(dirty[1]);
  });

  it('fenced-code-language infers or defaults to plaintext', () => {
    expect(inferFencedLanguage(['npm run dev'])).toBe('bash');
    expect(inferFencedLanguage(['{"a":1}'])).toBe('json');
    expect(inferFencedLanguage(['src/client/   notes'])).toBe('plaintext');

    const cfg = onlyRules({
      'fenced-code-language': {
        severity: 'error',
        fix: true,
        options: { defaultLanguage: 'plaintext' },
      },
    });
    const dirty = ['```', 'src/x/  y', '```'];
    expect(ruleIds(dirty, cfg)).toContain('fenced-code-language');
    const fixed = applyFixes(dirty, cfg);
    expect(fixed[0]).toBe('```plaintext');
    expect(fixed[1]).toBe('src/x/  y');
  });

  it('does not rewrite fenced body when fixing blanks / markers', () => {
    const cfg = onlyRules({
      'blanks-around-fences': { severity: 'error', fix: true },
      'list-marker-style': { severity: 'error', fix: true, options: { style: '-' } },
    });
    const dirty = ['before', '```', '* keep star in fence', '```', '* out'];
    const fixed = applyFixes(dirty, cfg);
    const body = fixed.find((l) => l.includes('keep star'));
    expect(body).toBe('* keep star in fence');
    expect(fixed.some((l) => l === '- out')).toBe(true);
  });

  it('fix pass is idempotent', () => {
    const cfg = mergeConfig({});
    const dirty = [
      '# Title',
      'para  ',
      '',
      '',
      '* item',
      '```',
      'code',
      '```',
      'Open http://example.com',
      '|a|b|',
      '|---|---|',
    ];
    const once = applyFixes(dirty, cfg);
    const twice = applyFixes(once, cfg);
    expect(twice).toEqual(once);
  });
});

describe('reporting', () => {
  it('summarize counts errors and warnings', () => {
    const s = summarize([
      { severity: 'error' },
      { severity: 'warning' },
      { severity: 'warning' },
    ]);
    expect(s).toEqual({ errors: 1, warnings: 2 });
  });
});
