import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import SprintPacketPanel from './SprintPacketPanel';

/** Helper: create a Y.Doc with the sprintPacket map pre-initialized */
function createDoc(): Y.Doc {
  const doc = new Y.Doc();
  const sprintPacket = doc.getMap('sprintPacket');
  doc.transact(() => {
    if (!sprintPacket.has('inScope')) {
      sprintPacket.set('inScope', new Y.Array<string>());
    }
    if (!sprintPacket.has('outOfScope')) {
      sprintPacket.set('outOfScope', new Y.Array<string>());
    }
    if (!sprintPacket.has('tasks')) {
      sprintPacket.set('tasks', new Y.Array());
    }
    if (!sprintPacket.has('risksAndDependencies')) {
      sprintPacket.set('risksAndDependencies', new Y.Array<string>());
    }
    if (!sprintPacket.has('assumptions')) {
      sprintPacket.set('assumptions', new Y.Array<string>());
    }
  });
  return doc;
}

/** Helper: seed a sprint packet with data */
function seedPacket(doc: Y.Doc) {
  const sprintPacket = doc.getMap('sprintPacket');
  doc.transact(() => {
    sprintPacket.set('sprintGoal', 'Ship login feature');

    const inScope = sprintPacket.get('inScope') as Y.Array<string>;
    inScope.push(['Email login', 'Password reset']);

    const outOfScope = sprintPacket.get('outOfScope') as Y.Array<string>;
    outOfScope.push(['SSO integration']);

    const tasks = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>>;
    const task1 = new Y.Map<unknown>();
    task1.set('id', 'task-1');
    task1.set('title', 'Implement login form');
    task1.set('description', 'Create the login UI component');
    task1.set('priority', 'high');
    const ac1 = new Y.Array<string>();
    ac1.push(['Form validates email', 'Shows error on invalid credentials']);
    task1.set('acceptanceCriteria', ac1);
    task1.set('subtasks', new Y.Array());
    task1.set('parentTaskId', null);
    tasks.push([task1]);

    const risks = sprintPacket.get('risksAndDependencies') as Y.Array<string>;
    risks.push(['Depends on auth API']);

    const assumptions = sprintPacket.get('assumptions') as Y.Array<string>;
    assumptions.push(['Users have email accounts']);
  });
}

describe('SprintPacketPanel', () => {
  describe('empty state', () => {
    it('renders placeholder when no sprint goal exists', () => {
      const doc = createDoc();
      render(<SprintPacketPanel doc={doc} />);

      expect(screen.getByRole('heading', { name: /sprint packet/i })).toBeDefined();
      expect(screen.getByText(/no sprint packet yet/i)).toBeDefined();
    });

    it('shows sprint goal input in empty state', () => {
      const doc = createDoc();
      render(<SprintPacketPanel doc={doc} />);

      expect(screen.getByLabelText(/sprint goal/i)).toBeDefined();
    });

    it('allows entering a sprint goal in empty state', () => {
      const doc = createDoc();
      render(<SprintPacketPanel doc={doc} />);

      const input = screen.getByLabelText(/sprint goal/i);
      fireEvent.change(input, { target: { value: 'New sprint goal' } });

      const sprintPacket = doc.getMap('sprintPacket');
      expect(sprintPacket.get('sprintGoal')).toBe('New sprint goal');
    });
  });

  describe('populated state', () => {
    it('renders all sections when packet exists', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      expect(screen.getByLabelText(/sprint goal/i)).toHaveProperty('value', 'Ship login feature');
      expect(screen.getByText(/in scope/i)).toBeDefined();
      expect(screen.getByText(/out of scope/i)).toBeDefined();
      expect(screen.getByRole('heading', { name: /tasks/i })).toBeDefined();
      expect(screen.getByText(/risks & dependencies/i)).toBeDefined();
      expect(screen.getByText(/assumptions/i)).toBeDefined();
    });

    it('displays in-scope items', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const inScopeList = screen.getByRole('list', { name: /in scope/i });
      expect(inScopeList).toBeDefined();
      expect(screen.getByDisplayValue('Email login')).toBeDefined();
      expect(screen.getByDisplayValue('Password reset')).toBeDefined();
    });

    it('displays tasks with priority and title', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      expect(screen.getByText('[high]')).toBeDefined();
      expect(screen.getByDisplayValue('Implement login form')).toBeDefined();
    });

    it('displays task acceptance criteria', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      expect(screen.getByDisplayValue('Form validates email')).toBeDefined();
      expect(screen.getByDisplayValue('Shows error on invalid credentials')).toBeDefined();
    });
  });

  describe('editing', () => {
    it('edits sprint goal and writes to Y.Doc', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const input = screen.getByLabelText(/sprint goal/i);
      fireEvent.change(input, { target: { value: 'Updated goal' } });

      const sprintPacket = doc.getMap('sprintPacket');
      expect(sprintPacket.get('sprintGoal')).toBe('Updated goal');
    });

    it('edits an in-scope item and writes to Y.Doc', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const input = screen.getByDisplayValue('Email login');
      fireEvent.change(input, { target: { value: 'OAuth login' } });

      const sprintPacket = doc.getMap('sprintPacket');
      const inScope = sprintPacket.get('inScope') as Y.Array<string>;
      expect(inScope.get(0)).toBe('OAuth login');
    });

    it('adds a new in-scope item', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const addInput = screen.getByLabelText(/new in scope item/i);
      fireEvent.change(addInput, { target: { value: 'Two-factor auth' } });
      fireEvent.submit(screen.getByRole('form', { name: /add in scope item/i }));

      const sprintPacket = doc.getMap('sprintPacket');
      const inScope = sprintPacket.get('inScope') as Y.Array<string>;
      expect(inScope.toArray()).toContain('Two-factor auth');
    });

    it('deletes an in-scope item', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const deleteButton = screen.getByLabelText(/delete in scope item 1/i);
      fireEvent.click(deleteButton);

      const sprintPacket = doc.getMap('sprintPacket');
      const inScope = sprintPacket.get('inScope') as Y.Array<string>;
      expect(inScope.toArray()).not.toContain('Email login');
    });

    it('edits a task title and writes to Y.Doc', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const titleInput = screen.getByDisplayValue('Implement login form');
      fireEvent.change(titleInput, { target: { value: 'Build login UI' } });

      const sprintPacket = doc.getMap('sprintPacket');
      const tasks = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>>;
      expect(tasks.get(0).get('title')).toBe('Build login UI');
    });

    it('edits a task description and writes to Y.Doc', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const descInput = screen.getByLabelText(/task description: implement login form/i);
      fireEvent.change(descInput, { target: { value: 'Revised description' } });

      const sprintPacket = doc.getMap('sprintPacket');
      const tasks = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>>;
      expect(tasks.get(0).get('description')).toBe('Revised description');
    });

    it('edits an acceptance criterion and writes to Y.Doc', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      const acInput = screen.getByDisplayValue('Form validates email');
      fireEvent.change(acInput, { target: { value: 'Form validates email format' } });

      const sprintPacket = doc.getMap('sprintPacket');
      const tasks = sprintPacket.get('tasks') as Y.Array<Y.Map<unknown>>;
      const ac = tasks.get(0).get('acceptanceCriteria') as Y.Array<string>;
      expect(ac.get(0)).toBe('Form validates email format');
    });
  });

  describe('task selection', () => {
    it('calls onSelectTask when a task is clicked', () => {
      const doc = createDoc();
      seedPacket(doc);
      const onSelectTask = vi.fn();
      render(<SprintPacketPanel doc={doc} onSelectTask={onSelectTask} selectedTaskId={null} />);

      const selectButton = screen.getByRole('button', { name: /select task: implement login form/i });
      fireEvent.click(selectButton);

      expect(onSelectTask).toHaveBeenCalledWith('task-1');
    });

    it('deselects task when clicking already-selected task', () => {
      const doc = createDoc();
      seedPacket(doc);
      const onSelectTask = vi.fn();
      render(<SprintPacketPanel doc={doc} onSelectTask={onSelectTask} selectedTaskId="task-1" />);

      const selectButton = screen.getByRole('button', { name: /select task: implement login form/i });
      fireEvent.click(selectButton);

      expect(onSelectTask).toHaveBeenCalledWith(null);
    });

    it('shows visual indicator for selected task', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} selectedTaskId="task-1" />);

      const selectButton = screen.getByRole('button', { name: /select task: implement login form/i });
      expect(selectButton.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('real-time sync', () => {
    it('reflects external Y.Doc changes', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      // Simulate external change (another client)
      act(() => {
        const sprintPacket = doc.getMap('sprintPacket');
        sprintPacket.set('sprintGoal', 'Externally updated goal');
      });

      expect(screen.getByLabelText(/sprint goal/i)).toHaveProperty('value', 'Externally updated goal');
    });

    it('reflects external additions to in-scope array', () => {
      const doc = createDoc();
      seedPacket(doc);
      render(<SprintPacketPanel doc={doc} />);

      act(() => {
        const sprintPacket = doc.getMap('sprintPacket');
        const inScope = sprintPacket.get('inScope') as Y.Array<string>;
        inScope.push(['New external item']);
      });

      expect(screen.getByDisplayValue('New external item')).toBeDefined();
    });
  });
});
