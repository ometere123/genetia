-- Canonical scheduler for Genetia. Apply only after storing these Vault secrets:
-- genetia-reconcile-url and genetia-reconcile-secret.
-- This job only wakes idempotent orchestration; it cannot choose outcomes.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'genetia-reconcile-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'genetia-reconcile-url'),
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-genetia-reconcile-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'genetia-reconcile-secret'),
      'x-genetia-reconcile-id', to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    ),
    body := jsonb_build_object('source', 'supabase-cron')
  );
  $$
);
