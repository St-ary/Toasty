create table app_settings (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
