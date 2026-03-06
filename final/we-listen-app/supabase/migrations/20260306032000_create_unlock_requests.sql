create extension if not exists pgcrypto;

create table if not exists public.unlock_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id text not null references public.users (id) on delete cascade,
  requester_name text not null,
  partner_id text not null references public.users (id) on delete cascade,
  status text not null default 'pending_partner'
    check (status in ('pending_partner', 'countdown', 'unlocked')),
  countdown_started_at timestamptz,
  requester_agreed_at timestamptz,
  partner_agreed_at timestamptz,
  unlocked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists unlock_requests_requester_id_idx
  on public.unlock_requests (requester_id);

create index if not exists unlock_requests_partner_id_idx
  on public.unlock_requests (partner_id);

create index if not exists unlock_requests_status_idx
  on public.unlock_requests (status);

do $$
begin
  alter publication supabase_realtime add table public.unlock_requests;
exception
  when duplicate_object then null;
end
$$;
