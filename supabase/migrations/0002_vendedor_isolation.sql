-- ============================================================================
-- CRM Motomecânica — Fase 2: isolamento de dados por vendedor
--
-- Não apaga nem altera dados existentes de crm_estado ou profiles. Idempotente:
-- pode rodar mais de uma vez sem duplicar nada ("if not exists" / "or replace").
-- ============================================================================

-- 1) Telefone do vendedor (usado no cadastro feito pelo ADMIN e nos cards de
--    proposta). Coluna nova, nula por padrão — não apaga nem altera vendedores
--    já cadastrados sem telefone.
alter table public.profiles add column if not exists telefone text;

-- 2) Obriga troca de senha no primeiro acesso. Todo vendedor já existente
--    recebe "false" (não é incomodado) — só vendedores criados a partir de
--    agora (via edge function create-vendedor) nascem com "true".
alter table public.profiles add column if not exists deve_trocar_senha boolean not null default false;

-- 3) Permite que o PRÓPRIO vendedor confirme que já trocou a senha obrigatória
--    do primeiro login, sem precisar de permissão de admin. Roda como
--    security definer e só toca a própria linha do usuário autenticado
--    (auth.uid()) — não abre uma política de self-update genérica que
--    permitiria a um vendedor comum alterar is_admin/ativo/etc.
create or replace function public.marcar_senha_trocada()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set deve_trocar_senha = false, updated_at = now()
  where id = auth.uid();
end;
$$;

grant execute on function public.marcar_senha_trocada() to authenticated;
