do $$
declare
  tbl text;
  jr_id uuid;
  helena_id uuid;
  helena_email text := 'helena.schneider@motomecanica.com.br';
  velho jsonb;
  qtd_vendas int;
begin
  -- 1) Tabelas normalizadas por vendedor (vendas, propostas, salários, Banco VW,
  --    clientes): coluna vendedor_id (uuid, FK pra profiles) + RLS por linha —
  --    cada vendedor só lê/grava as próprias linhas; admin lê/grava todas.
  foreach tbl in array array['vendas','propostas','salarios','banco_vw','clientes'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id text primary key,
        vendedor_id uuid not null references public.profiles(id),
        dados jsonb not null default '{}'::jsonb,
        atualizado_em timestamptz not null default now()
      );
      alter table public.%1$I enable row level security;
      create index if not exists %1$I_vendedor_id_idx on public.%1$I(vendedor_id);
      drop policy if exists "%1$I_rw" on public.%1$I;
      create policy "%1$I_rw" on public.%1$I
        for all
        using ( vendedor_id = auth.uid() or public.is_admin() )
        with check ( vendedor_id = auth.uid() or public.is_admin() );
    $f$, tbl);
  end loop;

  -- 2) Estado de trabalho pessoal de cada vendedor (painel diário, ponto, humor,
  --    metas, Gerente Smart e prêmio Banco VW em andamento) — uma linha por
  --    vendedor, mesma regra de RLS (só o dono, ou admin).
  create table if not exists public.vendedor_estado (
    vendedor_id uuid primary key references public.profiles(id),
    dados jsonb not null default '{}'::jsonb,
    atualizado_em timestamptz not null default now()
  );
  alter table public.vendedor_estado enable row level security;
  drop policy if exists "vendedor_estado_rw" on public.vendedor_estado;
  create policy "vendedor_estado_rw" on public.vendedor_estado
    for all
    using ( vendedor_id = auth.uid() or public.is_admin() )
    with check ( vendedor_id = auth.uid() or public.is_admin() );

  -- 3) Estado compartilhado da loja (config, política do Gerente Smart, feriados,
  --    documentos, meta Volks, aniversários/postagens/agenda) — mesma regra de
  --    acesso que crm_estado já tinha: qualquer perfil ativo (ou admin).
  create table if not exists public.loja_estado (
    id text primary key default 'loja1',
    dados jsonb not null default '{}'::jsonb,
    atualizado_em timestamptz not null default now()
  );
  alter table public.loja_estado enable row level security;
  drop policy if exists "loja_estado_rw" on public.loja_estado;
  create policy "loja_estado_rw" on public.loja_estado
    for all
    using (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.removido_em is null and (p.ativo or p.is_admin)
      )
    )
    with check (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.removido_em is null and (p.ativo or p.is_admin)
      )
    );

  -- 4) Migração de dados (roda uma única vez — idempotente: se loja_estado já
  --    tiver a linha 'loja1', não faz nada de novo).
  if exists (select 1 from public.loja_estado where id = 'loja1') then
    raise notice 'Migração de dados já foi executada antes (loja_estado já existe) — nada a fazer.';
    return;
  end if;

  select id into jr_id from public.profiles where email = 'jorgesoaresjunior77@gmail.com';
  if jr_id is null then
    raise exception 'Não encontrei o profile do admin (jorgesoaresjunior77@gmail.com). Rode a migration 0001 antes desta.';
  end if;

  select id into helena_id from public.profiles where email = lower(trim(helena_email));
  if helena_id is null then
    raise exception 'Não encontrei nenhum profile com o e-mail "%". Cadastre a Helena primeiro em Administração > Vendedores (ela recebe a senha inicial 000000) e rode esta migration de novo.', helena_email;
  end if;

  select dados into velho from public.crm_estado where id = 'loja1';
  if velho is null then
    raise exception 'Não encontrei a linha loja1 em crm_estado — nada para migrar. Confira se o app já rodou pelo menos uma vez.';
  end if;

  qtd_vendas := jsonb_array_length(coalesce(velho->'vendas', '[]'::jsonb));
  if qtd_vendas <> 2 then
    raise exception 'Esperava encontrar exatamente 2 vendas existentes (confirmadas como da Helena), mas encontrei %. Confira os dados em crm_estado antes de migrar — esta migration não atribui por suposição quando o número não bate com o que foi confirmado.', qtd_vendas;
  end if;

  -- Vendas existentes -> Helena
  insert into public.vendas (id, vendedor_id, dados)
  select coalesce(v->>'id', md5(random()::text || clock_timestamp()::text)), helena_id, (v - 'id' - 'vendedorId')
  from jsonb_array_elements(velho->'vendas') as v
  on conflict (id) do nothing;

  -- Propostas, salários, Banco VW, clientes existentes -> Júnior
  insert into public.propostas (id, vendedor_id, dados)
  select coalesce(p->>'id', md5(random()::text || clock_timestamp()::text)), jr_id, (p - 'id' - 'vendedorId')
  from jsonb_array_elements(coalesce(velho->'propostas', '[]'::jsonb)) as p
  on conflict (id) do nothing;

  insert into public.salarios (id, vendedor_id, dados)
  select coalesce(s->>'id', md5(random()::text || clock_timestamp()::text)), jr_id, (s - 'id' - 'vendedorId')
  from jsonb_array_elements(coalesce(velho->'salarios', '[]'::jsonb)) as s
  on conflict (id) do nothing;

  insert into public.banco_vw (id, vendedor_id, dados)
  select coalesce(b->>'id', md5(random()::text || clock_timestamp()::text)), jr_id, (b - 'id' - 'vendedorId')
  from jsonb_array_elements(coalesce(velho->'bancoVW', '[]'::jsonb)) as b
  on conflict (id) do nothing;

  insert into public.clientes (id, vendedor_id, dados)
  select coalesce(c->>'id', md5(random()::text || clock_timestamp()::text)), jr_id, (c - 'id' - 'vendedorId')
  from jsonb_array_elements(coalesce(velho->'clientes', '[]'::jsonb)) as c
  on conflict (id) do nothing;

  -- Estado pessoal de trabalho de cada um (painel diário, ponto, humor, metas, etc.)
  insert into public.vendedor_estado (vendedor_id, dados)
  values (
    jr_id,
    jsonb_build_object(
      'dias', coalesce(velho#>'{dias}', '{}'::jsonb),
      'ponto', coalesce(velho#>'{ponto}', '{}'::jsonb),
      'humor', coalesce(velho#>'{humor}', '{}'::jsonb),
      'metas', coalesce(velho#>'{metasPorVendedor}', '{}'::jsonb),
      'gerenteEst', coalesce(velho#>'{gerente,est}', '{}'::jsonb),
      'bancoVWEst', coalesce(velho->'bancoVWEst', '{}'::jsonb)
    )
  )
  on conflict (vendedor_id) do nothing;

  insert into public.vendedor_estado (vendedor_id, dados)
  values (
    helena_id,
    jsonb_build_object(
      'dias', '{}'::jsonb, 'ponto', '{}'::jsonb, 'humor', '{}'::jsonb,
      'metas', '{}'::jsonb, 'gerenteEst', '{}'::jsonb, 'bancoVWEst', '{}'::jsonb
    )
  )
  on conflict (vendedor_id) do nothing;

  -- Estado compartilhado da loja (o resto)
  insert into public.loja_estado (id, dados)
  values (
    'loja1',
    jsonb_build_object(
      'config', coalesce(velho->'config', '{}'::jsonb),
      'gerentePolitica', velho#>'{gerente,politica}',
      'gerenteRegrasConfig', velho#>'{gerente,regrasConfig}',
      'gerenteHistorico', coalesce(velho#>'{gerente,historico}', '[]'::jsonb),
      'feriadosCustom', coalesce(velho->'feriadosCustom', '[]'::jsonb),
      'aniversarios', coalesce(velho->'aniversarios', '[]'::jsonb),
      'postagens', coalesce(velho->'postagens', '[]'::jsonb),
      'agenda', coalesce(velho->'agenda', '[]'::jsonb),
      'metasVolks', coalesce(velho->'metasVolks', '{}'::jsonb),
      'documentos', coalesce(velho->'documentos', '{}'::jsonb),
      'vendedorMigrationDone', true
    )
  )
  on conflict (id) do nothing;

  raise notice 'Migração concluída: % venda(s) -> Helena (%), demais dados -> Júnior (%).', qtd_vendas, helena_id, jr_id;
end $$;
