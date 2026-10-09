# Storage

A tenant home keeps durable state for one tenant: agent files (`agent/`),
memory (`memories/`), skills (`skills/`), pending writes (`pending/`), and
chat transcripts. A **storage adapter** decides where that state lives.

| Adapter | Package | Use it when |
| ------- | ------- | ----------- |
| AgentFS (default) | `@socialrobot-io/agent-kit-node` | One process serves each tenant. You want a persistent bash `/workspace`. |
| Postgres | `@socialrobot-io/agent-kit-node/postgres` | Several processes or machines serve the same tenant (web servers, queue workers). |
| Your own | any | You have another store. Implement the contract below. |

## AgentFS (default)

With no `storage` option, each tenant gets one AgentFS SQLite file at
`${dataDir}/tenants/${tenantId}.db`. Transcripts are files on the same
volume. The bash sandbox keeps `/workspace` there too.

AgentFS takes an exclusive lock on the file, so one process opens a volume at
a time. That suits one server with a persistent disk.

```ts
createAgentKit({ agent, dataDir: "/var/lib/agents" });
```

`volumePath` names one file for one tenant. A second tenant on the same path
throws. Use `dataDir` (or `agentFsStorage({ volumePath: (id) => ... })`) for
many tenants.

## Postgres

Every tenant shares three tables, and every row has a `tenant_id`. Any
process that connects to the database can serve any tenant.

```ts
import pg from "pg";
import { createAgentKit } from "@socialrobot-io/agent-kit-node";
import { fromPg, postgresStorage } from "@socialrobot-io/agent-kit-node/postgres";

const db = fromPg(new pg.Pool({ connectionString: process.env.DATABASE_URL }));

export const kit = createAgentKit({
  agent,
  storage: postgresStorage({ db }),
  sandbox: false,
});
```

1. Create the tables. See [Tables](#tables).
2. Pass a client from your driver. See [Drivers](#drivers).
3. Set `sandbox: false` unless you need bash. With Postgres storage the bash
   `/workspace` lives in process memory. It is lost on restart and is not
   shared across processes. With `sandbox: false` the kit does not load
   AgentFS or its native binding.

| Kit state | Table |
| --------- | ----- |
| Agent files, memory, skills, pending writes | `agent_kit_files` |
| Chat sessions | `agent_kit_sessions` |
| Transcript messages | `agent_kit_messages` |

Each store object is bound to one tenant, and every statement filters on it.
A call that names another tenant returns no rows, or throws for a write.

### Drivers

The subpath has no database driver dependency. Create the client once at
module scope and reuse it.

| Driver | Wrap with |
| ------ | --------- |
| `pg` (node-postgres) `Pool` | `fromPg(pool)` |
| `@neondatabase/serverless` `Pool` | `fromPg(pool)` |
| Prisma `PrismaClient` | `fromPrisma(prisma)` |
| `postgres` (postgres.js) | `fromPostgresJs(sql)` |
| `@electric-sql/pglite` | `fromPglite(db)` (tests, single-process tools) |

Another driver needs a small `SqlClient`: a `query(text, params)` that returns
rows, and a `transaction(fn)` that runs `fn` on one connection.

Prisma runs interactive transactions with a timeout. `fromPrisma` uses 20
seconds by default. Keep it above `lockTimeoutMs` (10 seconds by default).

### Tables

`postgresSchemaSql()` returns the DDL. Every statement is idempotent
(`IF NOT EXISTS`). Put it in your migrations:

```ts
import { postgresSchemaSql } from "@socialrobot-io/agent-kit-node/postgres";
console.log(postgresSchemaSql().join(";\n\n") + ";");
```

For development, `postgresStorage({ db, ensureSchema: true })` creates the
tables on first open. Processes that boot at the same time do not race:
schema creation takes a lock.

| Option | Default | Effect |
| ------ | ------- | ------ |
| `prefix` | `agent_kit` | Table names are `${prefix}_files`, `${prefix}_sessions`, `${prefix}_messages` |
| `schema` | none | Put the tables in this Postgres schema |
| `lockTimeoutMs` | `10000` | Max wait for the tenant lock before an edit fails |
| `ensureSchema` | `false` | Create the tables on first open |

The tables use plain columns, composite primary keys, and btree indexes. No
extension is needed, so ORMs can model them. Model them in your ORM schema:
a migration tool that does not know the tables can try to drop them. This
Prisma model matches the DDL exactly (`prisma migrate diff` reports no
changes):

```prisma
model AgentKitFile {
  tenantId  String   @map("tenant_id")
  path      String
  content   String
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamptz(6)

  @@id([tenantId, path])
  @@map("agent_kit_files")
}

model AgentKitSession {
  tenantId  String   @map("tenant_id")
  id        String
  source    String
  createdAt DateTime @map("created_at") @db.Timestamptz(6)
  messages  AgentKitMessage[]

  @@id([tenantId, id])
  @@index([tenantId, createdAt(sort: Desc)], map: "agent_kit_sessions_recent_idx")
  @@map("agent_kit_sessions")
}

model AgentKitMessage {
  tenantId  String          @map("tenant_id")
  sessionId String          @map("session_id")
  id        String
  seq       BigInt          @default(autoincrement())
  role      String
  content   String
  toolCalls Json?           @map("tool_calls")
  createdAt DateTime        @map("created_at") @db.Timestamptz(6)
  session   AgentKitSession @relation(fields: [tenantId, sessionId], references: [tenantId, id], onDelete: Cascade, onUpdate: NoAction)

  @@id([tenantId, sessionId, id])
  @@index([tenantId, sessionId, seq], map: "agent_kit_messages_scroll_idx")
  @@index([tenantId, createdAt(sort: Desc)], map: "agent_kit_messages_recent_idx")
  @@map("agent_kit_messages")
}
```

### Concurrent edits

Memory and skill edits read a file, change it, and write it back. When two
processes do that at the same time, one change can be lost. The Postgres
volume implements `exclusive` (see below):

1. A queue per client and tenant. One pool waits on at most one connection
   per tenant.
2. A transaction with `pg_advisory_xact_lock` for the tenant. Other processes
   wait at that statement.
3. Reads and writes inside the section run on that transaction. A failed
   section rolls back its writes.

The memory store and the skill library (`create` and `patch`) use it. With
AgentFS the same calls use a queue in the process. Plain reads and writes
outside a section do not lock. A wait longer than `lockTimeoutMs` fails with
a Postgres lock timeout error.

### Transcripts and search

`session_search` finds a message when it contains the query (case does not
matter), or when it has all the query words in any order. Hits are newest
first. Search reads the messages of one tenant, which is fast for thousands
of messages per tenant. For more, add an index that suits your queries and
your own `TranscriptStore`.

The kit does not save chat messages for you. Call `kit.recordTurn` after each
turn with the user message and the reply. It also hands the turn to the
curator. Use stable message ids: a second save of the same id does nothing.
See [Hosting](hosting.md#save-turns-for-search-and-review).

### Retention and deletion

| Function | Use |
| -------- | --- |
| `deletePostgresTenant(db, tenantId)` | Delete all files and transcripts of one tenant |
| `prunePostgresTranscripts(db, { inactiveBefore })` | Delete sessions with no activity since a date |
| `transcripts.deleteSession(id)` | Delete one session and its messages |

### Tests

The Postgres specs run on PGlite, so they work offline. Set
`AGENT_KIT_TEST_DATABASE_URL` to also run them against a real server, with
the multi-process lock tests:

```bash
AGENT_KIT_TEST_DATABASE_URL=postgres://user:pass@localhost:5432/test npx nx test node
```

## Run the curator in a worker

By default the curator reviews each turn in the process that served it. On
serverless hosts, or to keep model calls off the web tier, give the kit a
queue:

```ts
// web process
export const kit = createAgentKit({
  agent,
  storage: postgresStorage({ db }),
  sandbox: false,
  curatorQueue: (job) => queue.add("curator", job),
});
```

```ts
// worker process: same agent, same storage
const kit = createAgentKit({
  agent,
  storage: postgresStorage({ db }),
  sandbox: false,
  curatorModel: "anthropic/claude-haiku-4-5", // a cheaper review model
});

new Worker("curator", (job) => kit.review(job.data));
```

A `CuratorJob` is plain JSON: the tenant, the chat id, and the conversation
text. It carries no policy. The worker's agent definition decides the mode,
`autoApprove`, and write approval, so a job in the queue cannot widen what the
curator may write. `kit.review` checks the job shape, and every memory or
skill write is threat-scanned.

You can also make jobs yourself for events outside a chat, for example "the
user edited a draft before posting it". Build a short conversation that
describes the event and pass it to `kit.review`.

`curatorQueue` needs shared storage. With AgentFS the worker cannot open the
volume while the web process holds it.

[`examples/postgres-worker`](../../examples/postgres-worker) runs this loop end
to end: a web kit, a JSON queue, a worker kit, approval, and a second chat.

## Write your own adapter

A storage adapter has two methods:

```ts
import type { StorageAdapter } from "@socialrobot-io/agent-kit-node";

const storage: StorageAdapter = {
  // Homes with the same key share one cache entry per process.
  // Two tenants must never share a key.
  key: (tenantId) => `mystore:${tenantId}`,
  async open(tenantId) {
    return {
      volume: openVolumeFor(tenantId), // AgentFsLike with deleteFile
      transcripts: openTranscriptsFor(tenantId), // optional TranscriptStore
      location: `mystore:${tenantId}`, // for logs
    };
  },
};
```

The volume contract (`AgentFsLike` in core):

| Method | Must |
| ------ | ---- |
| `readFile(path)` | Return the text, or `null` when the file is missing. Never throw for a missing file. |
| `writeFile(path, content)` | Create or replace the file. |
| `list(dir)` | Return the names of direct children (files and directories), or `[]` when the directory is missing. |
| `deleteFile(path)` | Delete the file. Do nothing when it is missing. |
| `rename(from, to)` | Optional. Used by file-based transcripts. |
| `exclusive(fn)` | Optional. Run `fn` while no other section for this tenant runs, in any process. Calls inside `fn` must not wait for that lock. |

Paths are POSIX-style and relative to the tenant root. Directories are
implicit. Implement `exclusive` when more than one process can write the
same tenant. Without it, the kit uses a queue in the process.

Omit `transcripts` to keep transcripts as files on the volume
(`FileTranscriptStore`). A database store should implement the optional
`getSession` (a point lookup) and honor the optional `limit` of
`listSessions`.

Isolation rules for any adapter:

1. `open(tenantId)` returns objects bound to that tenant. Every read and
   write filters on it.
2. A call that names another tenant (for example `search(otherTenant, …)`)
   returns nothing.
3. Take `tenantId` from your auth layer, never from the request body alone.
