export type ExplainableAuditEvent = {
  module: string;
  action: string;
  status: string;
  severity: string;
  is_critical: boolean;
  actor_type: string;
  result_code: string | null;
  resource_type?: string | null;
  channel?: string | null;
  integration?: string | null;
  metadata?: Record<string, unknown>;
};

export type OperationalAuditExplanation = {
  title: string;
  summary: string;
  impact: string;
  recommendedAction: string;
  moduleLabel: string;
  moduleDescription: string;
  actionLabel: string;
  statusLabel: string;
  statusDescription: string;
  severityLabel: string;
  actorLabel: string;
  resultLabel: string;
};

const MODULES: Record<string, { label: string; description: string; subject: string }> = {
  "admin.audit": { label: "Auditoria administrativa", description: "Consultas, exportações e manutenção deste histórico operacional.", subject: "a auditoria operacional" },
  "auth.admin": { label: "Acesso administrativo", description: "Entradas, saídas e tentativas de acesso ao painel administrativo.", subject: "o acesso administrativo" },
  "runtime.watchdog": { label: "Monitoramento dos agentes", description: "Verificação automática da saúde das filas, crons e processos que mantêm os agentes funcionando.", subject: "o monitoramento dos agentes" },
  "webhook.evolution": { label: "Entrada Evolution", description: "Evento recebido da Evolution e salvo para processamento seguro.", subject: "uma entrada da Evolution" },
  "webhook.meta": { label: "Entrada Meta", description: "Evento recebido da Meta e salvo para processamento seguro.", subject: "uma entrada da Meta" },
  "evolution.webhook.inbox": { label: "Fila de mensagens Evolution", description: "Etapas do recebimento e processamento das mensagens que chegam pela Evolution.", subject: "uma mensagem recebida pela Evolution" },
  "meta.lead.events": { label: "Fila de leads da Meta", description: "Etapas do recebimento e processamento de cadastros vindos dos formulários da Meta.", subject: "um lead recebido da Meta" },
  "tenant.agents": { label: "Configuração de agente", description: "Alterações feitas na configuração de um agente do cliente.", subject: "a configuração de um agente" },
  "agent.response.jobs": { label: "Resposta do agente", description: "Fila responsável por preparar e processar a resposta automática do agente.", subject: "uma resposta do agente" },
  "agent.outbound.outbox": { label: "Envio automático", description: "Fila segura que autoriza e envia mensagens automáticas ao provedor correto.", subject: "um envio automático" },
  "follow.up.jobs": { label: "Follow-up do agente", description: "Fila que controla tentativas de acompanhamento configuradas pelo operador.", subject: "um follow-up" },
  "agent.followup.events": { label: "Histórico de follow-up", description: "Registro do resultado de uma tentativa de acompanhamento do agente.", subject: "um evento de follow-up" },
  "agenda.reminder.jobs.v2": { label: "Lembrete de agenda", description: "Fila dos lembretes de compromissos configurados no agente.", subject: "um lembrete de agenda" },
  "agenda.events": { label: "Compromisso da agenda", description: "Criação ou alteração de um compromisso na agenda do MyChatCRM.", subject: "um compromisso" },
  "agenda.mutation.operations": { label: "Operação de agenda", description: "Controle seguro de criação, remarcação ou cancelamento de compromisso.", subject: "uma operação de agenda" },
  "agent.agenda.pending.actions": { label: "Confirmação de agenda", description: "Ação de agenda aguardando confirmação ou conclusão.", subject: "uma ação de agenda" },
  "agenda.notification.outbox": { label: "Notificação de agenda", description: "Fila segura das notificações relacionadas a compromissos.", subject: "uma notificação de agenda" },
  "agenda.sync.outbox": { label: "Sincronização da agenda", description: "Fila que sincroniza compromissos com o calendário externo.", subject: "uma sincronização de agenda" },
  "whatsapp.messages": { label: "Mensagem de WhatsApp", description: "Mensagem recebida, enviada ou atualizada em uma conversa.", subject: "uma mensagem de WhatsApp" },
  "conversation.states": { label: "Estado da conversa", description: "Controle que define se a conversa está com automação ou atendimento humano.", subject: "o estado de uma conversa" },
  "conversation.events": { label: "Evento da conversa", description: "Registro de uma mudança ou acontecimento dentro da conversa.", subject: "um evento da conversa" },
  "lead.journeys": { label: "Jornada do lead", description: "Vínculo que determina qual regra, agente, canal e conexão podem atender o lead.", subject: "a jornada de um lead" },
  leads: { label: "Lead", description: "Criação ou alteração de um contato no CRM.", subject: "um lead" },
  "crm.kanban": { label: "CRM Kanban", description: "Movimentações dos cards entre etapas do funil.", subject: "um card do CRM" },
  "whatsapp.campaigns": { label: "Campanha de WhatsApp", description: "Criação ou alteração de uma campanha de mensagens.", subject: "uma campanha" },
  "whatsapp.campaign.recipients": { label: "Destinatário de campanha", description: "Processamento de um destinatário dentro de uma campanha.", subject: "um destinatário de campanha" },
  "external.api.call.logs": { label: "Consulta a API externa", description: "Resultado de uma consulta de leitura feita por um agente em uma API autorizada.", subject: "uma consulta externa" },
  "external.api.connectors": { label: "Conector de API externa", description: "Configuração de uma API externa vinculada aos agentes.", subject: "um conector externo" },
  "stripe.subscriptions": { label: "Assinatura Stripe", description: "Mudança registrada na assinatura ou cobrança recorrente do cliente.", subject: "uma assinatura" },
  "tenant.billing.entitlements": { label: "Permissões do plano", description: "Atualização dos recursos liberados para o cliente conforme o plano.", subject: "as permissões do plano" },
  "whatsapp.cloud.connections": { label: "Conexão Meta Cloud", description: "Criação ou alteração de uma conexão oficial do WhatsApp Cloud.", subject: "uma conexão Meta Cloud" },
};

const ACTORS: Record<string, string> = {
  customer: "Cliente",
  administrator: "Administrador",
  agent: "Agente automático",
  system: "Sistema",
  webhook: "Evento externo recebido",
  cron: "Agendamento automático",
  worker: "Processador automático",
  external_integration: "Integração externa",
};

const STATUSES: Record<string, { label: string; description: string }> = {
  pending: { label: "Aguardando", description: "A ação entrou na fila e ainda não havia sido processada neste momento." },
  running: { label: "Em execução", description: "O sistema estava trabalhando nesta ação quando o registro foi criado." },
  completed: { label: "Concluído", description: "A ação terminou normalmente." },
  blocked: { label: "Bloqueado", description: "Uma regra de segurança ou configuração impediu a ação de continuar." },
  cancelled: { label: "Cancelado", description: "A ação foi encerrada antes da conclusão e não deve continuar." },
  error: { label: "Com erro", description: "A ação não conseguiu terminar e registrou uma falha para investigação." },
};

const SEVERITIES: Record<string, string> = {
  debug: "Diagnóstico",
  info: "Informação",
  warning: "Atenção",
  error: "Erro",
  critical: "Crítico",
};

const RESULTS: Record<string, string> = {
  active: "Ativado com sucesso",
  authenticated: "Acesso autorizado",
  audit_archive_completed: "Arquivo da auditoria criado",
  audit_export_completed: "Exportação concluída",
  audit_export_queued: "Exportação colocada na fila",
  audit_query_completed: "Consulta aos logs concluída",
  cancelled: "Ação cancelada",
  card_move_committed: "Card movido no CRM",
  closed: "Jornada encerrada",
  completed: "Processamento concluído",
  contato: "Lead na etapa Contato",
  human_paused: "Automação pausada para atendimento humano",
  invalid_credentials: "Credenciais inválidas",
  leadgen_queued: "Lead da Meta colocado na fila",
  legacy_watchdog_run_interrupted: "Verificação antiga ficou interrompida",
  negociacao: "Lead na etapa Negociação",
  novo: "Lead na etapa Novo",
  operational_audit_unhealthy: "A auditoria operacional apresentou problema",
  pending: "Aguardando processamento",
  processing: "Em processamento",
  proposta: "Lead na etapa Proposta",
  rate_limited: "Muitas tentativas em pouco tempo",
  runtime_healthy: "Sistema dos agentes funcionando normalmente",
  sent: "Envio confirmado",
  session_cleared: "Sessão encerrada",
  webhook_persisted: "Evento salvo com segurança",
  watchdog_started: "Verificação de saúde iniciada",
};

const WORDS: Record<string, string> = {
  admin: "administrativo", agent: "agente", agenda: "agenda", audit: "auditoria",
  billing: "cobrança", campaign: "campanha", campaigns: "campanhas", check: "verificação",
  completed: "concluída", connection: "conexão", connections: "conexões", conversation: "conversa",
  created: "criado", deleted: "excluído", error: "erro", event: "evento", events: "eventos",
  evolution: "Evolution", export: "exportação", failed: "falhou", follow: "acompanhamento",
  inbox: "fila de entrada", insert: "criação", journey: "jornada", lead: "lead", leads: "leads",
  login: "entrada", logout: "saída", message: "mensagem", messages: "mensagens", meta: "Meta",
  moved: "movido", notification: "notificação", outbox: "fila de saída", recipient: "destinatário",
  recipients: "destinatários", reminder: "lembrete", response: "resposta", runtime: "funcionamento",
  started: "iniciada", state: "estado", states: "estados", stripe: "Stripe", sync: "sincronização",
  tenant: "cliente", update: "atualização", updated: "atualizado", webhook: "evento recebido",
  whatsapp: "WhatsApp", worker: "processador",
};

function humanizeIdentifier(value: string | null | undefined): string {
  if (!value) return "Sem informação";
  const words = value.split(/[._:-]+/g).filter(Boolean).map((word) => WORDS[word.toLowerCase()] ?? word);
  const text = words.join(" ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Sem informação";
}

function moduleInfo(module: string) {
  return MODULES[module] ?? {
    label: humanizeIdentifier(module),
    description: "Área técnica do MyChatCRM responsável por esta operação.",
    subject: `uma operação de ${humanizeIdentifier(module).toLowerCase()}`,
  };
}

function actionMeaning(event: ExplainableAuditEvent, subject: string): { title: string; summary: string } {
  const key = `${event.module}:${event.action}`;
  const exact: Record<string, { title: string; summary: string }> = {
    "runtime.watchdog:check.started": { title: "Verificação automática iniciada", summary: "O monitor começou a conferir se agentes, filas e tarefas automáticas estão funcionando." },
    "runtime.watchdog:check.completed": event.status === "error"
      ? { title: "Monitor encontrou um problema", summary: "A verificação automática identificou pelo menos uma condição que precisa de atenção." }
      : { title: "Verificação concluída sem problemas", summary: "O monitor terminou a conferência e não encontrou falhas críticas neste ciclo." },
    "runtime.watchdog:check.interrupted": { title: "Verificação antiga foi interrompida", summary: "Uma execução anterior do monitor começou, mas não registrou sua conclusão corretamente." },
    "webhook.evolution:event.persisted": { title: "Evento da Evolution recebido", summary: "O MyChatCRM recebeu o evento da Evolution e o salvou antes de iniciar o processamento." },
    "webhook.meta:leadgen.persisted": { title: "Lead da Meta recebido", summary: "O cadastro enviado pela Meta foi salvo e colocado na fila de processamento." },
    "admin.audit:audit.read": { title: "Painel de logs consultado", summary: "O proprietário abriu ou atualizou a lista da auditoria operacional." },
    "admin.audit:export.requested": { title: "Exportação dos logs solicitada", summary: "O proprietário pediu a geração de um arquivo com os registros filtrados." },
    "admin.audit:export.completed": { title: "Exportação dos logs concluída", summary: "O arquivo solicitado foi preparado e ficou disponível para download." },
    "admin.audit:export.failed": { title: "Exportação dos logs falhou", summary: "O sistema não conseguiu terminar a geração do arquivo solicitado." },
    "auth.admin:login.completed": { title: "Administrador entrou no painel", summary: "As credenciais foram validadas e uma sessão administrativa foi iniciada." },
    "auth.admin:login.failed": { title: "Tentativa de acesso recusada", summary: "Uma tentativa de entrada no painel administrativo usou credenciais inválidas." },
    "auth.admin:login.rate_limited": { title: "Tentativas de acesso temporariamente limitadas", summary: "O sistema bloqueou novas tentativas por segurança após muitas solicitações." },
    "auth.admin:logout.completed": { title: "Administrador saiu do painel", summary: "A sessão administrativa foi encerrada." },
    "crm.kanban:card.moved": { title: "Card movido no CRM", summary: "Um lead foi transferido manualmente ou automaticamente para outra etapa do funil." },
  };
  if (exact[key]) return exact[key];

  if (event.action === "insert") return { title: `Criação registrada: ${moduleInfo(event.module).label}`, summary: `O sistema criou ${subject} e registrou o início do seu estado atual.` };
  if (event.action === "update") return { title: `Atualização registrada: ${moduleInfo(event.module).label}`, summary: `O sistema atualizou ${subject} para refletir uma nova etapa ou resultado.` };
  if (event.action === "delete") return { title: `Remoção registrada: ${moduleInfo(event.module).label}`, summary: `O sistema removeu ou arquivou ${subject}, conforme a operação solicitada.` };
  if (event.action.endsWith(".started")) return { title: humanizeIdentifier(event.action), summary: `O sistema iniciou ${subject}.` };
  if (event.action.endsWith(".completed")) return { title: humanizeIdentifier(event.action), summary: `O sistema concluiu ${subject}.` };
  if (event.action.endsWith(".failed")) return { title: humanizeIdentifier(event.action), summary: `O sistema tentou processar ${subject}, mas ocorreu uma falha.` };
  return { title: humanizeIdentifier(event.action), summary: `O MyChatCRM registrou uma ação relacionada a ${subject}.` };
}

function impactFor(event: ExplainableAuditEvent): string {
  if (event.status === "error") {
    return event.is_critical || event.severity === "critical"
      ? "Esta falha foi classificada como crítica e pode afetar o funcionamento relacionado a este módulo."
      : "Esta tentativa falhou. Outras partes do sistema podem continuar funcionando normalmente.";
  }
  if (event.status === "blocked") return "A ação não foi executada porque uma proteção ou configuração do sistema a bloqueou.";
  if (event.status === "cancelled") return "A ação pendente foi encerrada e não deve produzir um novo efeito.";
  if (event.status === "pending") return "Ainda não havia efeito final confirmado; a ação aguardava sua vez na fila.";
  if (event.status === "running") return "Ainda não havia resultado final confirmado no momento deste registro.";
  return "A etapa registrada terminou normalmente e o resultado indicado foi aplicado ou confirmado.";
}

function recommendationFor(event: ExplainableAuditEvent): string {
  if (event.status === "error" && (event.is_critical || event.severity === "critical")) {
    return "Abra a trajetória completa e verifique os registros ligados pelo mesmo Trace ID. Se o problema continuar, ele precisa de investigação técnica.";
  }
  if (event.status === "error") return "Confira a trajetória para saber se houve nova tentativa ou recuperação. Investigue se o erro continuar aparecendo.";
  if (event.status === "blocked") return "Confira a configuração e a trajetória. Muitas vezes o bloqueio é esperado e protege contra uma ação indevida.";
  if (event.status === "pending" || event.status === "running") return "Acompanhe os próximos registros da mesma trajetória para confirmar a conclusão.";
  return "Nenhuma ação é necessária para este registro.";
}

export function explainOperationalAuditEvent(event: ExplainableAuditEvent): OperationalAuditExplanation {
  const moduleDetails = moduleInfo(event.module);
  const action = actionMeaning(event, moduleDetails.subject);
  const status = STATUSES[event.status] ?? { label: humanizeIdentifier(event.status), description: "Estado informado pelo processo responsável." };
  return {
    title: action.title,
    summary: action.summary,
    impact: impactFor(event),
    recommendedAction: recommendationFor(event),
    moduleLabel: moduleDetails.label,
    moduleDescription: moduleDetails.description,
    actionLabel: humanizeIdentifier(event.action),
    statusLabel: status.label,
    statusDescription: status.description,
    severityLabel: SEVERITIES[event.severity] ?? humanizeIdentifier(event.severity),
    actorLabel: ACTORS[event.actor_type] ?? humanizeIdentifier(event.actor_type),
    resultLabel: RESULTS[event.result_code ?? ""] ?? humanizeIdentifier(event.result_code),
  };
}

export function auditStatusLabel(status: string): string {
  return STATUSES[status]?.label ?? humanizeIdentifier(status);
}

export function auditSeverityLabel(severity: string): string {
  return SEVERITIES[severity] ?? humanizeIdentifier(severity);
}

export function auditActorLabel(actorType: string): string {
  return ACTORS[actorType] ?? humanizeIdentifier(actorType);
}
