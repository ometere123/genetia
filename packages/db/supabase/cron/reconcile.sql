-- Genetia has one scheduler: Supabase Cron. This wakes the Cloudflare
-- orchestration Worker; it never chooses a market outcome or writes funds.
-- Store both values in Supabase Vault as `genetia-reconcile-url` and
-- `genetia-reconcile-secret` before applying this definition.
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
      'x-genetia-reconcile-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'genetia-reconcile-secret')
    ),
    body := jsonb_build_object('source', 'supabase-cron')
  );
  $$
);
