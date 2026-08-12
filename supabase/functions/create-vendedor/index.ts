// Edge Function: create-vendedor
//
// Cria um vendedor de ponta a ponta: usuário no Supabase Auth (já confirmado,
// sem precisar de e-mail de verificação) + o profile correspondente.
//
// Só pode ser chamada por um usuário autenticado cujo profile tenha is_admin=true.
// A service_role key só existe aqui dentro (variável de ambiente da function),
// nunca é enviada ao navegador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const callerToken = authHeader.replace(/^Bearer\s+/i, "");
    if (!callerToken) {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }

    // Cliente "como o chamador", só para descobrir quem está chamando.
    const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerErr } = await callerClient.auth.getUser(callerToken);
    if (callerErr || !callerData?.user) {
      return jsonResponse({ error: "Sessão inválida ou expirada." }, 401);
    }

    // Cliente com service_role: bypassa RLS, só usado depois de confirmar que
    // quem chamou é admin de fato.
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: callerProfile, error: callerProfileErr } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", callerData.user.id)
      .maybeSingle();
    if (callerProfileErr || !callerProfile?.is_admin) {
      return jsonResponse({ error: "Apenas administradores podem criar vendedores." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const nome = typeof body.nome === "string" ? body.nome.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const telefone = typeof body.telefone === "string" ? body.telefone.trim() : "";
    // Senha inicial é sempre fixa — o vendedor é obrigado a trocá-la no
    // primeiro acesso (deve_trocar_senha=true abaixo). O cliente nunca define
    // a senha de outro usuário.
    const senha = "000000";

    if (!email) {
      return jsonResponse({ error: "Preencha o email do vendedor." }, 400);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true, // já nasce confirmado: login funciona na hora, sem clicar em link nenhum.
      user_metadata: { nome },
    });
    if (createErr) {
      return jsonResponse({ error: createErr.message }, 400);
    }

    // O trigger on_auth_user_created já deve ter inserido a linha em profiles
    // (inativa, por padrão). O upsert garante nome/email/ativo mesmo se o
    // trigger não existir ou já tiver rodado.
    const { error: upsertErr } = await admin
      .from("profiles")
      .upsert(
        { id: created.user.id, email, nome, telefone, ativo: true, deve_trocar_senha: true },
        { onConflict: "id" },
      );
    if (upsertErr) {
      return jsonResponse({ error: upsertErr.message }, 400);
    }

    return jsonResponse({ ok: true, id: created.user.id });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : "Erro inesperado." }, 500);
  }
});
