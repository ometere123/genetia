# Database migration authority and schema isolation

Genetia uses Supabase Postgres as its database and Prisma as the authoritative
application-schema migration tool. The Prisma migrations under
`packages/db/prisma/migrations/` define application tables, indexes, foreign
keys, and constraints; the Prisma Client is generated from the same schema.

The schemas are intentionally isolated:

- `public` is preserved legacy state and is not used by the fresh Genetia
  runtime. Existing legacy tables and rows are not renamed, migrated, or
  modified.
- `genetia_app` is the only PostgreSQL schema for fresh Genetia application
  models, enums, projections, and indexed data.
- Prisma is the authority for the `genetia_app` application schema.
- The Cloudflare API accesses application data through repositories/Hyperdrive;
  the Supabase Data API is not the application boundary.

The root `supabase/migrations/` directory contains only platform scheduling
configuration. `20260910000000_genetia_reconciliation_cron.sql` installs
`pg_cron`/`pg_net` and schedules the authenticated reconciliation wake-up. It
does not define application tables and must be applied only after the
application schema is available. Vault entries named
`genetia-reconcile-url` and `genetia-reconcile-secret` are required; values are
never stored in Git.

All raw SQL in the runtime must qualify fresh tables with
`genetia_app."TableName"`; it must not rely on an ambient `search_path` or an
unqualified name that could resolve to a legacy `public` table.

## Safe remote order

1. Inspect the linked project and existing public schema read-only.
2. Apply the Prisma application migrations with `prisma migrate deploy` using
   the confirmed Supabase Postgres connection. The migrations first create
   `genetia_app` and pin their session to it; they do not create fresh tables
   in `public`.
3. Verify tables, indexes, foreign keys, constraints, and migration history.
4. Store the two scheduler values in Supabase Vault through a secure channel.
5. Apply the root Supabase Cron migration and verify the one-minute schedule.

No `db reset --linked` operation is permitted. The Cron migration is additive
to the application schema and does not contain financial records.

## Remote inspection status

The linked `genetia` project was inspected read-only with Supabase CLI
2.116.0. Its remote migration history is empty, but its `public` schema is not
empty: legacy tables including `arc_trades`, `circle_wallets`, `wallet_balances`,
`wallet_transactions`, `bets`, `markets`, `positions`, and `settlements` exist.
The expected Prisma tables are not present. The existing `public` schema/data
is preserved legacy state. The authorized fresh deployment target is therefore
`genetia_app`; no remote rows or migration history have been modified by this
repository yet. The Cron migration remains blocked until its real authenticated
Cloudflare reconciliation target exists; it must not schedule requests to a
placeholder URL.

## Local validation

Prisma schema validation and an empty-database migration diff must be run with
the project-pinned Prisma 5.22.0 CLI before remote deployment. A local
PostgreSQL server is required for a full zero-to-current execution test; Docker
is not introduced by this repository. The generated diff must show
`genetia_app` schema-qualified objects and no `public` application objects.
