# Requirements Document

## Introduction

Markdown Practice Hook is a local automation that reviews Markdown files against configurable best-practice rules and optionally applies safe auto-fixes. It runs as a git hook and as a standalone CLI so teams can keep docs consistent without manual cleanup.

**Problem:** Markdown drifts in style — uneven headings, trailing whitespace, missing blanks around lists, inconsistent link syntax — and reviews spend time on formatting instead of content.

**Goal:** On commit (or on demand), scan configured Markdown paths, report violations, and auto-update files where rules support safe fixes.

**Primary users:** Developers and tech writers maintaining Markdown in a git repository.

## Glossary

- **Hook**: A git lifecycle script (for example pre-commit) that invokes the Markdown reviewer before a commit completes
- **CLI**: The command-line entry point that runs the same review/fix logic outside git
- **Config**: A project-local configuration file that defines includes, excludes, rules, and fix behavior
- **Rule**: A named Markdown check with a severity and optional auto-fix
- **Violation**: A concrete Rule failure at a file location (path, line, message)
- **Auto_Fix**: A deterministic edit applied to a file to resolve a Violation without changing prose meaning
- **Report**: Human-readable summary of Violations produced by a run
- **Run_Mode**: Either `check` (report only, non-zero exit on violations) or `fix` (apply Auto_Fixes, then report remaining issues)

## MVP Scope

### In scope

- Project Config file (YAML or JSON) with includes, excludes, rule toggles, and custom options
- Built-in best-practice Rules with safe Auto_Fixes where practical
- Git Hook installation targeting pre-commit (staged `.md` files by default)
- CLI for whole-repo or path-scoped runs
- Clear Report output and meaningful exit codes

### Non-goals

- IDE or editor plugin integrations
- AI/LLM rewriting of Markdown content
- Full CommonMark / GFM parser replacement or arbitrary HTML sanitization
- Remote CI marketplace publishing (local + repo use is enough)
- Non-Markdown formats (AsciiDoc, RST, etc.)

## Success Criteria

1. A developer can add Config, install the Hook, and have staged Markdown reviewed automatically on commit
2. Safe style issues are fixed in place when Run_Mode is `fix`, with a Report of what changed
3. Custom rule options in Config change behavior without code changes

## Requirements

### Requirement 1: Project Configuration

**User Story:** As a developer, I want a config file that defines which files and rules apply, so that the hook matches our project conventions.

#### Acceptance Criteria

1. THE System SHALL load Config from a well-known project path (default: `.md-practice.yml` or `.md-practice.json` at the repository root)
2. THE Config SHALL support include and exclude glob patterns for Markdown files
3. THE Config SHALL allow enabling, disabling, and setting options for each built-in Rule
4. THE Config SHALL allow choosing default Run_Mode (`check` or `fix`) for the Hook
5. IF Config is missing, THEN THE System SHALL use documented built-in defaults and continue
6. IF Config is present but invalid, THEN THE System SHALL fail the run with a clear validation error and non-zero exit code

### Requirement 2: Built-in Best-Practice Rules

**User Story:** As a tech writer, I want a standard set of Markdown best-practice checks, so that docs stay consistent across the repo.

#### Acceptance Criteria

1. THE System SHALL provide built-in Rules covering at least: trailing whitespace, consecutive blank lines, blank lines around headings, blank lines around fenced code blocks, heading level increment (no skipped levels), presence of a single top-level heading when configured, line length warning/error thresholds, and list marker consistency
2. EACH Rule SHALL have a stable id, default severity (`error` or `warning`), and a description
3. WHEN a Rule is disabled in Config, THE System SHALL skip that Rule for the run
4. THE System SHALL support per-Rule options in Config (for example max line length, list style `*` vs `-`, whether a single H1 is required)
5. THE System SHALL NOT alter fenced code block contents when applying Auto_Fixes outside of trailing whitespace at end of lines if that Rule is enabled

### Requirement 3: Review and Auto-Fix Engine

**User Story:** As a developer, I want the tool to review Markdown and apply safe fixes, so that most style issues disappear without hand editing.

#### Acceptance Criteria

1. WHEN Run_Mode is `check`, THE System SHALL report Violations without modifying files
2. WHEN Run_Mode is `fix`, THE System SHALL apply supported Auto_Fixes to matching files and leave unsupported Violations as reported findings
3. THE System SHALL only write a file when at least one Auto_Fix changed its contents
4. AFTER applying Auto_Fixes in Hook Run_Mode `fix`, THE System SHALL re-stage fixed files that were already staged when invoked from git
5. THE System SHALL be deterministic: the same inputs and Config SHALL produce the same Report and file outputs

### Requirement 4: Git Hook Integration

**User Story:** As a developer, I want a pre-commit hook that reviews Markdown automatically, so that bad style does not land in commits unnoticed.

#### Acceptance Criteria

1. THE System SHALL provide a command to install a git pre-commit Hook into the current repository
2. WHEN the Hook runs, THE System SHALL evaluate staged `*.md` / `*.markdown` files that match Config include/exclude patterns
3. IF no staged Markdown files match, THEN THE Hook SHALL exit successfully without further work
4. IF Violations with severity `error` remain after the configured Run_Mode, THEN THE Hook SHALL exit non-zero and block the commit
5. IF only `warning` Violations remain, THEN THE Hook SHALL print the Report and SHALL allow the commit to proceed
6. THE install command SHALL be idempotent (re-running install updates the Hook without duplicating entries)

### Requirement 5: CLI Entry Point

**User Story:** As a developer, I want a CLI to run the same checks on demand, so that I can fix docs outside of a commit.

#### Acceptance Criteria

1. THE System SHALL expose a CLI command that accepts optional file/directory paths
2. THE CLI SHALL support flags for Run_Mode (`--check`, `--fix`) that override Config defaults for that invocation
3. WHEN paths are omitted, THE CLI SHALL scan all Markdown files matching Config include/exclude from the repository root
4. THE CLI SHALL exit `0` when no `error` Violations remain, and non-zero when one or more `error` Violations remain
5. THE CLI SHALL print a Report listing file path, line (when applicable), Rule id, and message for each Violation

### Requirement 6: Reporting

**User Story:** As a developer, I want a readable report of what failed or was fixed, so that I know what to change.

#### Acceptance Criteria

1. THE Report SHALL include a summary count of errors, warnings, and files fixed
2. THE Report SHALL list each remaining Violation with Rule id and location
3. WHEN Auto_Fixes run, THE Report SHALL list which files were modified
4. THE Report SHALL be plain text suitable for terminal output

### Requirement 7: Extensibility via Config (Custom Behavior)

**User Story:** As a maintainer, I want custom Config options beyond defaults, so that we can encode team-specific Markdown conventions without forking the tool.

#### Acceptance Criteria

1. THE Config SHALL allow overriding severity per Rule (`error`, `warning`, `off`)
2. THE Config SHALL allow custom option values for built-in Rules that declare options
3. THE Config SHALL allow an optional `ignorePaths` or exclude list for generated docs
4. THE Config SHALL allow an optional `files` filter mode for Hook use: `staged` (default) or `all` matching includes
5. THE System SHALL document the Config schema and every built-in Rule id in a README section or `config.schema.json`

### Requirement 8: Safety and Non-Interference

**User Story:** As a developer, I want the hook to stay narrow and safe, so that it never blocks unrelated work or rewrites content unexpectedly.

#### Acceptance Criteria

1. THE System SHALL process only Markdown files selected by Config and the current invocation scope
2. THE System SHALL NOT modify non-Markdown files
3. Auto_Fixes SHALL be limited to formatting/structure rules declared as fixable; THE System SHALL NOT paraphrase or rewrite sentences
4. IF a file cannot be read or parsed, THEN THE System SHALL report an error for that file and continue with other files unless Config sets fail-fast
5. THE Hook SHALL complete a typical staged set (≤20 Markdown files under 200KB each) in under 5 seconds on a developer machine
