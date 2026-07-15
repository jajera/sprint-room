# Day 2 demo captures — Sprint Room

Theme: **Build a multiplayer workspace for agents and humans**

## Keep (product stills + output)

| File | Beat |
| ---- | ---- |
| `room-01-john.png` | John joins (human + Sprint AI) |
| `room-02-multi.png` | Zack joins — multiplayer |
| `room-03-inputs.png` | Shared raw inputs |
| `room-04-top.png` | Long room — top (presence, inputs, clarify) |
| `room-05-bottom.png` | Long room — bottom (tasks, notes, export) |
| `room-06-result.png` | Sprint packet result (goal, scope, tasks) |
| `room-full.png` | Full-page source for crops |
| `day-02-multiplayer-workspace-demo.mp4` | Silent demo |
| `build-demo.py` | Rebuild script |

Optional leftovers (not used in the video): old Kiro/live-room screenshots

## Rebuild

```bash
cd docs/birthday-2026/day-02-validation/captures
python3 build-demo.py
```

Needs `ffmpeg` + Pillow. Intermediates → `_build/` (gitignored).
