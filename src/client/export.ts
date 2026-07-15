import * as Y from 'yjs';
import type { SprintPacket, Task } from '../shared/types';

/**
 * Client-side export service for Sprint Room.
 *
 * Reads the latest sprintPacket Y.Map (including human edits) from the Y.Doc
 * and serializes it to markdown or JSON for download. No server round-trip needed.
 */

// --- Y.Doc extraction ---

/**
 * Checks whether a sprint packet exists in the Y.Doc (i.e., sprintGoal is set).
 */
export function hasPacket(doc: Y.Doc): boolean {
  const packetMap = doc.getMap('sprintPacket');
  const sprintGoal = packetMap.get('sprintGoal') as string | undefined;
  return !!sprintGoal;
}

/**
 * Extracts a SprintPacket from the Y.Doc's "sprintPacket" Y.Map.
 * Returns null if no sprint goal has been set.
 */
export function extractPacketFromDoc(doc: Y.Doc): SprintPacket | null {
  const packetMap = doc.getMap('sprintPacket');
  const sprintGoal = packetMap.get('sprintGoal') as string | undefined;

  if (!sprintGoal) {
    return null;
  }

  const inScope = yArrayToStringArray(packetMap.get('inScope') as Y.Array<string> | undefined);
  const outOfScope = yArrayToStringArray(packetMap.get('outOfScope') as Y.Array<string> | undefined);
  const tasks = extractTasks(packetMap.get('tasks') as Y.Array<Y.Map<any>> | undefined);
  const risksAndDependencies = yArrayToStringArray(
    packetMap.get('risksAndDependencies') as Y.Array<string> | undefined
  );
  const assumptions = yArrayToStringArray(
    packetMap.get('assumptions') as Y.Array<string> | undefined
  );

  return {
    sprintGoal,
    inScope,
    outOfScope,
    tasks,
    risksAndDependencies,
    assumptions: assumptions.length > 0 ? assumptions : undefined,
  };
}

// --- Serialization ---

/**
 * Serializes a SprintPacket to markdown format.
 *
 * Sections:
 * - # Sprint Goal
 * - ## In Scope (bulleted)
 * - ## Out of Scope (bulleted)
 * - ## Tasks (numbered, with priority, description, AC sub-bullets)
 * - ## Risks & Dependencies (bulleted)
 * - ## Assumptions (bulleted, only if present)
 * - ## Notes (only if notes text provided)
 */
export function toMarkdown(packet: SprintPacket, notes?: string): string {
  const lines: string[] = [];

  // Sprint Goal
  lines.push(`# Sprint Goal`);
  lines.push('');
  lines.push(packet.sprintGoal);
  lines.push('');

  // In Scope
  lines.push(`## In Scope`);
  lines.push('');
  for (const item of packet.inScope) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  // Out of Scope
  lines.push(`## Out of Scope`);
  lines.push('');
  for (const item of packet.outOfScope) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  // Tasks
  lines.push(`## Tasks`);
  lines.push('');
  for (let i = 0; i < packet.tasks.length; i++) {
    renderTask(lines, packet.tasks[i], i + 1);
  }

  // Risks & Dependencies
  lines.push(`## Risks & Dependencies`);
  lines.push('');
  for (const item of packet.risksAndDependencies) {
    lines.push(`- ${item}`);
  }
  lines.push('');

  // Assumptions (only if present)
  if (packet.assumptions && packet.assumptions.length > 0) {
    lines.push(`## Assumptions`);
    lines.push('');
    for (const item of packet.assumptions) {
      lines.push(`- ${item}`);
    }
    lines.push('');
  }

  // Notes (only if provided)
  if (notes && notes.trim().length > 0) {
    lines.push(`## Notes`);
    lines.push('');
    lines.push(notes.trim());
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Renders a single task as a numbered item with priority, description,
 * and acceptance criteria as sub-bullets.
 */
function renderTask(lines: string[], task: Task, num: number, indent: string = ''): void {
  lines.push(`${indent}${num}. **${task.title}** [${task.priority}]`);
  lines.push(`${indent}   ${task.description}`);
  for (const ac of task.acceptanceCriteria) {
    lines.push(`${indent}   - ${ac}`);
  }

  // Render subtasks if present
  if (task.subtasks && task.subtasks.length > 0) {
    for (let i = 0; i < task.subtasks.length; i++) {
      renderTask(lines, task.subtasks[i], i + 1, indent + '   ');
    }
  }
}

/**
 * Serializes a SprintPacket to pretty-printed JSON (2-space indent).
 */
export function toJSON(packet: SprintPacket): string {
  return JSON.stringify(packet, null, 2);
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  high: 'P0',
  medium: 'P1',
  low: 'P2',
};

function flattenTasks(tasks: Task[]): Task[] {
  const out: Task[] = [];
  for (const task of tasks) {
    out.push(task);
    if (task.subtasks?.length) {
      out.push(...flattenTasks(task.subtasks));
    }
  }
  return out;
}

/**
 * PRD-style outline from the same sprint packet (challenge "useful artifact").
 */
export function toPrdMarkdown(packet: SprintPacket, notes?: string): string {
  const lines: string[] = [];
  lines.push('# Product Requirements Outline');
  lines.push('');
  lines.push('## Problem / Goal');
  lines.push('');
  lines.push(packet.sprintGoal);
  lines.push('');
  lines.push('## In Scope');
  lines.push('');
  for (const item of packet.inScope) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Out of Scope');
  lines.push('');
  for (const item of packet.outOfScope) lines.push(`- ${item}`);
  lines.push('');
  lines.push('## Requirements');
  lines.push('');
  for (const task of flattenTasks(packet.tasks)) {
    lines.push(`### ${task.title}`);
    lines.push('');
    lines.push(task.description);
    lines.push('');
    lines.push(`- Priority: ${task.priority}`);
    lines.push('- Acceptance criteria:');
    for (const ac of task.acceptanceCriteria) {
      lines.push(`  - ${ac}`);
    }
    lines.push('');
  }
  lines.push('## Risks & Dependencies');
  lines.push('');
  for (const item of packet.risksAndDependencies) lines.push(`- ${item}`);
  lines.push('');
  if (packet.assumptions?.length) {
    lines.push('## Assumptions');
    lines.push('');
    for (const item of packet.assumptions) lines.push(`- ${item}`);
    lines.push('');
  }
  if (notes?.trim()) {
    lines.push('## Notes');
    lines.push('');
    lines.push(notes.trim());
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * GitHub Issues draft Markdown — one issue body block per task.
 * Paste into issue create or use with `gh issue create --body-file`.
 */
export function toGitHubIssuesMarkdown(packet: SprintPacket): string {
  const lines: string[] = [];
  lines.push(`# Issues — ${packet.sprintGoal}`);
  lines.push('');
  lines.push(
    '_Each `---` block is one issue. Title line is suitable for `gh issue create --title`._'
  );
  lines.push('');

  for (const task of flattenTasks(packet.tasks)) {
    const label = PRIORITY_LABEL[task.priority] ?? 'P1';
    lines.push('---');
    lines.push('');
    lines.push(`## [${label}] ${task.title}`);
    lines.push('');
    lines.push('### Description');
    lines.push('');
    lines.push(task.description);
    lines.push('');
    lines.push('### Acceptance criteria');
    lines.push('');
    for (const ac of task.acceptanceCriteria) {
      lines.push(`- [ ] ${ac}`);
    }
    lines.push('');
    lines.push('### Labels');
    lines.push('');
    lines.push(`\`${task.priority}\`, \`sprint\``);
    if (task.parentTaskId) {
      lines.push('');
      lines.push(`Parent task: \`${task.parentTaskId}\``);
    }
    lines.push('');
  }

  if (packet.risksAndDependencies.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Tracking — Risks & Dependencies');
    lines.push('');
    for (const item of packet.risksAndDependencies) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Kickoff checklist: goals + tasks + acceptance criteria as checkboxes. */
export function toChecklistMarkdown(packet: SprintPacket): string {
  const lines: string[] = [];
  lines.push(`# Sprint Checklist`);
  lines.push('');
  lines.push(`**Goal:** ${packet.sprintGoal}`);
  lines.push('');
  lines.push('## Scope');
  lines.push('');
  for (const item of packet.inScope) lines.push(`- [ ] In scope: ${item}`);
  for (const item of packet.outOfScope) lines.push(`- [ ] Confirm out of scope: ${item}`);
  lines.push('');
  lines.push('## Tasks');
  lines.push('');
  for (const task of flattenTasks(packet.tasks)) {
    lines.push(`- [ ] **${task.title}** [${task.priority}]`);
    for (const ac of task.acceptanceCriteria) {
      lines.push(`  - [ ] ${ac}`);
    }
  }
  lines.push('');
  if (packet.risksAndDependencies.length > 0) {
    lines.push('## Risks & Dependencies');
    lines.push('');
    for (const item of packet.risksAndDependencies) {
      lines.push(`- [ ] ${item}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export type ExportFormat = 'markdown' | 'json' | 'prd' | 'issues' | 'checklist';

const EXPORT_META: Record<
  ExportFormat,
  { mimeType: string; filename: string; build: (p: SprintPacket, notes?: string) => string }
> = {
  markdown: {
    mimeType: 'text/markdown',
    filename: 'sprint-packet.md',
    build: (p, notes) => toMarkdown(p, notes),
  },
  json: {
    mimeType: 'application/json',
    filename: 'sprint-packet.json',
    build: (p) => toJSON(p),
  },
  prd: {
    mimeType: 'text/markdown',
    filename: 'prd-outline.md',
    build: (p, notes) => toPrdMarkdown(p, notes),
  },
  issues: {
    mimeType: 'text/markdown',
    filename: 'github-issues.md',
    build: (p) => toGitHubIssuesMarkdown(p),
  },
  checklist: {
    mimeType: 'text/markdown',
    filename: 'sprint-checklist.md',
    build: (p) => toChecklistMarkdown(p),
  },
};

// --- Download ---

/**
 * Creates a Blob from the serialized packet and triggers a browser download.
 */
export function download(
  format: ExportFormat,
  packet: SprintPacket,
  notes?: string
): void {
  const meta = EXPORT_META[format];
  const content = meta.build(packet, notes);

  const blob = new Blob([content], { type: meta.mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = meta.filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  // Cleanup
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// --- Internal helpers ---

/** Convert a Y.Array<string> to a plain string array */
function yArrayToStringArray(arr: Y.Array<string> | undefined): string[] {
  if (!arr || !(arr instanceof Y.Array)) return [];
  const result: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr.get(i));
  }
  return result;
}

/** Extract tasks from Y.Array<Y.Map> */
function extractTasks(arr: Y.Array<Y.Map<any>> | undefined): Task[] {
  if (!arr || !(arr instanceof Y.Array)) return [];
  const tasks: Task[] = [];
  for (let i = 0; i < arr.length; i++) {
    const taskMap = arr.get(i) as Y.Map<any>;
    tasks.push(extractTask(taskMap));
  }
  return tasks;
}

/** Extract a single Task from a Y.Map */
function extractTask(taskMap: Y.Map<any>): Task {
  const subtasksArr = taskMap.get('subtasks') as Y.Array<Y.Map<any>> | undefined;
  const subtasks = subtasksArr ? extractTasks(subtasksArr) : undefined;

  return {
    id: taskMap.get('id') ?? '',
    title: taskMap.get('title') ?? '',
    description: taskMap.get('description') ?? '',
    priority: taskMap.get('priority') ?? 'medium',
    acceptanceCriteria: yArrayToStringArray(
      taskMap.get('acceptanceCriteria') as Y.Array<string> | undefined
    ),
    ...(subtasks && subtasks.length > 0 ? { subtasks } : {}),
    ...(taskMap.get('parentTaskId') != null ? { parentTaskId: taskMap.get('parentTaskId') } : {}),
  };
}
