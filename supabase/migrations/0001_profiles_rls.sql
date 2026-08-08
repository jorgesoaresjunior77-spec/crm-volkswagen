-- ============================================================================
-- CRM Motomecânica — Fase 1: profiles (vendedor + admin) e RLS
--
-- Não apaga nem altera dados de crm_estado. Idempotente: pode rodar mais de
-- uma vez sem duplicar nada (usa "if not exists" / "or replace" / "on conflict").
-- ============================================================================

-- 1) Tabela profiles: uma linha por usuário do Supabase Auth.
--    ADMIN é um booleano em cima do vendedor, não uma conta separada.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text not null default '',
  ativo boolean not null default false,
  is_admin boolean not null default false,
  removido_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 2) Criação automática do perfil quando uma conta é criada (auth.signUp).
--    Roda como trigger (security definer), então não precisa de política de
--    INSERT liberada para usuários comuns.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, ativo, is_admin)
  values (new.id, new.email, false, false)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) Helper: o usuário logado é admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- 4) Políticas RLS de profiles
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select
  using ( id = auth.uid() or public.is_admin() );

drop policy if exists "profiles_update_admin_only" on public.profiles;
create policy "profiles_update_admin_only" on public.profiles
  for update
  using ( public.is_admin() )
  with check ( public.is_admin() );

-- (Sem política de insert para usuários comuns — o trigger cuida disso.
--  Sem política de delete — exclusão é sempre lógica, via removido_em.)

-- 5) Bootstrap: o vendedor já existente vira VENDEDOR + ADMIN.
--    Não cria conta nova, não duplica, não apaga nada — só garante o perfil
--    dele (que já existe em auth.users desde o cadastro original).
insert into public.profiles (id, email, nome, ativo, is_admin)
select u.id, u.email, '', true, true
from auth.users u
where u.email = 'jorgesoaresjunior77@gmail.com'
on conflict (id) do update set ativo = true, is_admin = true;

-- 6) Trava crm_estado com RLS de verdade: só perfil ativo (ou admin) lê/grava.
--    Hoje qualquer pessoa com a chave anon pública consegue ler tudo antes
--    até de logar — isso fecha essa brecha.
alter table public.crm_estado enable row level security;

drop policy if exists "crm_estado_rw" on public.crm_estado;
create policy "crm_estado_rw" on public.crm_estado
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.removido_em is null
        and (p.ativo or p.is_admin)
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.removido_em is null
        and (p.ativo or p.is_admin)
    )
  );
