# Sprint Room — tech steering

## Stack

- Vite + React client
- PartyKit room server + y-partykit (Yjs)
- TipTap collaborative notes
- Amazon Bedrock Converse (`aws4fetch`) — default `amazon.nova-lite-v1:0`

## Protocol rules (critical)

**Do not send custom JSON on the Yjs WebSocket.** That corrupts the CRDT.

| Concern | Channel |
| -------- | --------- |
| Join / capacity | WebSocket URL `?name=` |
| AI actions | HTTP `POST /parties/main/{roomId}` body `{ type: 'ai-action', action }` |
| AI status / errors | `Y.Map("meta")` → `aiStatus`, `lastError` |
| Doc content | Yjs binary sync only |

## Local AWS credentials

PartyKit’s worker cannot read `~/.aws`. Always start with:

```bash
AWS_PROFILE=<profile> npm run partykit:dev
```

This writes resolved keys to gitignored `.env.local` for the worker.

## Validation

AI tool outputs must pass Zod (`src/server/schemas.ts`) before merge. Coerce Bedrock quirks (e.g. empty `parentTaskId` → null). Never delete answered clarifications on re-clarify.
