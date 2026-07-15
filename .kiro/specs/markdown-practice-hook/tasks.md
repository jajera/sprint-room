# Implementation Plan: Markdown Practice Hook

## Overview

Build a Node.js CLI and git pre-commit hook that loads project Config, selects Markdown files, runs built-in best-practice Rules, optionally applies Auto_Fixes, prints a Report, and exits with git-friendly codes.

**Implementation note:** Delivered as `scripts/md-practice.mjs` (ESM, importable for tests) inside the Sprint Room repo, rather than a separate TypeScript package with `bin/` — behavior matches the design; layout is repo-local for simplicity.

## Tasks

- [x] 1. Scaffold package and shared types
  - [x] 1.1 Initialize runnable package entry
    - `package.json` scripts: `md-practice`, `md-practice:check`, `md-practice:fix`, `md-practice:install-hook`
    - Dependencies: `yaml`, `minimatch` (Zod available in repo; config validated in-engine)
    - Layout: `scripts/md-practice.mjs`, `scripts/md-practice-install-hook.mjs`, `hooks/pre-commit.sh`
    - _Requirements: 5.1, 8.5_

  - [x] 1.2 Define core constants and exit codes
    - Exit codes `0` / `1` / `2`, default config, rule ids, managed hook markers
    - Exported from `scripts/md-practice.mjs` for tests
    - _Requirements: 1.1, 5.4, 6.1_

- [x] 2. Configuration loading and validation
  - [x] 2.1 Implement defaults and Config schema
    - `DEFAULT_CONFIG` + `mergeConfig` / `normalizeRuleConfig`
    - Severity `error` | `warning` | `off`; per-rule `options` and `fix`
    - _Requirements: 1.2, 1.3, 1.4, 7.1, 7.2, 7.3, 7.4_

  - [x] 2.2 Implement Config loader
    - `.md-practice.yml` / `.yaml` / `.json`; missing → defaults; invalid → exit `2`
    - `--config <path>` override
    - _Requirements: 1.1, 1.5, 1.6_

  - [x] 2.3 Unit tests for Config merge and validation
    - Covered in `scripts/md-practice.test.mjs`
    - _Requirements: 1.5, 1.6, 7.1, 7.2_

- [x] 3. File selection
  - [x] 3.1 Implement include/exclude selection
    - `filterByConfig` + directory walk; Markdown-only
    - _Requirements: 1.2, 7.3, 8.1, 8.2_

  - [x] 3.2 Implement staged-file mode
    - `git diff --cached --name-only --diff-filter=ACMR`; empty → exit `0`
    - _Requirements: 4.2, 4.3, 7.4_

  - [x] 3.3 Unit tests for file selection
    - Covered in `scripts/md-practice.test.mjs`
    - _Requirements: 4.2, 4.3, 8.1, 8.2_

- [x] 4. Checkpoint — config and selection
  - Config + selection tests pass.

- [x] 5. Rule engine and built-in rules
  - [x] 5.1 Implement Rule registry and engine
    - check/fix modes, failFast, file-error continue
    - _Requirements: 2.3, 3.1, 3.2, 3.3, 3.5, 8.3, 8.4_

  - [x] 5.2 Implement fixable formatting rules
    - `trailing-whitespace`, `consecutive-blank-lines`, `blanks-around-headings`, `blanks-around-fences`, `list-marker-style`
    - Extra (post-MVP lint alignment): `table-column-style`, `no-bare-urls`, `fenced-code-language`
    - _Requirements: 2.1, 2.2, 2.4, 2.5_

  - [x] 5.3 Implement report-only structure rules
    - `heading-increment`, `single-h1`, `line-length`
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 5.4 Unit tests per Rule
    - Covered in `scripts/md-practice.test.mjs` (detect + fix + idempotent + fence body safety)
    - _Requirements: 2.5, 3.5, 8.3_

- [x] 6. Reporting and exit codes
  - [x] 6.1 Implement terminal Report
    - Path, line, rule id, message; error/warning/fixed counts
    - _Requirements: 5.5, 6.1, 6.2, 6.3, 6.4_

  - [x] 6.2 Map results to exit codes
    - `0` / `1` / `2` as specified
    - _Requirements: 4.4, 4.5, 5.4_

- [x] 7. CLI entry point
  - [x] 7.1 Implement CLI
    - `--check`, `--fix`, `--config`, `[paths...]`, `--hook`, `--install-hook`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 7.2 CLI integration tests
    - Covered in `scripts/md-practice-cli.test.mjs`
    - _Requirements: 3.1, 3.2, 5.4, 4.5_

- [x] 8. Checkpoint — engine and CLI
  - Rule, report, and CLI tests pass.

- [x] 9. Git hook install and re-stage
  - [x] 9.1 Implement install command
    - `hooks/pre-commit.sh` + managed markers; Kiro Agent Hook `.kiro/hooks/markdown-practice.kiro.hook`
    - _Requirements: 4.1, 4.6_

  - [x] 9.2 Hook runtime behavior
    - Staged default; re-`git add` fixed staged files; errors block, warnings allow
    - _Requirements: 3.4, 4.2, 4.3, 4.4, 4.5_

  - [x] 9.3 Integration test with temp git repo
    - Covered in `scripts/md-practice-cli.test.mjs`
    - _Requirements: 3.4, 4.1, 4.4, 4.5_

- [x] 10. Documentation and schema
  - [x] 10.1 Document Config and Rule ids
    - README “Markdown Practice Hook” section with full rule table
    - `config.schema.json`, `.md-practice.example.yml`, active `.md-practice.json`
    - _Requirements: 7.5, 1.3, 1.4_

- [x] 11. Final checkpoint
  - Full suite includes md-practice unit + CLI/hook tests
  - Smoke: `npm run md-practice:check` / `:fix` and hook install path covered by tests
  - _Requirements: 8.5_

## Notes

- Engine lives in `scripts/md-practice.mjs` (exportable); tests in `scripts/md-practice*.test.mjs`
- Exit code semantics: `0` success, `1` violations, `2` tool failure
- Kiro Agent Hook uses the same engine as the git pre-commit path

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.2"] },
    { "id": 3, "tasks": ["2.3", "3.1", "3.2"] },
    { "id": 4, "tasks": ["3.3"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3"] },
    { "id": 7, "tasks": ["5.4", "6.1", "6.2"] },
    { "id": 8, "tasks": ["7.1"] },
    { "id": 9, "tasks": ["7.2", "9.1"] },
    { "id": 10, "tasks": ["9.2", "9.3"] },
    { "id": 11, "tasks": ["10.1"] }
  ]
}
```
