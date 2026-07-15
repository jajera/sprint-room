# Day 2: Build a multiplayer workspace for agents and humans

Paste-ready fields for AWS Builder Center article submission.

---

## Builder Center form fields

### Title

```text
Day 2: Build a multiplayer workspace for agents and humans
```

### Description

```text
Day 2 of Kiro Birthday Week: Sprint Room — a multiplayer planning workspace where humans and Sprint AI share one live room, presence, notes, and an AI-built sprint packet.
```

### Tags

- `kiro` / `BuildWithKiro` (if available)
- `developer-tools`
- `generative-ai` / `amazon-bedrock`
- `real-time` / `collaboration`

### Body

---

## Article body

Kiro Birthday Week Day 2 asks for a **multiplayer workspace for agents and humans**. Sprint Room is that workspace: a shared sprint planning room where people join with a name, see each other in presence, and work beside Sprint AI in the same session.

### What you get in the room

- Live presence (humans + Sprint AI)
- Collaborative notes (TipTap + Yjs)
- Shared raw inputs, clarifications, and sprint packet
- AI Clarify / Plan / Break Down with Bedrock
- Export to Markdown, JSON, PRD, GitHub Issues, Checklist

### How Kiro drove the build

Specs under `.kiro/specs/sprint-room/` and steering under `.kiro/steering/` kept the multiplayer build focused and consistent.

### Demo

Silent walkthrough: [https://youtu.be/zbW7rzgpdpo](https://youtu.be/zbW7rzgpdpo)

Local MP4 (rebuild source): [`captures/day-02-multiplayer-workspace-demo.mp4`](captures/day-02-multiplayer-workspace-demo.mp4)

Rebuild:

```bash
cd docs/birthday-2026/day-02-validation/captures && python3 build-demo.py
```

### Try it

Repo: <https://github.com/jajera/sprint-room>

```bash
npm run partykit:dev   # terminal 1
npm run dev            # terminal 2
# open http://localhost:5173 — create/join a room
```
