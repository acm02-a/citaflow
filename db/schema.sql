-- CitaFlow — esquema para Supabase / Postgres.
-- Pega esto en el SQL Editor de Supabase para la migración desde el store JSON.

create table if not exists tenants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text unique not null,
  timezone     text not null default 'America/Lima',
  hours        jsonb not null default '{"1":"09:00-19:00","2":"09:00-19:00","3":"09:00-19:00","4":"09:00-19:00","5":"09:00-19:00","6":"09:00-13:00"}',
  slot_minutes int  not null default 30,
  avg_ticket   int  not null default 80,
  services     jsonb not null default '["consulta"]',
  address      text,
  plan         text not null default 'trial',
  whatsapp_phone_id text,
  created_at   timestamptz not null default now()
);

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  password_hash text not null,
  salt          text not null,
  tenant_id     uuid not null references tenants(id) on delete cascade,
  created_at    timestamptz not null default now()
);

create table if not exists appointments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  patient_name  text not null,
  patient_phone text not null,
  service       text,
  starts_at     timestamptz not null,
  status        text not null default 'confirmed'
    check (status in ('pending','confirmed','cancelled','done','no_show')),
  reminded_at   timestamptz,
  patient_confirmed boolean not null default false,   -- confirmó por WhatsApp
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique (tenant_id, starts_at)               -- anti doble-reserva a nivel DB
);
create index if not exists idx_appts_tenant_time on appointments(tenant_id, starts_at);

create table if not exists conversations (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  phone      text not null,
  history    jsonb not null default '[]',
  pending    jsonb,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);
