# Database migration authority

Genetia uses Supabase Postgres as its database and Prisma as the authoritative
application-schema migration tool. The Prisma migrations under
`packages/db/prisma/migrations/` define application tables, indexes, foreign
keys, and constraints; the Prisma Client is generated from the same schema.

The root `supabase/migrations/` directory contains only platform scheduling
configuration. `20260910000000_genetia_reconciliation_cron.sql` installs
`pg_cron`/`pg_net` and schedules the authenticated reconciliation wake-up. It
does not define application tables and must be applied only after the
application schema is available. Vault entries named
`genetia-reconcile-url` and `genetia-reconcile-secret` are required; values are
never stored in Git.

## Safe remote order

1. Inspect the linked project and existing public schema read-only.
2. Apply the Prisma application migrations with `prisma migrate deploy` using
   the confirmed Supabase Postgres connection.
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
The expected Prisma tables are not present. Because existing legacy schema/data
was found, Prisma deployment and the Cron migration are intentionally blocked
until an authorized migration/isolation decision is made; no remote rows or
migration history are modified by this repository.
