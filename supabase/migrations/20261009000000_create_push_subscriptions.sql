create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  manage_token_hash text not null,
  last_notified_for date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

revoke all on table public.push_subscriptions from anon, authenticated;
grant all on table public.push_subscriptions to service_role;

comment on table public.push_subscriptions is
  'Web Push endpoints for this shared class portal. Only Edge Functions may read or change subscriptions.';
