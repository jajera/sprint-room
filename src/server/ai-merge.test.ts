import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  mergeClarifyOutput,
  mergePlanOutput,
  mergeBreakDownOutput,
  handleMergeError,
} from './ai-merge';
import type {
  ClarifyOutput,
  SprintPacket,
  BreakDownOutput,
} from '../shared/types';

// --- Helpers ---

function createTestDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getArray('clarifications');
  const sp = doc.getMap('sprintPacket');
  doc.transact(() => {
    sp.set('inScope', new Y.Array<string>());
    sp.set('outOfScope', new Y.Array<string>());
    sp.set('tasks', new Y.Array());
    sp.set('risksAndDependencies', new Y.Array<string>());
    sp.set('assumptions', new Y.Array<string>());
  });
  doc.getXmlFragment('notes');
  return doc;
}

function getClarifications(doc: Y.Doc): Array<Record<string, any>> {
  const arr = doc.getArray('clarifications');
  const result: Array<Record<string, any>> = [];
  for (let i = 0; i < arr.length; i++) {
    const map = arr.get(i) as Y.Map<any>;
    result.push({
      questionId: map.get('questionId'),
      question: map.get('question'),
      questionContext: map.get('questionContext'),
      answer: map.get('answer'),
      answeredBy: map.get('answeredBy'),
      timestamp: map.get('timestamp'),
    });
  }
  return result;
}

function getSprintPacketData(doc: Y.Doc) {
  const sp = doc.getMap('sprintPacket');
  const tasksArr = sp.get('tasks') as Y.Array<Y.Map<any>>;
  const tasks: Array<Record<string, any>> = [];
  if (tasksArr && tasksArr instanceof Y.Array) {
    for (let i = 0; i < tasksArr.length; i++) {
      const t = tasksArr.get(i) as Y.Map<any>;
      tasks.push(extractTaskData(t));
    }
  }

  const inScope = yArrayToStrings(sp.get('inScope') as Y.Array<string>);
  const outOfScope = yArrayToStrings(sp.get('outOfScope') as Y.Array<string>);
  const risks = yArrayToStrings(sp.get('risksAndDependencies') as Y.Array<string>);
  const assumptions = yArrayToStrings(sp.get('assumptions') as Y.Array<string>);

  return {
    sprintGoal: sp.get('sprintGoal') as string | undefined,
    inScope,
    outOfScope,
    tasks,
    risksAndDependencies: risks,
    assumptions,
  };
}

function extractTaskData(taskMap: Y.Map<any>): Record<string, any> {
  const data: Record<string, any> = {
    id: taskMap.get('id'),
    title: taskMap.get('title'),
    description: taskMap.get('description'),
    priority: taskMap.get('priority'),
    acceptanceCriteria: yArrayToStrings(taskMap.get('acceptanceCriteria') as Y.Array<string>),
  };
  if (taskMap.get('parentTaskId') != null) {
    data.parentTaskId = taskMap.get('parentTaskId');
  }
  const subtasksArr = taskMap.get('subtasks') as Y.Array<Y.Map<any>> | undefined;
  if (subtasksArr && subtasksArr instanceof Y.Array && subtasksArr.length > 0) {
    data.subtasks = [];
    for (let i = 0; i < subtasksArr.length; i++) {
      data.subtasks.push(extractTaskData(subtasksArr.get(i) as Y.Map<any>));
    }
  }
  return data;
}

function yArrayToStrings(arr: Y.Array<string> | undefined): string[] {
  if (!arr || !(arr instanceof Y.Array)) return [];
  const result: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr.get(i));
  }
  return result;
}

// --- Test data ---

const validClarifyOutput: ClarifyOutput = {
  questions: [
    { id: 'q1', question: 'What is the timeline?', context: 'Needed for prioritization' },
    { id: 'q2', question: 'Who owns the backend?', context: 'Determines scope' },
  ],
};

const validPlanOutput: SprintPacket = {
  sprintGoal: 'Implement user authentication',
  inScope: ['Login flow', 'Session management'],
  outOfScope: ['MFA', 'Password reset'],
  tasks: [
    {
      id: 'task-1',
      title: 'Implement login endpoint',
      description: 'Create POST /login endpoint',
      priority: 'high',
      acceptanceCriteria: ['User can log in with email/password'],
    },
    {
      id: 'task-2',
      title: 'Add session tokens',
      description: 'Generate JWT on successful login',
      priority: 'medium',
      acceptanceCriteria: ['Token returned on login', 'Token expires after 24h'],
    },
  ],
  risksAndDependencies: ['Need database access'],
  assumptions: ['Single-tenant application'],
};

const validBreakDownOutput: BreakDownOutput = {
  parentTaskId: 'task-1',
  parentTaskTitle: 'Implement login endpoint',
  subtasks: [
    {
      id: 'sub-1',
      title: 'Create route handler',
      description: 'Set up Express route',
      priority: 'high',
      acceptanceCriteria: ['Route responds to POST'],
    },
    {
      id: 'sub-2',
      title: 'Validate credentials',
      description: 'Check username/password against store',
      priority: 'high',
      acceptanceCriteria: ['Invalid creds return 401'],
    },
  ],
};

// --- Tests ---

describe('mergeClarifyOutput', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createTestDoc();
  });

  it('appends clarification questions to Y.Array("clarifications")', () => {
    mergeClarifyOutput(doc, validClarifyOutput);

    const clarifications = getClarifications(doc);
    expect(clarifications).toHaveLength(2);
    expect(clarifications[0].questionId).toBe('q1');
    expect(clarifications[0].question).toBe('What is the timeline?');
    expect(clarifications[0].questionContext).toBe('Needed for prioritization');
    expect(clarifications[0].answer).toBeNull();
    expect(clarifications[0].answeredBy).toBeNull();
    expect(clarifications[0].timestamp).toBeTypeOf('number');
  });

  it('sets answer and answeredBy to null for new questions', () => {
    mergeClarifyOutput(doc, validClarifyOutput);

    const clarifications = getClarifications(doc);
    for (const c of clarifications) {
      expect(c.answer).toBeNull();
      expect(c.answeredBy).toBeNull();
    }
  });

  it('never deletes answered clarifications when merging more questions', () => {
    const arr = doc.getArray('clarifications');
    doc.transact(() => {
      for (let i = 0; i < 4; i++) {
        const entry = new Y.Map();
        entry.set('questionId', `existing-${i}`);
        entry.set('question', `Existing question ${i}`);
        entry.set('questionContext', `Context ${i}`);
        entry.set('answer', 'yes');
        entry.set('answeredBy', 'Alice');
        entry.set('timestamp', Date.now() - 10000 + i);
        arr.push([entry]);
      }
    });

    const threeQuestions: ClarifyOutput = {
      questions: [
        { id: 'new-1', question: 'New Q1', context: 'C1' },
        { id: 'new-2', question: 'New Q2', context: 'C2' },
        { id: 'new-3', question: 'New Q3', context: 'C3' },
      ],
    };

    mergeClarifyOutput(doc, threeQuestions);

    const clarifications = getClarifications(doc);
    expect(clarifications).toHaveLength(7);
    expect(clarifications.filter((c) => c.answer === 'yes')).toHaveLength(4);
    expect(clarifications.map((c) => c.questionId)).toEqual([
      'existing-0',
      'existing-1',
      'existing-2',
      'existing-3',
      'new-1',
      'new-2',
      'new-3',
    ]);
  });

  it('rejects malformed output (missing required fields)', () => {
    const malformed = { questions: [{ id: 'q1' }] } as any;
    expect(() => mergeClarifyOutput(doc, malformed)).toThrow();
    // Doc should not be modified
    expect(doc.getArray('clarifications').length).toBe(0);
  });

  it('rejects output with more than 5 questions', () => {
    const tooMany: ClarifyOutput = {
      questions: Array.from({ length: 6 }, (_, i) => ({
        id: `q${i}`,
        question: `Question ${i}`,
        context: `Context ${i}`,
      })),
    };
    expect(() => mergeClarifyOutput(doc, tooMany)).toThrow();
    expect(doc.getArray('clarifications').length).toBe(0);
  });

  it('handles empty questions array gracefully', () => {
    const empty: ClarifyOutput = { questions: [] };
    mergeClarifyOutput(doc, empty);
    expect(doc.getArray('clarifications').length).toBe(0);
  });
});

describe('mergePlanOutput', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createTestDoc();
  });

  it('writes all sprint packet fields to Y.Map("sprintPacket")', () => {
    mergePlanOutput(doc, validPlanOutput);

    const data = getSprintPacketData(doc);
    expect(data.sprintGoal).toBe('Implement user authentication');
    expect(data.inScope).toEqual(['Login flow', 'Session management']);
    expect(data.outOfScope).toEqual(['MFA', 'Password reset']);
    expect(data.risksAndDependencies).toEqual(['Need database access']);
    expect(data.assumptions).toEqual(['Single-tenant application']);
    expect(data.tasks).toHaveLength(2);
  });

  it('writes tasks with all fields', () => {
    mergePlanOutput(doc, validPlanOutput);

    const data = getSprintPacketData(doc);
    expect(data.tasks[0]).toMatchObject({
      id: 'task-1',
      title: 'Implement login endpoint',
      description: 'Create POST /login endpoint',
      priority: 'high',
      acceptanceCriteria: ['User can log in with email/password'],
    });
  });

  it('preserves task IDs when regenerating with matching titles', () => {
    // First write
    mergePlanOutput(doc, validPlanOutput);

    // Regenerate with same titles but different IDs
    const regenerated: SprintPacket = {
      ...validPlanOutput,
      tasks: [
        {
          ...validPlanOutput.tasks[0],
          id: 'new-id-1', // different ID
          title: 'Implement login endpoint', // same title
        },
        {
          ...validPlanOutput.tasks[1],
          id: 'new-id-2', // different ID
          title: 'Add session tokens', // same title
        },
      ],
    };

    mergePlanOutput(doc, regenerated);

    const data = getSprintPacketData(doc);
    // IDs should be preserved from the first write
    expect(data.tasks[0].id).toBe('task-1');
    expect(data.tasks[1].id).toBe('task-2');
  });

  it('uses new IDs when titles do not match existing tasks', () => {
    // First write
    mergePlanOutput(doc, validPlanOutput);

    // Regenerate with completely different titles
    const regenerated: SprintPacket = {
      ...validPlanOutput,
      tasks: [
        {
          id: 'brand-new-1',
          title: 'Completely different task',
          description: 'Something else',
          priority: 'low',
          acceptanceCriteria: ['Done'],
        },
      ],
    };

    mergePlanOutput(doc, regenerated);

    const data = getSprintPacketData(doc);
    expect(data.tasks[0].id).toBe('brand-new-1');
  });

  it('clears old content before writing new', () => {
    // First write
    mergePlanOutput(doc, validPlanOutput);

    // Second write with different data
    const newPlan: SprintPacket = {
      sprintGoal: 'New goal',
      inScope: ['New scope'],
      outOfScope: [],
      tasks: [
        {
          id: 't1',
          title: 'New task',
          description: 'New desc',
          priority: 'low',
          acceptanceCriteria: ['AC1'],
        },
      ],
      risksAndDependencies: [],
    };

    mergePlanOutput(doc, newPlan);

    const data = getSprintPacketData(doc);
    expect(data.sprintGoal).toBe('New goal');
    expect(data.inScope).toEqual(['New scope']);
    expect(data.outOfScope).toEqual([]);
    expect(data.tasks).toHaveLength(1);
    expect(data.risksAndDependencies).toEqual([]);
    expect(data.assumptions).toEqual([]);
  });

  it('rejects malformed output (empty sprintGoal)', () => {
    const malformed = { ...validPlanOutput, sprintGoal: '' };
    expect(() => mergePlanOutput(doc, malformed)).toThrow();
  });

  it('rejects plan with task missing acceptance criteria', () => {
    const malformed: SprintPacket = {
      ...validPlanOutput,
      tasks: [
        {
          id: 'task-1',
          title: 'Task',
          description: 'Desc',
          priority: 'high',
          acceptanceCriteria: [], // must have ≥1
        },
      ],
    };
    expect(() => mergePlanOutput(doc, malformed)).toThrow();
  });

  it('handles optional assumptions (undefined)', () => {
    const noAssumptions: SprintPacket = {
      ...validPlanOutput,
      assumptions: undefined,
    };
    mergePlanOutput(doc, noAssumptions);

    const data = getSprintPacketData(doc);
    expect(data.assumptions).toEqual([]);
  });
});

describe('mergeBreakDownOutput', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createTestDoc();
    // Pre-populate with a plan so we have parent tasks
    mergePlanOutput(doc, validPlanOutput);
  });

  it('appends subtasks under the parent task', () => {
    mergeBreakDownOutput(doc, validBreakDownOutput);

    const data = getSprintPacketData(doc);
    const parentTask = data.tasks.find((t) => t.id === 'task-1');
    expect(parentTask).toBeDefined();
    expect(parentTask!.subtasks).toHaveLength(2);
    expect(parentTask!.subtasks![0].title).toBe('Create route handler');
    expect(parentTask!.subtasks![1].title).toBe('Validate credentials');
  });

  it('sets parentTaskId on each subtask', () => {
    mergeBreakDownOutput(doc, validBreakDownOutput);

    const data = getSprintPacketData(doc);
    const parentTask = data.tasks.find((t) => t.id === 'task-1');
    for (const subtask of parentTask!.subtasks!) {
      expect(subtask.parentTaskId).toBe('task-1');
    }
  });

  it('keeps the parent task intact', () => {
    mergeBreakDownOutput(doc, validBreakDownOutput);

    const data = getSprintPacketData(doc);
    const parentTask = data.tasks.find((t) => t.id === 'task-1');
    expect(parentTask!.title).toBe('Implement login endpoint');
    expect(parentTask!.description).toBe('Create POST /login endpoint');
    expect(parentTask!.priority).toBe('high');
    expect(parentTask!.acceptanceCriteria).toEqual(['User can log in with email/password']);
  });

  it('appends to existing subtasks array if present', () => {
    // First break-down
    mergeBreakDownOutput(doc, validBreakDownOutput);

    // Second break-down with additional subtasks
    const moreSubtasks: BreakDownOutput = {
      parentTaskId: 'task-1',
      parentTaskTitle: 'Implement login endpoint',
      subtasks: [
        {
          id: 'sub-3',
          title: 'Write tests',
          description: 'Unit tests for login',
          priority: 'medium',
          acceptanceCriteria: ['All tests pass'],
        },
      ],
    };

    mergeBreakDownOutput(doc, moreSubtasks);

    const data = getSprintPacketData(doc);
    const parentTask = data.tasks.find((t) => t.id === 'task-1');
    expect(parentTask!.subtasks).toHaveLength(3);
    expect(parentTask!.subtasks![2].title).toBe('Write tests');
    expect(parentTask!.subtasks![2].parentTaskId).toBe('task-1');
  });

  it('throws when parent task is not found', () => {
    const badParent: BreakDownOutput = {
      parentTaskId: 'nonexistent',
      parentTaskTitle: 'Does not exist',
      subtasks: [
        {
          id: 'sub-1',
          title: 'Subtask',
          description: 'Desc',
          priority: 'medium',
          acceptanceCriteria: ['AC'],
        },
      ],
    };

    expect(() => mergeBreakDownOutput(doc, badParent)).toThrow(
      'Parent task "nonexistent" not found',
    );
  });

  it('throws when no tasks array exists in sprintPacket', () => {
    const emptyDoc = new Y.Doc();
    emptyDoc.getMap('sprintPacket');

    expect(() => mergeBreakDownOutput(emptyDoc, validBreakDownOutput)).toThrow(
      'No tasks array found',
    );
  });

  it('rejects malformed break-down output', () => {
    const malformed = {
      parentTaskId: 'task-1',
      parentTaskTitle: 'Task 1',
      subtasks: [], // must have ≥1
    };
    expect(() => mergeBreakDownOutput(doc, malformed as any)).toThrow();
  });
});

describe('handleMergeError', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createTestDoc();
  });

  it('appends a warning paragraph to Y.XmlFragment("notes")', () => {
    handleMergeError(doc, 'Something went wrong');

    const notes = doc.getXmlFragment('notes');
    expect(notes.length).toBe(1);

    const paragraph = notes.get(0) as Y.XmlElement;
    expect(paragraph.nodeName).toBe('p');

    const text = paragraph.get(0) as Y.XmlText;
    expect(text.toString()).toContain('AI Error: Something went wrong');
  });

  it('can append multiple error messages', () => {
    handleMergeError(doc, 'First error');
    handleMergeError(doc, 'Second error');

    const notes = doc.getXmlFragment('notes');
    expect(notes.length).toBe(2);
  });

  it('prefixes error with warning emoji', () => {
    handleMergeError(doc, 'Test error');

    const notes = doc.getXmlFragment('notes');
    const paragraph = notes.get(0) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    expect(text.toString()).toContain('⚠️');
  });
});
