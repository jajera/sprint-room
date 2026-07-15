import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { SprintPacket, Task } from '../shared/types';
import {
  hasPacket,
  extractPacketFromDoc,
  toMarkdown,
  toJSON,
  toPrdMarkdown,
  toGitHubIssuesMarkdown,
  toChecklistMarkdown,
  download,
} from './export';

// --- Helpers to populate a Y.Doc with sprint packet data ---

function createDocWithPacket(packet: SprintPacket): Y.Doc {
  const doc = new Y.Doc();
  const packetMap = doc.getMap('sprintPacket');

  doc.transact(() => {
    packetMap.set('sprintGoal', packet.sprintGoal);

    const inScope = new Y.Array<string>();
    inScope.push(packet.inScope);
    packetMap.set('inScope', inScope);

    const outOfScope = new Y.Array<string>();
    outOfScope.push(packet.outOfScope);
    packetMap.set('outOfScope', outOfScope);

    const tasksArray = new Y.Array<Y.Map<any>>();
    for (const task of packet.tasks) {
      tasksArray.push([taskToYMap(task)]);
    }
    packetMap.set('tasks', tasksArray);

    const risks = new Y.Array<string>();
    risks.push(packet.risksAndDependencies);
    packetMap.set('risksAndDependencies', risks);

    if (packet.assumptions && packet.assumptions.length > 0) {
      const assumptions = new Y.Array<string>();
      assumptions.push(packet.assumptions);
      packetMap.set('assumptions', assumptions);
    }
  });

  return doc;
}

function taskToYMap(task: Task): Y.Map<any> {
  const map = new Y.Map<any>();
  map.set('id', task.id);
  map.set('title', task.title);
  map.set('description', task.description);
  map.set('priority', task.priority);

  const ac = new Y.Array<string>();
  ac.push(task.acceptanceCriteria);
  map.set('acceptanceCriteria', ac);

  if (task.subtasks && task.subtasks.length > 0) {
    const subtasksArr = new Y.Array<Y.Map<any>>();
    for (const st of task.subtasks) {
      subtasksArr.push([taskToYMap(st)]);
    }
    map.set('subtasks', subtasksArr);
  }

  if (task.parentTaskId != null) {
    map.set('parentTaskId', task.parentTaskId);
  }

  return map;
}

// --- Sample data ---

const sampleTask: Task = {
  id: 'task-1',
  title: 'Set up CI pipeline',
  description: 'Configure GitHub Actions for build and test',
  priority: 'high',
  acceptanceCriteria: ['Build runs on push', 'Tests pass before merge'],
};

const sampleTaskWithSubtasks: Task = {
  id: 'task-2',
  title: 'Implement auth',
  description: 'Add login and signup flows',
  priority: 'medium',
  acceptanceCriteria: ['Users can log in', 'Users can sign up'],
  subtasks: [
    {
      id: 'task-2-1',
      title: 'Login form',
      description: 'Create the login form UI',
      priority: 'medium',
      acceptanceCriteria: ['Form validates email'],
      parentTaskId: 'task-2',
    },
  ],
};

const samplePacket: SprintPacket = {
  sprintGoal: 'Ship MVP login flow',
  inScope: ['Email login', 'Password reset'],
  outOfScope: ['SSO', 'Social login'],
  tasks: [sampleTask],
  risksAndDependencies: ['Email provider availability'],
};

const packetWithAssumptions: SprintPacket = {
  ...samplePacket,
  assumptions: ['Team has access to SendGrid', 'Design is finalized'],
};

// --- Tests ---

describe('export service', () => {
  describe('hasPacket', () => {
    it('returns false for an empty doc', () => {
      const doc = new Y.Doc();
      doc.getMap('sprintPacket');
      expect(hasPacket(doc)).toBe(false);
    });

    it('returns false when sprintGoal is empty string', () => {
      const doc = new Y.Doc();
      const packetMap = doc.getMap('sprintPacket');
      packetMap.set('sprintGoal', '');
      expect(hasPacket(doc)).toBe(false);
    });

    it('returns true when sprintGoal is set', () => {
      const doc = createDocWithPacket(samplePacket);
      expect(hasPacket(doc)).toBe(true);
    });
  });

  describe('extractPacketFromDoc', () => {
    it('returns null for empty doc', () => {
      const doc = new Y.Doc();
      doc.getMap('sprintPacket');
      expect(extractPacketFromDoc(doc)).toBeNull();
    });

    it('extracts a basic packet correctly', () => {
      const doc = createDocWithPacket(samplePacket);
      const result = extractPacketFromDoc(doc);

      expect(result).not.toBeNull();
      expect(result!.sprintGoal).toBe('Ship MVP login flow');
      expect(result!.inScope).toEqual(['Email login', 'Password reset']);
      expect(result!.outOfScope).toEqual(['SSO', 'Social login']);
      expect(result!.tasks).toHaveLength(1);
      expect(result!.tasks[0].title).toBe('Set up CI pipeline');
      expect(result!.tasks[0].priority).toBe('high');
      expect(result!.tasks[0].acceptanceCriteria).toEqual([
        'Build runs on push',
        'Tests pass before merge',
      ]);
      expect(result!.risksAndDependencies).toEqual(['Email provider availability']);
      expect(result!.assumptions).toBeUndefined();
    });

    it('extracts assumptions when present', () => {
      const doc = createDocWithPacket(packetWithAssumptions);
      const result = extractPacketFromDoc(doc);

      expect(result!.assumptions).toEqual([
        'Team has access to SendGrid',
        'Design is finalized',
      ]);
    });

    it('extracts subtasks correctly', () => {
      const packetWithSubs: SprintPacket = {
        ...samplePacket,
        tasks: [sampleTaskWithSubtasks],
      };
      const doc = createDocWithPacket(packetWithSubs);
      const result = extractPacketFromDoc(doc);

      expect(result!.tasks[0].subtasks).toHaveLength(1);
      expect(result!.tasks[0].subtasks![0].title).toBe('Login form');
      expect(result!.tasks[0].subtasks![0].parentTaskId).toBe('task-2');
    });
  });

  describe('toMarkdown', () => {
    it('includes all required sections', () => {
      const md = toMarkdown(samplePacket);

      expect(md).toContain('# Sprint Goal');
      expect(md).toContain('Ship MVP login flow');
      expect(md).toContain('## In Scope');
      expect(md).toContain('- Email login');
      expect(md).toContain('- Password reset');
      expect(md).toContain('## Out of Scope');
      expect(md).toContain('- SSO');
      expect(md).toContain('- Social login');
      expect(md).toContain('## Tasks');
      expect(md).toContain('**Set up CI pipeline** [high]');
      expect(md).toContain('Configure GitHub Actions for build and test');
      expect(md).toContain('- Build runs on push');
      expect(md).toContain('- Tests pass before merge');
      expect(md).toContain('## Risks & Dependencies');
      expect(md).toContain('- Email provider availability');
    });

    it('omits Assumptions section when not present', () => {
      const md = toMarkdown(samplePacket);
      expect(md).not.toContain('## Assumptions');
    });

    it('includes Assumptions section when present', () => {
      const md = toMarkdown(packetWithAssumptions);
      expect(md).toContain('## Assumptions');
      expect(md).toContain('- Team has access to SendGrid');
      expect(md).toContain('- Design is finalized');
    });

    it('omits Notes section when no notes provided', () => {
      const md = toMarkdown(samplePacket);
      expect(md).not.toContain('## Notes');
    });

    it('omits Notes section when notes is empty/whitespace', () => {
      const md = toMarkdown(samplePacket, '   ');
      expect(md).not.toContain('## Notes');
    });

    it('includes Notes section when notes provided', () => {
      const md = toMarkdown(samplePacket, 'Remember to check with ops team.');
      expect(md).toContain('## Notes');
      expect(md).toContain('Remember to check with ops team.');
    });

    it('renders task numbers sequentially', () => {
      const multiTask: SprintPacket = {
        ...samplePacket,
        tasks: [
          sampleTask,
          { ...sampleTask, id: 'task-2', title: 'Deploy service', priority: 'low' },
        ],
      };
      const md = toMarkdown(multiTask);
      expect(md).toContain('1. **Set up CI pipeline** [high]');
      expect(md).toContain('2. **Deploy service** [low]');
    });

    it('renders subtasks indented under parent', () => {
      const packetWithSubs: SprintPacket = {
        ...samplePacket,
        tasks: [sampleTaskWithSubtasks],
      };
      const md = toMarkdown(packetWithSubs);
      expect(md).toContain('1. **Implement auth** [medium]');
      expect(md).toContain('   1. **Login form** [medium]');
    });
  });

  describe('artifact templates', () => {
    it('toPrdMarkdown uses PRD section headings', () => {
      const md = toPrdMarkdown(samplePacket);
      expect(md).toContain('# Product Requirements Outline');
      expect(md).toContain('## Problem / Goal');
      expect(md).toContain('## Requirements');
      expect(md).toContain(samplePacket.sprintGoal);
      expect(md).toContain(sampleTask.title);
    });

    it('toGitHubIssuesMarkdown emits issue blocks with checkable ACs', () => {
      const md = toGitHubIssuesMarkdown(samplePacket);
      expect(md).toContain('## [P0] Set up CI pipeline');
      expect(md).toContain('- [ ]');
      expect(md).toContain('### Acceptance criteria');
    });

    it('toChecklistMarkdown emits goal and task checkboxes', () => {
      const md = toChecklistMarkdown(samplePacket);
      expect(md).toContain('# Sprint Checklist');
      expect(md).toContain(`**Goal:** ${samplePacket.sprintGoal}`);
      expect(md).toContain(`- [ ] **${sampleTask.title}**`);
    });
  });

  describe('toJSON', () => {
    it('produces valid JSON that parses back to the packet', () => {
      const jsonStr = toJSON(samplePacket);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.sprintGoal).toBe(samplePacket.sprintGoal);
      expect(parsed.inScope).toEqual(samplePacket.inScope);
      expect(parsed.outOfScope).toEqual(samplePacket.outOfScope);
      expect(parsed.tasks).toHaveLength(1);
      expect(parsed.risksAndDependencies).toEqual(samplePacket.risksAndDependencies);
    });

    it('uses 2-space indentation', () => {
      const jsonStr = toJSON(samplePacket);
      // The second line should have 2-space indent
      const lines = jsonStr.split('\n');
      expect(lines[1]).toMatch(/^ {2}"/);
    });

    it('includes assumptions when present', () => {
      const jsonStr = toJSON(packetWithAssumptions);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.assumptions).toEqual(packetWithAssumptions.assumptions);
    });

    it('round-trips correctly for packet with subtasks', () => {
      const packetWithSubs: SprintPacket = {
        ...samplePacket,
        tasks: [sampleTaskWithSubtasks],
      };
      const jsonStr = toJSON(packetWithSubs);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.tasks[0].subtasks).toHaveLength(1);
      expect(parsed.tasks[0].subtasks[0].title).toBe('Login form');
      expect(parsed.tasks[0].subtasks[0].parentTaskId).toBe('task-2');
    });
  });

  describe('download', () => {
    let createObjectURLMock: ReturnType<typeof vi.fn>;
    let revokeObjectURLMock: ReturnType<typeof vi.fn>;
    let appendChildMock: ReturnType<typeof vi.fn>;
    let removeChildMock: ReturnType<typeof vi.fn>;
    let clickMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      createObjectURLMock = vi.fn().mockReturnValue('blob:test-url');
      revokeObjectURLMock = vi.fn();
      appendChildMock = vi.fn();
      removeChildMock = vi.fn();
      clickMock = vi.fn();

      vi.stubGlobal('URL', {
        createObjectURL: createObjectURLMock,
        revokeObjectURL: revokeObjectURLMock,
      });

      vi.spyOn(document.body, 'appendChild').mockImplementation(appendChildMock);
      vi.spyOn(document.body, 'removeChild').mockImplementation(removeChildMock);
      vi.spyOn(document, 'createElement').mockReturnValue({
        href: '',
        download: '',
        style: { display: '' },
        click: clickMock,
      } as unknown as HTMLAnchorElement);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('downloads markdown with correct filename', () => {
      download('markdown', samplePacket);

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blob = createObjectURLMock.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('text/markdown');

      const anchor = (document.createElement as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(anchor.download).toBe('sprint-packet.md');
      expect(clickMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test-url');
    });

    it('downloads JSON with correct filename', () => {
      download('json', samplePacket);

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      const blob = createObjectURLMock.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('application/json');

      const anchor = (document.createElement as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(anchor.download).toBe('sprint-packet.json');
      expect(clickMock).toHaveBeenCalledTimes(1);
    });

    it('downloads PRD outline with prd-outline.md filename', () => {
      download('prd', samplePacket);
      const anchor = (document.createElement as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(anchor.download).toBe('prd-outline.md');
    });

    it('downloads GitHub issues draft with github-issues.md filename', () => {
      download('issues', samplePacket);
      const anchor = (document.createElement as ReturnType<typeof vi.fn>).mock.results[0].value;
      expect(anchor.download).toBe('github-issues.md');
    });

    it('passes notes to markdown export', () => {
      download('markdown', samplePacket, 'Some session notes');

      const blob = createObjectURLMock.mock.calls[0][0] as Blob;
      expect(blob.type).toBe('text/markdown');
      // The download function uses toMarkdown internally with notes
      expect(clickMock).toHaveBeenCalledTimes(1);
    });

    it('cleans up anchor element and revokes URL', () => {
      download('json', samplePacket);

      expect(appendChildMock).toHaveBeenCalledTimes(1);
      expect(removeChildMock).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledTimes(1);
    });
  });
});
