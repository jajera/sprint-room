# Day 2 — Multiplayer Workspace for Agents and Humans

## Theme

Day 2: Build a multiplayer workspace for agents and humans.

Sprint Room is a shared planning room where humans collaborate live and
Sprint AI joins the same session.

## What Was Built

A multiplayer Sprint Room (Vite + PartyKit + Yjs + TipTap) with:

- Shared presence for humans + Sprint AI
- Collaborative notes, raw inputs, clarifications, and sprint packet
- AI actions (Clarify / Plan / Break Down) over HTTP, status via Yjs meta
- Kiro specs + steering (`ai-teammate`, `product`, `tech`) to keep the
  build paced in Kiro

## Deliverables

| File | Purpose |
| ---- | ------- |
| [form-submission.md](form-submission.md) | Paste-ready challenge form fields |
| [builder-center-post.md](builder-center-post.md) | Builder Center article draft + form fields |
| [social-post.md](social-post.md) | Social post draft with tags |
| [video-slideshow.md](video-slideshow.md) | Smoke runbook + silent demo script |
| [captures/](captures/) | Live room stills (John → Zack → inputs → top/bottom) + rebuild script |
| [Demo video](https://youtu.be/zbW7rzgpdpo) | Silent product walkthrough on YouTube |
| [Demo MP4](captures/day-02-multiplayer-workspace-demo.mp4) | Local rebuild source (~60s) |

## Rebuild demo

```bash
cd docs/birthday-2026/day-02-validation/captures && python3 build-demo.py
```

## Submission Checklist

- Public repository: <https://github.com/jajera/sprint-room>
- `.kiro/` folder present
- Demo video: <https://youtu.be/zbW7rzgpdpo>
- Social post: <https://www.linkedin.com/posts/john-ajera_kiro-birthday-week-day-2-multiplayer-workspace-share-7483030275602558977-78vY/>
- Builder Center article URL still needed (`form-submission.md`)
