export const LAB_CODE_LABELS: Record<string, string> = {
  lab_locked: "Confirme novamente seu e-mail e senha de proprietário para abrir a central.",
  lab_disabled: "A central está desativada. Nenhum teste novo será iniciado.",
  invalid_credentials: "E-mail ou senha inválidos, ou conta sem permissão de proprietário.",
  rate_limited: "Muitas tentativas. Aguarde antes de tentar novamente.",
  github_not_configured: "Falta configurar a credencial restrita do runner do GitHub.",
  github_access_denied: "O GitHub não autorizou iniciar ou consultar a suíte.",
  github_unavailable: "Não foi possível confirmar a resposta do GitHub agora.",
  internal_dispatch_unknown: "O runner pode ter recebido a solicitação. Não repetimos o disparo para evitar duplicidade.",
  internal_passed: "A suíte selecionada passou nessa versão. Isso não comprova um atendimento real.",
  internal_failed: "A suíte encontrou uma falha. Abra os detalhes do runner para investigar.",
  internal_running: "A suíte está em execução no runner separado do GitHub.",
  internal_cancelled: "O runner foi cancelado. Esta execução não conta como aprovada.",
  real_test_dependencies_pending: "Os testes reais aguardam conclusão e validação do isolamento, cobrança e encerramento seguro.",
  sender_has_active_runs: "Pare e encerre as execuções antes de desconectar o WhatsApp testador.",
  sender_creation_unconfirmed: "A criação da conexão não foi confirmada. A reserva foi preservada para evitar outra instância.",
  sender_missing_review_required: "A instância reservada não foi encontrada. É necessária revisão antes de recriar.",
  sender_qr_unavailable: "O provedor ainda não forneceu um QR válido. Tente atualizar a conexão.",
  sender_provider_unavailable: "A Evolution não respondeu à consulta de conexão.",
  sender_number_already_in_use: "Esse número já pertence a uma conexão do sistema ou de cliente. Use outro número dedicado ao laboratório.",
  sender_isolation_unconfirmed: "Não foi possível confirmar que o número é exclusivo do laboratório.",
  lab_webhook_url_missing: "Falta configurar o endereço HTTPS do webhook exclusivo do laboratório.",
  deadline_reached: "O tempo máximo terminou. Nenhuma nova mensagem do testador pode sair.",
  provider_receipt_unknown: "Não foi possível confirmar a entrega. O teste foi interrompido sem reenvio automático.",
  deployment_changed: "O sistema mudou de versão. Execute novamente as verificações na versão atual.",
  preflight_failed: "Uma ou mais verificações obrigatórias não foram aprovadas.",
};
export function labCodeLabel(code: string): string {
  return LAB_CODE_LABELS[code] ?? `Não foi possível concluir esta etapa. Código para investigação: ${code}`;
}
export const LAB_STATUS_LABELS: Record<string, string> = {
  queued: "Na fila", running: "Executando", paused: "Pausado", waiting_reply: "Aguardando agente",
  waiting_input: "Aguardando ação", stopping: "Encerrando", completed: "Concluído", failed: "Falhou", cancelled: "Cancelado",
};
export const LAB_VERDICT_LABELS: Record<string, string> = {
  passed: "Aprovado", failed: "Falhou", expected_block: "Bloqueio esperado", inconclusive: "Inconclusivo", not_executed: "Não executado",
};
