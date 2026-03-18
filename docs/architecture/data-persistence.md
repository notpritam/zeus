# Data Persistence

How Zeus stores sessions, entries, and QA data in SQLite.

**File:** `src/main/services/db.ts`
**Engine:** `better-sqlite3`

---

## Database Location

```
~/.zeus/zeus.db    (or app data directory)
```

---

## Tables

### claude_sessions

Stores Claude session metadata.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Client-generated envelope sessionId |
| `claude_session_id` | TEXT | Real Claude session ID (from stream) |
| `status` | TEXT | `running` / `done` / `error` / `archived` |
| `prompt` | TEXT | Initial prompt |
| `name` | TEXT | Display name |
| `icon` | TEXT | Session icon |
| `color` | TEXT | Session color |
| `notification_sound` | TEXT | Completion sound |
| `working_dir` | TEXT | CWD for the session |
| `qa_target_url` | TEXT | Cached QA target URL |
| `permission_mode` | TEXT | Permission mode used |
| `model` | TEXT | Claude model |
| `started_at` | INTEGER | Epoch ms |
| `ended_at` | INTEGER | Epoch ms |

### claude_entries

Stores every NormalizedEntry for each session.

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Entry UUID (stable across streaming) |
| `session_id` | TEXT FK | References claude_sessions.id |
| `entry_type` | TEXT | JSON discriminated union |
| `content` | TEXT | Display text |
| `metadata` | TEXT | JSON — tool output, files, images |
| `timestamp` | INTEGER | Epoch ms |
| `seq` | INTEGER | Auto-increment order within session |

**Update strategy:** `INSERT OR REPLACE` — same `id` updates in-place (for streaming partial messages).

### terminal_sessions

| Column | Type | Purpose |
|--------|------|---------|
| `id` | TEXT PK | Session UUID |
| `shell` | TEXT | Shell path (/bin/zsh) |
| `status` | TEXT | `active` / `exited` / `killed` |
| `cols` | INTEGER | Terminal width |
| `rows` | INTEGER | Terminal height |
| `cwd` | TEXT | Working directory |
| `started_at` | INTEGER | Epoch ms |
| `ended_at` | INTEGER | Epoch ms |
| `exit_code` | INTEGER | Process exit code |

### qa_agent_sessions

| Column | Type | Purpose |
|--------|------|---------|
| `qa_agent_id` | TEXT PK | Unique QA agent ID |
| `parent_session_id` | TEXT | Parent Claude session |
| `parent_session_type` | TEXT | `claude` / `terminal` |
| `task` | TEXT | Test description |
| `target_url` | TEXT | URL being tested |
| `status` | TEXT | `running` / `done` / `error` / `stopped` |
| `summary` | TEXT | Final test report |
| `started_at` | INTEGER | Epoch ms |
| `ended_at` | INTEGER | Epoch ms |

### qa_agent_entries

| Column | Type | Purpose |
|--------|------|---------|
| `id` | INTEGER PK | Auto-increment |
| `qa_agent_id` | TEXT FK | References qa_agent_sessions |
| `kind` | TEXT | Entry type |
| `content` | TEXT | JSON entry data |
| `timestamp` | INTEGER | Epoch ms |

---

## Validation

Runtime validation at DB boundaries using `src/shared/validators.ts`:

```
Write path:  NormalizedEntry → validateNormalizedEntry() → INSERT (invalid entries logged + skipped)
Read path:   SELECT → parse → validateNormalizedEntry() → return (corrupt rows filtered out)
```

Validators:
- `validateNormalizedEntry(v)` — deep validate entry + nested types
- `validateActionType(v)` — validate tool action discriminant
- `validateToolStatus(v)` — validate string and object status variants
- `assertNormalizedEntry(v)` — throws on invalid (development)
- `safeParseNormalizedEntry(v)` — returns typed entry or null (production)

---

## Pagination

```typescript
getClaudeEntriesPaginated(sessionId, limit, beforeSeq)
```

- Loads most recent N entries by default
- `beforeSeq` enables scroll-up loading (infinite scroll)
- Returns: `{ entries, totalCount, oldestSeq }`

---

## What Is NOT Persisted

- **Base64 screenshot data** — broadcast via WebSocket only, not stored in DB
- **Terminal output** — streamed live, not stored
- **QA agent in-memory state** — `QaAgentRecord` with pending response, collected entries
