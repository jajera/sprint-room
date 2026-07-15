# Implementation Plan: Sprint Room

## Overview

Build a real-time multiplayer sprint planning workspace: React + TipTap collaborative notes, PartyKit + Yjs for sync/presence, OpenAI structured outputs for one visible AI teammate, client-side markdown/JSON export. Follow the 1-day vertical slice: scaffold → rooms → collaboration → AI → packet UI/export → hardening + demo.

## Tasks

- [x] 1. Scaffold project structure and core types
  - [x] 1.1 Initialize project with Vite, React, TypeScript, and PartyKit
    - Create `package.json` with dependencies: react, react-dom, react-router-dom, @tiptap/react, @tiptap/starter-kit, yjs, y-prosemirror, y-partykit, partykit, nanoid, zod, openai
    - Add dev dependencies: vitest, fast-check, @testing-library/react, msw, happy-dom
    - Create `vite.config.ts`, `tsconfig.json`, `partykit.json`, `.env.example` with `OPENAI_API_KEY`
    - Set up directory structure: `src/client/`, `src/server/`, `src/shared/`
    - _Requirements: 10.4_

  - [x] 1.2 Define shared TypeScript interfaces and types
    - Create `src/shared/types.ts` with: `RoomState` (`id`, `createdAt`, `creatorConnectionId`, `humanCount`, `aiActionInProgress`, `currentAiAction`, `status`), `Participant`, `ClientMessage` (`join` | `ai-action` only — no export message), `ServerMessage` (`room-state` | `participant-joined` | `participant-left` | `ai-status` | `error`), `AwarenessState`, `RoomContext`, `RawInput`, `Clarification`, `ClarifyOutput`, `ClarifyQuestion`, `SprintPacket` (include optional `assumptions`), `Task`, `BreakDownOutput`
    - Create `src/shared/constants.ts`: max 3 humans, AI id `ai_agent` / name `Sprint AI`, nanoid length 10, room expiry 24h, AI abort 28s, presence colors (AI teal `#2A9D8F`, distinct human palette)
    - _Requirements: 1.3, 5.1_

  - [x] 1.3 Create Zod validation schemas for AI outputs
    - Create `src/server/schemas.ts` with Zod schemas for `ClarifyOutput`, `SprintPacket`, `BreakDownOutput`
    - Clarify: `questions` max length 5; each has `id`, `question`, `context`
    - Sprint Packet: non-empty `sprintGoal`; arrays present for in/out scope, tasks, risks; each task has `title` + ≥1 acceptance criterion; optional `assumptions`
    - Break-down: `parentTaskId` + subtasks with descriptions + AC
    - _Requirements: 6.4, 7.1, 8.1, 8.2, 11.1_

- [x] 2. Room creation, joining, and capacity management
  - [x] 2.1 Implement Room Party Server with join/leave and capacity logic
    - Create `src/server/room.server.ts` implementing PartyKit Server interface
    - On first connection: seed AI participant in awareness (`id: ai_agent`, `name: Sprint AI`, `type: ai`, `aiStatus: idle`)
    - Handle `join`: validate name (1–30 chars), enforce max 3 humans, add to room state
    - Handle disconnect: remove human from presence within 5 seconds
    - Reject 4th human with error "Room is full (3 humans + AI)"
    - Track `aiActionInProgress` / `currentAiAction`; reject concurrent AI actions with "AI is busy"
    - Reject rooms older than 24h or unknown with close code `4004`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 4.2, 5.1_

  - [x] 2.2 Write property tests for room ID and capacity
    - Tag format: `Feature: sprint-room, Property {N}: {title}`
    - **Property 1: Room ID uniqueness and format** — batch-generate IDs; assert unique, URL-safe (`[A-Za-z0-9_-]+`), length 10
    - **Property 13: Human capacity** — random join sequences; assert ≤3 humans, AI always present once room active
    - **Validates: Requirements 1.1, 1.3, 5.1**

  - [x] 2.3 Implement landing page with room creation
    - Create `src/client/pages/Home.tsx` with single CTA "Create Room"
    - On click: create room id (`nanoid(10)` via thin client helper or API route), navigate to `/room/{roomId}`
    - No accounts; first WebSocket connect materializes the PartyKit room
    - _Requirements: 1.1, 1.5_

  - [x] 2.4 Implement room join gate and link copy
    - Extend room page: display name input (1–30 chars), connect WebSocket on submit
    - "Copy link" for `{origin}/room/{roomId}`
    - Invalid/expired room: not-found state + "Create new room" CTA (no blank editor)
    - _Requirements: 1.2, 1.4, 1.5, 4.1_

  - [x] 2.5 Write property test for participant join
    - **Property 2: Participant join adds to room state** — random valid names; assert human added with correct name and `type: human`, no account required
    - **Validates: Requirements 1.2**

- [x] 3. Checkpoint — rooms
  - Ensure room/server/unit tests pass; ask the user if questions arise.

- [x] 4. Real-time collaborative editing and raw input
  - [x] 4.1 Set up Yjs document structure and PartyKit provider
    - Create `src/client/hooks/useYDoc.ts` initializing Y.Doc: `Y.Map("meta")`, `Y.Array("rawInputs")`, `Y.Array("clarifications")`, `Y.Map("sprintPacket")` (including `assumptions` array), `Y.XmlFragment("notes")`
    - Create `src/client/hooks/usePartyProvider.ts` with y-partykit provider
    - Reconnect backoff 1s/2s/4s (max 3); show "Reconnecting…" banner; Yjs resyncs on reconnect
    - _Requirements: 3.1, 3.4, 10.1, 10.3_

  - [x] 4.2 Implement raw input contribution component
    - Create `src/client/components/RawInputPanel.tsx` quick-add form
    - On submit: append `Y.Map` to `rawInputs` with `id`, `authorId`, `authorName`, `content`, `timestamp`
    - Show attributable list; concurrent submits preserved via CRDT
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 4.3 Write property test for raw input attribution
    - **Property 3: Raw input attribution** — random (participant, text) pairs; assert identity + content retained
    - **Validates: Requirements 2.2, 2.4**

  - [x] 4.4 Implement TipTap collaborative notes editor with cursors
    - Create `src/client/components/CollaborativeEditor.tsx` bound to `Y.XmlFragment("notes")` via y-prosemirror
    - Human cursor/selection colors only (AI is not a TipTap cursor)
    - Sub-second sync of concurrent edits without data loss
    - Notes are supplementary; not the export source of truth
    - _Requirements: 3.1, 3.2, 3.3, 3.5_

  - [x] 4.5 Implement presence indicators
    - Create `src/client/components/PresenceBar.tsx` for all connected participants
    - Distinguish humans vs Sprint AI (type badge); show AI idle/working (`clarifying` | `planning` | `breaking-down`)
    - Drop disconnected humans within 5 seconds
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.6 Write property test for presence state
    - **Property 6: Presence state correctness** — random humans + AI status; assert identity/type and working vs idle
    - **Validates: Requirements 4.1, 4.3, 4.5**

- [x] 5. Checkpoint — collaboration
  - Ensure collaboration/presence tests pass; ask the user if questions arise.

- [x] 6. AI teammate actions
  - [x] 6.1 Implement context builder from Y.Doc
    - Create `src/server/context-builder.ts` → `buildContext(doc): RoomContext`
    - Include every raw input, every clarification (answered + unanswered), current packet, participant names
    - Packing order: answered clarifications → current packet → raw inputs (newest first) → names → TipTap notes (truncated last)
    - Near context limit: drop oldest raw inputs, then truncate notes; never drop answered clarifications or current packet without noting truncation in `assumptions`
    - _Requirements: 2.5, 5.2, 6.1, 6.3, 7.2, 11.6_

  - [x] 6.2 Write property tests for context builder
    - **Property 4: AI context completeness** — random inputs + clarification answers all present
    - **Property 5: Context accumulation** — growing states retain answers + existing packet
    - **Validates: Requirements 2.5, 5.2, 6.1, 6.3, 7.2, 11.6**

  - [x] 6.3 Implement AI action handler with prompts and OpenAI structured outputs
    - Create `src/server/ai-handler.ts` implementing clarify / plan / breakDown
    - Shared system preamble: ground in room context; do not invent stakeholders/systems/constraints; state assumptions; prefer questions when blocked; concise kickoff language; preserve prior decisions
    - Action-specific instructions per design (clarify ≤5, focus scope/ownership/blockers; plan kickoff-ready packet with `assumptions` if thin; break-down sprint-sized subtasks with AC)
    - Model: `gpt-4o-mini` (or current cost-efficient structured-output model); temperature 0.3 plan/break-down, 0.4 clarify
    - Abort at 28s; OpenAI 5xx → error to room; 429 → up to 2 retries with backoff then error
    - _Requirements: 5.2, 5.3, 6.1, 6.4, 6.5, 7.1, 7.4, 7.5, 8.1, 8.2, 8.5, 10.2, 11.2, 11.3, 11.4, 11.5_

  - [x] 6.4 Implement AI validation and Y.Doc merge logic
    - Validate with Zod before any Y.Doc write; never invent fields on malformed output
    - Clarify: append to `clarifications` (`answer: null`); truncate to ≤5
    - Plan: write `sprintPacket` (goal, scope, tasks, risks, assumptions); preserve task ids when regenerating and titles still match
    - Break-down: attach subtasks under parent; set `parentTaskId`; keep parent task
    - Malformed: reject write, `error` message to room, optional warning in `notes`
    - _Requirements: 6.4, 7.1, 8.1, 8.2, 8.4, 11.1, 11.2, 11.6_

  - [x] 6.5 Write property tests for AI action validation
    - **Property 7: Clarify question limit** — oversized mocks through validator → ≤5
    - **Property 8: Sprint Packet structure completeness** — required sections present
    - **Property 9: Break-down structural completeness** — subtasks have description + AC; parent preserved
    - **Property 12: Action validation** — only `clarify` | `plan` | `break-down` accepted
    - Do not property-test the LLM itself — validators and merge only
    - **Validates: Requirements 6.4, 7.1, 8.1, 8.2, 8.4, 11.1**

  - [x] 6.6 Wire AI action dispatch in Room Party Server
    - Handle `ai-action`: enforce single-flight, set awareness `aiStatus`, call handler, merge into Y.Doc, broadcast `ai-status` idle/working, clear flags
    - All participants can trigger actions; outputs appear as editable shared content for everyone
    - _Requirements: 5.1, 5.3, 5.4, 3.5, 4.5, 10.2_

- [x] 7. Checkpoint — AI
  - Ensure AI handler/validator tests pass (MSW mocks OK); ask the user if questions arise.

- [x] 8. Sprint Packet UI and export
  - [x] 8.1 Implement Sprint Packet editable panel
    - Create `src/client/components/SprintPacketPanel.tsx` bound to `Y.Map("sprintPacket")`
    - Editable: sprint goal, in-scope, out-of-scope, prioritized tasks + AC, risks/dependencies, assumptions
    - Support selecting a task (for Break Down); sync human edits via Y types in real time
    - Export source of truth is this map, not TipTap notes
    - _Requirements: 3.5, 7.3, 7.5, 9.5_

  - [x] 8.2 Implement clarification Q&A panel
    - Create `src/client/components/ClarificationsPanel.tsx` bound to `Y.Array("clarifications")`
    - Show questions + answer inputs; answers write to Y.Doc for later AI context
    - _Requirements: 6.2, 6.3_

  - [x] 8.3 Implement AI action bar UI
    - Create `src/client/components/AIActionBar.tsx`: Clarify, Plan, Break Down
    - Disable while AI working; Break Down disabled without selected task
    - Stay in the same room view (no navigation away from collaborative UI)
    - _Requirements: 5.4, 8.1, 10.2, 10.4_

  - [x] 8.4 Implement client-side export service
    - Create `src/client/export.ts`: `hasPacket`, `toMarkdown`, `toJSON`, `download`
    - Serialize latest `sprintPacket` Y.Map (post human edits); optional notes appendix in markdown only
    - Sections: goal, in-scope, out-of-scope, tasks + AC, risks/dependencies (and assumptions if present)
    - No WebSocket export path
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 8.5 Write property tests for export
    - **Property 10: Markdown export completeness** — all sections match source
    - **Property 11: JSON export round-trip** — parse equals source field values
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.5**

  - [x] 8.6 Implement export controls component
    - Create `src/client/components/ExportControls.tsx` with Markdown + JSON buttons
    - Disable + short explanation when no packet content
    - Download from current Y.Doc client state
    - _Requirements: 9.1, 9.2, 9.4, 9.5_

- [x] 9. Checkpoint — packet and export
  - Ensure packet/export tests pass; ask the user if questions arise.

- [x] 10. Integration, wiring, and hardening
  - [x] 10.1 Compose full Room view layout
    - Create `src/client/pages/RoomView.tsx`: PresenceBar, RawInputPanel, ClarificationsPanel, SprintPacketPanel, CollaborativeEditor, AIActionBar, ExportControls
    - Single continuous view — no wizard
    - Layout: header (brand/title + copy link + presence) → main (inputs, clarifications, packet, notes) → sidebar (AI actions + export)
    - _Requirements: 10.1, 10.4_

  - [x] 10.2 Implement client-side routing
    - React Router: `/` (Home), `/room/:roomId` (join gate → RoomView)
    - _Requirements: 10.1_

  - [x] 10.3 Add error handling and edge cases
    - WS disconnect banner + backoff reconnect
    - AI timeout toast "AI took too long — try again"; reset local working state
    - Room full / invalid room / empty export / name validation per design error tables
    - _Requirements: 1.4, 9.4, 10.1, 10.2, 10.3_

  - [x] 10.4 Write integration tests for happy path
    - create → join → input → clarify → plan → edit → export with MSW-mocked OpenAI
    - Two-client Yjs concurrent edits; presence AI working transitions; WS reconnect
    - _Requirements: 10.1, 10.4_

  - [x] 10.5 Smoke tests
    - Room create yields valid id; WS handshake for valid room; editor mounts; export non-empty when packet exists
    - _Requirements: 1.1, 9.1, 10.1_

- [x] 11. Final checkpoint — demo ready
  - Run full test suite; verify happy path manually with two browsers
  - Rehearse 90s demo script from design (create → join → inputs → clarify → plan → edit/break-down → export)
  - Confirm success criteria: usable export with goal, tasks, and acceptance criteria
  - Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP day
- Each task cites requirements for traceability
- Checkpoints gate incremental validation
- Property tests cover the **13** correctness properties in design.md via fast-check (≥100 iterations); tag `Feature: sprint-room, Property {N}: {title}`
- Unit/integration tests cover examples, edge cases, and MSW-mocked AI
- TypeScript throughout; PartyKit server + React/TipTap client
- AI outputs validated with Zod before Y.Doc writes; export is client-side only
- Yjs CRDT handles conflict resolution; TipTap `notes` are not the Sprint_Packet source of truth
- Out of scope for this plan: auth, DB persistence, PM integrations, roles, analytics, multi-agent

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.3", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.5", "4.2", "4.4", "4.5"] },
    { "id": 4, "tasks": ["4.3", "4.6", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3"] },
    { "id": 6, "tasks": ["6.4", "6.5"] },
    { "id": 7, "tasks": ["6.6", "8.1", "8.2", "8.4"] },
    { "id": 8, "tasks": ["8.3", "8.5", "8.6"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3", "10.4", "10.5"] }
  ]
}
```
