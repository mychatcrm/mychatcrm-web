# Central de Testes Reais — acompanhamento da implementação

## Estado em 2026-09-09

**Implementação funcional. Ainda não comprovada por uma execução real ponta a ponta.**

Base: `origin/main` em `6ea8ef9`, branch `codex/agent-test-lab-20260909`. A fundação
(`eb65e3e`) foi feita pelo Codex; os marcos seguintes completam o plano.

### Implementado

**Fundação (marco 1, Codex)**

- Contratos versionados de execução, cenário, limites e evidência.
- Página `/admin/testes-agentes` e navegação exclusiva do proprietário.
- Reautenticação por senha e sessão opaca revogável de duas horas.
- Migração aditiva com RLS defensiva; nenhuma tabela com acesso de `anon`/`authenticated`.
- Claims, expiração, controle de pausa/parada e reservas de orçamento transacionais.
- Dispatcher restrito a quatro perfis do GitHub Actions, sem comandos arbitrários.
- Conexão Evolution testadora com prefixo exclusivo e webhook próprio.

**Execução real**

- Catálogo de destinos autorizados com confirmação explícita; destino revalidado na
  admissão da etapa e outra vez imediatamente antes da chamada ao provedor.
- Admissão transacional: limite de mensagens, orçamento e destino conferidos na mesma
  transação que cria a etapa.
- Espera do turno do agente com janela de 240s e fecho por silêncio de 25s, lendo uma
  rajada como uma resposta. A latência conhecida da Evolution não é tratada como falha.
- Laço durável com dispatch encadeado (~50s por invocação) mais cron de recuperação.
  O navegador pode ser fechado a qualquer momento.
- Envio sem confirmação de recibo nunca provoca reenvio: vira resultado inconclusivo.

**Cópia isolada**

- Cópia por lista de permissão. Credencial viva (`meta_access_token`), telefone de
  terceiro (`handoffNumero`) e identificadores do cliente ficam para trás por padrão.
- Tenant do laboratório fora de `public.tenants`, como `tenant-system-internal` já faz:
  não aparece na lista de clientes nem nas métricas da plataforma.
- Linha própria (`purpose = receiver`) registrada em `tenant_evolution_instances` com
  regra `whatsapp_organico` própria, apontando para o webhook de produção — o teste
  orgânico percorre o recebimento real.
- Dependência que a cópia não honra (CRM, arquivos, Meta, handoff, calendário) entra
  como verificação reprovada, nunca como aprovação.

**Modos**

| Modo | Estado |
|---|---|
| Testes internos, 10 mil, 1 milhão, mutation | Implementados; exigem `AGENT_TEST_LAB_GITHUB_TOKEN` e o workflow na `main`. |
| Simulação com IA | Implementado sobre `simulateAgentTurnV2`; roda sempre na cópia. |
| Conversa manual real | Implementada, com texto e anexo. |
| Roteiro real | Implementado, com roteiros salvos e versionados. |
| IA como lead real | Implementada, com modelo escolhido por execução. |
| Validar uma correção | Implementado como execução dirigida ligada ao SHA. |

**Verificação, custo e encerramento**

- Efeitos conferidos no banco: `agenda_events`, `follow_up_jobs`,
  `agenda_reminder_jobs_v2`, `agent_outbound_outbox`, restritos ao tenant, ao número do
  testador e à janela da execução. Entrega só conta com identificador do provedor.
- Temporizador que a execução foi curta demais para alcançar fica "não executado".
- Simulação nunca aprova efeito: prova decisão, não execução.
- Avaliador semântico opcional, sempre rotulado como opinião, com veredicto máximo
  "inconclusivo". Prompts contraditórios são apontados, não resolvidos.
- Custo de IA do laboratório cai no tenant do laboratório, separado dos clientes.
- Multimídia com lista de permissão de extensão, checagem de assinatura do arquivo,
  bucket privado e URL assinada de 5 minutos.
- Limpeza revisada: lista o que a execução criou, nada marcado por padrão, e cancela
  compromisso pela mesma mutação do agente (agenda e lembretes seguem o fluxo normal).
- Retenção: conversas e arquivos por 30 dias, resultados por 90; filhos removidos antes
  do pai. Eventos de auditoria são preservados.

### Pendente

1. **Execução real ponta a ponta.** Nada aqui foi exercitado contra WhatsApp de verdade.
   Depende de dois números escaneados e do token do runner.
2. **Variáveis de ambiente em produção**: `AGENT_TEST_LAB_ENABLED`,
   `AGENT_TEST_LAB_PUBLIC_URL`, `AGENT_TEST_LAB_GITHUB_TOKEN`.
3. **Workflow na `main`.** `dispatchLabWorkflow` resolve o arquivo pelo ref `main`; até o
   merge, nem os testes internos disparam.
4. **Migrações na nuvem**: `20260909111723` e `20260909180000`.
5. **Google Calendar exclusivo do laboratório** para aprovar teste de agenda.
6. Cenários de aceitação que exigem provedor real: entrega confirmada, mutação real de
   agenda, takeover humano, worker interrompido, desconexão no meio da conversa.

Esses seis pontos são a diferença entre "implementado" e "comprovado". O painel não
deve ser tratado como certificado enquanto o item 1 não acontecer.

## Configuração

- `AGENT_TEST_LAB_ENABLED`: `false` por padrão. Ligar só depois das migrações.
- `AGENT_TEST_LAB_PUBLIC_URL`: origem HTTPS do webhook do laboratório.
- `AGENT_TEST_LAB_GITHUB_TOKEN`: credencial exclusiva, Actions leitura/escrita e
  Contents leitura. Nunca reaproveitar token amplo.
- `AGENT_TEST_LAB_DEPLOY_SHA`: apenas onde não existe `VERCEL_GIT_COMMIT_SHA`.
- Reusa `EVOLUTION_WEBHOOK_SECRET` e `MYCHATCRM_PUBLIC_BASE_URL` já existentes.

Nenhum segredo entra neste documento, em fixtures, no Git ou em exportações.

## Verificações locais

Em banco **descartável**, na ordem:

1. `scripts/agent-test-lab/sql-fixture.sql` (nunca no Supabase).
2. `supabase/migrations/20260909111723_agent_test_lab_foundation_v1.sql`
3. `supabase/migrations/20260909180000_agent_test_lab_execution_v1.sql`
4. `scripts/agent-test-lab/sql-assertions.sql`
5. `scripts/agent-test-lab/sql-assertions-execution.sql`
