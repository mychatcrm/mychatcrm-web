# Central de Testes Reais — estado verificado

## Revisão de segurança em 2026-09-09/10

**Entrega parcial em revisão. Não certificada para produção ou conversas reais.**

Base `6ea8ef9`, continuação do Claude até `80c171f`, PR #136. O trabalho do Claude
foi preservado, mas sua declaração de implementação completa não foi confirmada.

## Correções desta revisão

- Preflight e início usam as mesmas verificações, sem o bloqueio incondicional antigo.
- Dispatch responde 202 antes do trabalho longo; pausa/espera manual não cria um laço contínuo.
- Cron aceita GET e POST autenticados; o dispatcher usa somente segredos aceitos pela rota.
- Trocar para controle manual remove o modo autônomo na transação.
- Configuração do agente é revalidada antes da etapa; o fingerprint da cópia inclui modelo, voz e demais campos.
- O horário de atendimento passa a ser preservado na cópia.
- Uma linha receptora já associada a outra cópia não é apresentada como se atendesse ao agente recém-selecionado.
- A parada valida claim e registro da cópia isolada e recusa tenants de clientes, jornadas antigas ou divergentes.
- Identidade do testador é salva na execução; evidências exigem jornada, regra, agente, canal e conexão exatos.
- Job agendado não comprova entrega. Recibos pendentes e roteiro parcialmente executado não geram aprovação.
- Existência de compromisso não comprova data, horário, fuso ou sincronização. Essa verificação permanece inconclusiva.
- Objetos de Storage precisam ser removidos antes dos registros. Falha mantém a referência para recuperação.
- Conteúdo de comandos e cenários de execuções encerradas também é eliminado pela retenção de 30 dias.
- Correção do cancelamento de agenda preparada com identidade e sincronização normal; limpeza continua bloqueada até comprovar a propriedade dos recursos.

## Capacidades e pendências reais

| Recurso | Estado |
|---|---|
| Testes internos/GitHub | Implementados; requerem workflow na main e token restrito. |
| Manual e roteiro de texto na cópia | Em validação; não houve teste ponta a ponta. |
| Roteiro com mídia/espera | Bloqueado: o executor não pode ignorar etapas. |
| Simulação e IA testadora | Bloqueadas até reserva/contabilização por chamada e continuidade durável do contexto. |
| Avaliador semântico pago | Bloqueado pelo mesmo requisito de custos. |
| Agente original | Bloqueado até isenção de quota/cobrança, efeitos permitidos e isolamento comprovados. |
| Meta formulário oficial | Pendente; envio WhatsApp não pode ser apresentado como prova de formulário. |
| Agenda e limpeza | Pendente vínculo explícito execução → mutação → evento, com fatos e sincronização verificados. |
| Reutilização de contato | Bloqueada até vínculo explícito com o contexto anterior. |
| Google Calendar do laboratório | Ainda precisa ser configurado e exercitado. |

Ainda faltam: proteção de entrada da linha receptora contra contatos não autorizados e
eventos atrasados após parada; revalidação de autorização imediatamente antes do envio;
espera baseada nos jobs reais; captura/transcrição/reprodução de mídia e uploads maiores;
medição completa dos custos do agente testado; cron frequente de recuperação; validação
de integração e canário com dois números dedicados. Os 65 segundos do burst não serão alterados.

Não ativar `AGENT_TEST_LAB_ENABLED` para uso real antes dessas validações. O painel não
pode prometer conclusão integral ou isenção de cobrança enquanto as lacunas existirem.

## Migrações

As migrações originais foram aplicadas pelo Claude com identificadores diferentes dos
arquivos locais. O conteúdo foi comparado com `schema_migrations`: idêntico após trim.
Os arquivos foram renomeados para os identificadores efetivamente aplicados:

- `20260909205517_agent_test_lab_foundation_v1.sql`
- `20260909205558_agent_test_lab_execution_v1.sql`

A nova `20260910004156_agent_test_lab_safety_v2.sql` foi gerada pela CLI e testada em
PostgreSQL local descartável. Não executar os fixtures abaixo no Supabase.

## Verificações reproduzíveis

1. `scripts/agent-test-lab/sql-fixture.sql`
2. Migrações foundation e execution acima.
3. `scripts/agent-test-lab/sql-fixture-safety.sql`
4. Migração safety V2.
5. `scripts/agent-test-lab/sql-assertions-safety.sql` (transação com rollback).
6. `npx vitest run lib/__tests__/agent-test-lab-*.test.ts`
7. `npx tsc --noEmit --incremental false`
8. `npm test -- --maxWorkers=2` e `npm run build`.

O fixture SQL usa um adaptador de takeover simulado: comprova escopo e chamada, não
cancelamento real no provedor. Os testes determinísticos não são conversas reais.
O primeiro ensaio da suíte completa foi invalidado por disco cheio (`ENOSPC`); após
remoção somente do cache `.next/cache` deste worktree, a execução final passou com
2.962 testes em 293 arquivos (136 específicos do laboratório). TypeScript, build de
produção, cobertura de auditoria e regressões SQL locais também passaram.

Nenhum número real, segredo, prompt de cliente ou credencial entra em fixtures ou Git.
