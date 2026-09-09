# Central de Testes Reais — acompanhamento da implementação

## Estado em 2026-09-09

**Implementação parcial. Não é uma entrega concluída nem uma certificação real.**

Base: `origin/main` em `6ea8ef9`. Worktree `codex/agent-test-lab-20260909`, separado do diretório de trabalho do proprietário. Nenhuma alteração paralela foi incorporada à força ou revertida.

### Implementado neste marco

- Contratos versionados de execução, cenário, limites e evidência.
- Página própria `/admin/testes-agentes` e navegação exclusiva do proprietário.
- Reautenticação por senha e sessão opaca revogável de duas horas; não confia no cookie administrativo legado.
- Rate limit durável para desbloqueio, validação de origem e APIs sem cache.
- Migração aditiva para sessões, conexões, destinos, execuções, etapas, mídias, custos, evidências e recursos.
- RLS defensiva e tabelas/RPCs sem acesso de `anon`/`authenticated`.
- Claims, heartbeat, controle de pausa/parada e reservas de orçamento transacionais.
- Auditoria de transições da execução na mesma transação, sem conteúdo de conversa ou prompt.
- Dispatcher restrito a quatro perfis do GitHub Actions, sem comandos arbitrários.
- Conexão Evolution com prefixo exclusivo, QR autenticado, sem reset do agente do sistema.
- Webhook exclusivo que recusa histórico, contatos não autorizados e instâncias divergentes.
- Pré-validação de agente, conexão, transporte e regra; campos conferidos no schema real.
- Relatórios JSON/CSV sanitizados e histórico de execuções.
- Validação inicial de tipos, tamanho e assinaturas de arquivos.

### Ainda precisa ser implementado/validado (obrigatório para o plano completo)

1. Provisionamento da cópia isolada, calendário e vínculos de ferramentas sem copiar credenciais.
2. Catálogo e confirmação transacional dos destinos autorizados e dos efeitos por execução.
3. Atribuição de custo/quota do agente testado ao SaaS, com contexto validado no servidor.
4. Executor real manual, roteiro e IA testadora com escolha de modelo a cada execução.
5. Upload privado completo, gravação de áudio, documentos, mídia recebida e confirmação de interpretação.
6. Simulação integrada ao motor atual e atribuição correta dos seus custos.
7. Confirmação determinística de agenda, CRM, follow-up, lembretes, ferramentas e entrega.
8. Encerramento da jornada exclusivamente de teste, revisão e limpeza dos recursos criados.
9. Retenção automática de conteúdo/arquivos por 30 dias e resultados por 90 dias.
10. Criação/validação do cron de recuperação do laboratório. O endpoint já existe, mas não foi agendado.
11. Credencial GitHub de escopo mínimo, workflow publicado e execução comprovada no runner.
12. Migração na nuvem, preview, teste ponta a ponta e publicação aprovada.

Os modos reais e a simulação permanecem bloqueados no backend enquanto esses pontos estiverem pendentes. Essa proteção **não equivale a implementá-los**. Não remover o bloqueio apenas para habilitar botões.

## Configuração futura

- `AGENT_TEST_LAB_ENABLED`: `false` por padrão; não ativar em produção durante a implementação.
- `AGENT_TEST_LAB_PUBLIC_URL`: origem HTTPS do webhook dedicado.
- `AGENT_TEST_LAB_GITHUB_TOKEN`: credencial exclusiva do repositório MyChatCRM, Actions leitura/escrita e Contents leitura. Nunca reaproveitar token amplo do CLI sem avaliação.
- `AGENT_TEST_LAB_DEPLOY_SHA`: apenas para ambientes controlados sem `VERCEL_GIT_COMMIT_SHA`.

Nenhum segredo deve entrar neste documento, em fixtures, no Git ou em exportações.

## Evidências deste marco

- Suíte executada: 285 arquivos / 2.873 testes aprovados, incluindo 47 novos testes de contrato/política e os 10.000 cenários determinísticos existentes.
- Testes adicionais de autenticação: 18 aprovados em execução separada.
- TypeScript, cobertura de auditoria e build de produção aprovados.
- Migração exercitada em PostgreSQL 14 descartável local, sem acessar dados de clientes.
- Verificados: reserva/estorno idempotentes, orçamento, claim exclusiva, pausa, heartbeat obsoleto, expiração, permissões e auditoria transacional.
- Concorrência real no PostgreSQL local: 16 workers reivindicando o mesmo job, 20 reservas de orçamento simultâneas, 16 tentativas com a mesma chave, 10 tentativas durante pausa e duas execuções compartilhando a mesma conexão — sem colisão nos testes executados.
- Isso não comprova envio WhatsApp, Google Calendar, custo real, runner remoto ou canário.

## Verificações SQL locais

Em banco **descartável**, aplicar na ordem:

1. `scripts/agent-test-lab/sql-fixture.sql` (nunca no Supabase de produção).
2. `supabase/migrations/20260909111723_agent_test_lab_foundation_v1.sql`.
3. `scripts/agent-test-lab/sql-assertions.sql`.

O fixture possui apenas papéis/tabelas mínimos falsos; não substitui a validação de compatibilidade no Supabase de preview.
