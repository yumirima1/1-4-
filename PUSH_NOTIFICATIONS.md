# Web Push notifications

This site is a plain HTML/JavaScript page. Its timetable and submissions are shared by everyone and are stored in the existing `settings` table (`schedules` and `submissions` JSON values). Push subscriptions are per browser/device; no per-user timetable or Supabase Auth account is assumed. A `user_id` column is reserved for a future authenticated version and remains `NULL` for this shared site.

## 1. Requirements

- Serve the site from its normal HTTPS URL. Web Push and service workers do not work from `file://`.
- Use the same Supabase project currently configured in `index.html`.
- Install the Supabase CLI and sign in with `supabase login`.
- Keep the VAPID private key, service-role key, and cron secret in Supabase secrets/Vault only. Never put them in the HTML or commit them.

The migration creates a `push_subscriptions` table with RLS enabled and no browser read/write access. Only the Edge Functions use its rows. Expired push endpoints are removed after a provider returns 404 or 410.

## 2. Generate VAPID keys and configure the site

Generate one VAPID key pair:

```sh
npx --yes web-push generate-vapid-keys --json
```

The site's VAPID public key is configured in `index.html`. If you rotate the key pair, replace `VAPID_PUBLIC_KEY` there with the new public key. The private key must never be sent to a browser.

Generate a separate secret for the scheduled function:

```sh
openssl rand -hex 32
```

In Supabase Dashboard → Project Settings → Edge Functions → Secrets, set:

| Name | Value |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Generated VAPID public key |
| `VAPID_PRIVATE_KEY` | Generated VAPID private key |
| `VAPID_SUBJECT` | A contact URI, e.g. `mailto:admin@example.com` |
| `PUSH_ALLOWED_ORIGIN` | Exact site origin, e.g. `https://example.github.io` (no path or trailing slash) |
| `PUSH_NOTIFICATION_URL` | Full page URL, including a project path if present, e.g. `https://example.github.io/1-4-/` |
| `PUSH_SERVICE_ROLE_KEY` | This project's service-role/secret key; server-side only |
| `PUSH_CRON_SECRET` | The random value generated above |

`PUSH_ALLOWED_ORIGIN` must match the browser page's origin exactly. The Edge Function's subscription endpoint checks this origin and hashes the per-browser management token before storing it.
For SSRF protection, the subscription endpoint accepts secure endpoints from Google FCM, Mozilla Push, Apple Push, and Windows Notification Services.

## 3. Apply the database migration and deploy

From the repository root:

```sh
supabase link --project-ref kvlruwtidwvopfsphnqc
supabase db push
supabase functions deploy push-subscriptions
supabase functions deploy send-daily-push
```

The repository's `supabase/config.toml` keeps JWT verification enabled for the browser-facing subscription function. The scheduled sender has gateway JWT verification disabled so pg_cron can call it with a random secret; the function itself rejects requests unless the `Authorization: Bearer ...` value matches `PUSH_CRON_SECRET`.

Deploy the updated `index.html`, `sw.js`, and `icon.svg` to the same HTTPS site origin. In `index.html`, the already-configured Supabase URL and public key must be valid for browser use.

## 4. Store cron credentials in Vault and schedule 18:00 JST

In the Supabase SQL Editor, enable `pg_cron`, `pg_net`, and Vault if they are not already enabled. Then store the project URL, browser-safe publishable/anon key, and the same cron secret set above. Do not store the service-role key in this scheduled HTTP request:

```sql
select vault.create_secret(
  'https://kvlruwtidwvopfsphnqc.supabase.co',
  'project_url'
);

select vault.create_secret(
  '<SUPABASE_PUBLISHABLE_OR_ANON_KEY>',
  'publishable_key'
);

select vault.create_secret(
  '<SAME_RANDOM_VALUE_AS_PUSH_CRON_SECRET>',
  'push_cron_secret'
);
```

Schedule the Edge Function at 09:00 UTC, which is 18:00 JST:

```sql
select cron.schedule(
  'daily-timetable-push-jst',
  '0 9 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'project_url'
    ) || '/functions/v1/send-daily-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'publishable_key'
      ),
      'Authorization', 'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'push_cron_secret'
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

To check or remove the scheduled job:

```sql
select jobid, schedule, command
from cron.job
where jobname = 'daily-timetable-push-jst';

select cron.unschedule(jobid)
from cron.job
where jobname = 'daily-timetable-push-jst';
```

The schedule uses PostgreSQL's cron timezone. Supabase hosted databases normally use UTC; verify that before relying on `0 9 * * *`.

## 5. Verify delivery

1. Open the deployed site in a supported browser over HTTPS.
2. Select **通知を設定** and allow notifications. Each browser/device must opt in separately.
3. Confirm that an endpoint was added:

   ```sql
   select id, user_id, created_at, last_notified_for
   from public.push_subscriptions;
   ```

   The endpoint and encryption keys are intentionally not exposed in browser queries.
4. For an immediate test from a trusted terminal, call the function with the same cron secret:

   ```sh
   curl --request POST \
     'https://kvlruwtidwvopfsphnqc.supabase.co/functions/v1/send-daily-push' \
     --header 'apikey: <SUPABASE_PUBLISHABLE_OR_ANON_KEY>' \
     --header 'Authorization: Bearer <PUSH_CRON_SECRET>' \
     --header 'Content-Type: application/json' \
     --data '{}'
   ```

   The target date is calculated as tomorrow in `Asia/Tokyo`.
5. Check the function logs and `cron.job_run_details` after the scheduled run. The function's response includes sent, skipped, removed, and failed counts.
6. Click the notification. The current site tab is focused and navigated to the tomorrow view; otherwise the site opens in a new tab.
7. Select **この端末の通知を解除** to remove that browser's subscription.

On iOS/iPadOS, Web Push requires a supported version and the site to be added to the Home Screen; request permission from the button tap.

## Data compatibility and behavior

- No new timetable or assignment tables are created: the Edge Function reads the existing `settings` rows to avoid duplicating the site's current data.
- Tomorrow's timetable is read from either its `YYYY-MM-DD` key or legacy `MM-DD` key, matching the page's current schedule format. Submissions use their existing month/day fields.
- Every active device receives the same notification. The body includes the next day's schedule and due submissions. Delivery is tracked by target date to skip duplicate scheduled runs.
- An offline browser can display the notification when it reconnects, subject to the push provider's TTL. A browser that has denied permission cannot subscribe.
