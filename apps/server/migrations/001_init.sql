create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  auth_key_hash text not null,
  kdf_salt text not null,
  kdf_iterations integer not null,
  wrapped_vault_key text not null,
  recovery_wrapped_vault_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table vault_items (
  id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  ciphertext text not null,
  iv text not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index vault_items_user_updated_idx on vault_items (user_id, updated_at);
