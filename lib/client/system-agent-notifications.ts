"use client";

/** Qual canal enviou esta notificação — mostra de onde veio sem precisar adivinhar pelo texto do erro. */
export function notificationProvider(metadata: Record<string, unknown> | null | undefined): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  if (metadata.provider === "meta_cloud") return "meta_cloud";
  if (typeof metadata.instance_name === "string" && metadata.instance_name.trim()) return "evolution";
  return null;
}

export function notificationProviderBadge(provider: string | null): { label: string; tone: string } | null {
  if (provider === "meta_cloud") return { label: "API Meta", tone: "bg-sky-500/15 text-sky-300" };
  if (provider === "evolution") return { label: "QR Code", tone: "bg-emerald-500/15 text-emerald-300" };
  return null;
}

/** provider: "meta_cloud" quando a notificação foi enviada pela API Oficial Meta, senão Evolution/QR. */
export function humanizeNotificationError(error: string | null, provider?: string | null): string | null {
  if (!error) return null;
  const isMeta = provider === "meta_cloud";

  const known: Record<string, string> = {
    missing_tenant_owner_phone: "Conta sem telefone de alertas configurado",
    missing_system_instance: "Instância do agente do sistema não configurada",
    invalid_number: "Número de destino inválido",
    meta_provider_not_configured: "API Meta selecionada mas sem credenciais salvas — conecte novamente.",
    meta_not_accepted: "A Meta nunca aceitou o envio (sem ID de mensagem retornado) — tente novamente.",
  };
  if (known[error]) return known[error];

  if (/not in allowed list|recipient.*not.*allow/i.test(error)) {
    return "Número de teste da Meta: esse destinatário não está na lista de números aprovados. Adicione-o em WhatsApp → Configuração da API no painel da Meta, ou conecte o número de produção real.";
  }
  if (error.startsWith("system_instance_not_open:")) {
    const state = error.split(":")[1] ?? "?";
    return `Agente do sistema desconectado (${state})`;
  }
  if (error.startsWith("system_instance_state_check_failed:")) {
    return "Não foi possível verificar o estado do agente do sistema";
  }
  if (error.startsWith("system_session_not_authenticated:")) {
    return "Sessão conectada na API mas sem número WhatsApp ativo (sessão zumbi). Reconecte escaneando o QR.";
  }
  if (error.startsWith("system_session_check_failed:")) {
    return "Não foi possível verificar a sessão na Evolution (fetchInstances). Tente reconectar.";
  }
  if (error === "system_session_not_found_in_evolution") {
    return "Instância não encontrada na Evolution — apague e reconecte pelo painel.";
  }
  if (error === "number_not_on_whatsapp") {
    return "Número de destino não está no WhatsApp";
  }
  if (error === "missing_evolution_message_id") {
    return "Evolution aceitou mas não devolveu ID — envio não confirmado";
  }
  if (error === "delivery_timeout") {
    return "Não houve confirmação de entrega em 60s — mensagem provavelmente não chegou no celular";
  }
  if (error === "whatsapp_nao_confirmou_pending") {
    return isMeta
      ? "Não confirmado: a Meta aceitou o envio mas não confirmou a entrega. Se o número conectado é um número de TESTE (formato +1 555…), ele só entrega para destinatários cadastrados manualmente no painel da Meta."
      : "Não confirmado: o WhatsApp não confirmou o envio (mensagem presa em PENDING). Este número não está entregando via Evolution/Baileys — conecte outro número e teste de novo.";
  }
  if (error === "whatsapp_delivery_failed" || error.startsWith("delivery_status:ERROR")) {
    return isMeta
      ? "A Meta recusou a entrega (ERROR). Verifique se o número é um número de teste (entrega restrita) ou se o token de acesso expirou."
      : "WhatsApp recusou a entrega (ERROR). A sessão do número conectado aqui está degradada na VPS — clique «Reparar sessão» e escaneie o QR de novo com o celular desse número.";
  }
  if (error.startsWith("delivery_status:")) {
    return `${isMeta ? "Meta" : "WhatsApp"} reportou falha na entrega (${error.split(":").slice(1).join(":")})`;
  }

  return error;
}
