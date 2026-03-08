import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

// ── SQL schema to run once in Supabase SQL Editor ───────────────────────────
//
// create table if not exists users (
//   id         text primary key, // user_id
//   paired_with text,
//   created_at  timestamptz default now()
// );
//
// create table if not exists messages (
//   id           uuid primary key default gen_random_uuid(),
//   sender       text not null,
//   recipient    text,
//   type         text not null,        -- 'private' | 'shared'
//   participants text[],               -- [senderId, partnerId] for shared
//   data         text,                 -- Supabase Storage public URL
//   mime_type    text,
//   duration     int,
//   timestamp    timestamptz default now()
// );
//
// create table if not exists invitations (
//   id         uuid primary key default gen_random_uuid(),
//   "from"     text not null,
//   "to"       text not null,
//   status     text not null default 'pending',   -- 'pending' | 'accepted'
//   created_at timestamptz default now()
// );
//
// create table if not exists unlock_requests (
//   id                   uuid primary key default gen_random_uuid(),
//   requester_id         text not null,
//   partner_id           text not null,
//   status               text not null default 'pending_partner',  -- 'pending_partner' | 'countdown' | 'unlocked'
//   countdown_started_at timestamptz,
//   requester_agreed_at  timestamptz,
//   partner_agreed_at    timestamptz,
//   unlocked_at          timestamptz,
//   created_at           timestamptz default now()
// );
//
// -- Enable Realtime on all four tables in Supabase Dashboard:
// --   Database → Replication → toggle on users, messages, invitations, unlock_requests
//
// -- Storage buckets to create in Supabase Dashboard → Storage:
// --   • recordings  (public)
// --   • biometrics  (public)
