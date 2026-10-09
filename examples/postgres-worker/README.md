# Postgres and a curator worker

One Postgres database for every tenant, a web kit that answers chats, and a
worker kit that learns from them. This is the setup for an app with several
servers and a job queue. The [storage guide](../../docs/guides/storage.md)
explains each piece.

The demo runs the whole loop in one command:

1. **Session 1 (web).** The owner of a bakery says how they like their posts.
   The web kit replies, then hands a review job to the queue instead of
   reviewing in the request.
2. **Queue.** The job crosses as JSON, like it would cross Redis or SQS.
3. **Curator (worker).** The worker kit validates the job
   (`parseCuratorJob`) and reviews it (`kit.review`). It saves what lasts:
   the owner's style and facts about the business.
4. **Approve.** Memory writes wait for the owner by default (`writeApproval`).
   A settings page would list them from `home.stores()`; the demo approves
   them with `approvePendingWrites`.
5. **Session 2 (web, new chat).** The new chat starts with that memory in its
   prompt and writes a post in the owner's style. The date goes in
   `systemContext`, after the cached part of the prompt.
6. **Another tenant.** A second tenant on the same tables sees none of it.

Both kits run in one process here so the demo is one command. In an app the
web kit runs in your servers, the worker kit in your queue worker, and only
the database and the queue connect them.

## Setup

```bash
cd examples/postgres-worker
cp .env.sample .env
# Set AI_GATEWAY_API_KEY (Vercel AI Gateway): https://vercel.com/ai-gateway
```

Storage is an in-memory [PGlite](https://pglite.dev) unless you set
`DATABASE_URL`. With `DATABASE_URL`, the demo creates agent-kit's tables on
that server (`agent_kit_files`, `agent_kit_sessions`, `agent_kit_messages`).

## Run

```bash
npx nx run-many -t build --projects=core,sessions,ai,sandbox,curator,node  # once
cd examples/postgres-worker && bun start
```

## Test (offline)

```bash
npx nx test example-postgres-worker
```

The test runs the same demo on PGlite with scripted models: no API key, no
network, no server. It also checks that memory survives new kits on the same
database, as after a deploy.

## Layout

- `agents/assistant/` — SOUL and AGENTS for the writing assistant
- `src/db.ts` — PGlite, or `pg` when `DATABASE_URL` is set; creates the tables
- `src/kits.ts` — the web kit (`curatorQueue`) and the worker kit on one `postgresStorage`
- `src/queue.ts` — stand-in for your job queue (jobs as JSON strings)
- `src/demo.ts` — the narrated loop, shared by `main.ts` and the test
- `src/main.ts` — live run with the AI Gateway model
- `src/demo.spec.ts` — offline smoke test

## In your app

- Put `postgresSchemaSql()` in your migrations instead of `ensurePostgresSchema`.
- Pass your driver's client: `fromPg`, `fromPrisma`, `fromPostgresJs`, or `fromPglite`.
- Make `curatorQueue` add a job to your real queue, and call `kit.review(job)`
  from its worker after `parseCuratorJob`.
- Set `curatorModel` on the worker kit to review with a cheaper model.
