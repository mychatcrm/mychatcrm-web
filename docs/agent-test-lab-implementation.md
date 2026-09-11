# Central de Testes Reais — estado verificado

## Revisão de segurança em 2026-09-09/11

**Entrega parcial: código protegido para publicação; conversa real ainda não certificada.**

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
| Roteiro com mídia/espera | Executor durável implementado; ainda depende do canário de transporte. |
| Simulação e IA testadora | Contexto e propostas pendentes duráveis implementados; bloqueadas até validação integral de custos e efeitos. |
| Avaliador semântico pago | Bloqueado pelo mesmo requisito de custos. |
| Agente original | Bloqueado até isenção de quota/cobrança, efeitos permitidos e isolamento comprovados. |
| Meta formulário oficial | Pendente; envio WhatsApp não pode ser apresentado como prova de formulário. |
| Agenda e limpeza | Pendente vínculo explícito execução → mutação → evento, com fatos e sincronização verificados. |
| Reutilização de contato | Bloqueada até vínculo explícito com o contexto anterior. |
| Google Calendar do laboratório | Ainda precisa ser configurado e exercitado. |

Ainda faltam: captura/transcrição/reprodução de mídia recebida;
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

As versões V2–V5 foram testadas em PostgreSQL local descartável e aplicadas no
Supabase em 2026-09-11. Os nomes locais acompanham os identificadores atribuídos
pelo serviço, sem modificar o conteúdo das migrações aplicadas:

- `20260911082910_agent_test_lab_safety_v2.sql`
- `20260911082924_agent_test_lab_execution_safety_v3.sql`
- `20260911082927_agent_test_lab_direct_uploads_v4.sql`
- `20260911082930_agent_test_lab_simulation_v5.sql`

Não executar os fixtures abaixo no Supabase.

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

## Continuação em 2026-09-10 — execução V3

- Destino é revalidado contra o número atualmente conectado, não apenas contra o catálogo.
- Mídia exige instância testadora dedicada, assim como texto. Mensagens/legendas extensas são recusadas, não truncadas.
- Despacho exige autorização transacional final por etapa/claim; pausa anterior impede a chamada e autorização não pode ser usada duas vezes.
- Entrada na cópia exige execução ativa, testador exato, registro isolado e horário do provedor dentro da execução. Sincronizações antigas e contatos externos são rejeitados.
- Triggers limitados ao prefixo reservado do laboratório bloqueiam jornada tardia e nova autorização de outbound depois da parada. Confirmações de envios autorizados anteriormente continuam graváveis.
- Roteiros aceitam mídia e esperas persistidas, sem cobrar uma espera como mensagem. A repetição da mesma chave retorna a etapa existente; conteúdo diferente na mesma chave falha.
- O editor preserva o JSON completo do roteiro salvo, incluindo arquivos, esperas e verificações. Envio manual conserva a chave em uma tentativa de rede repetida e exige modo manual.
- Implementado escopo assíncrono de orçamento de IA, reserva/baixa por chamada e atribuição ao laboratório. **Ainda não habilita IA testadora/simulação: falta integrar e validar o ciclo completo e o consumo do agente testado.**
- 2.993 testes em 296 arquivos passaram, incluindo 167 testes do laboratório; TypeScript e build passaram. A cobertura de auditoria da rota de envio foi corrigida com evento explícito e traceId.
- A migração de execução V3 é aditiva e validada em PostgreSQL local com fixtures de domínio reduzidos. Esses fixtures não substituem canário real.
- Produção ainda não foi promovida nesta etapa; não chamar a entrega completa de certificada.

## Continuação — uploads privados, gravação e observação de turnos

- Upload de até 20 MB vai diretamente ao Storage privado, sem atravessar o limite de corpo da Vercel. O ticket não permite sobrescrita; assinatura/tamanho/checksum são verificados pelo backend antes de liberar uso. Upload pendente ou rejeitado não pode entrar numa etapa, em nenhuma versão da RPC.
- Gravação manual pede microfone somente ao clicar, encerra em 60 segundos e permite ouvir/descartar antes de anexar. Desmontagem cancela captura e libera o microfone. Apenas `/admin/testes-agentes` ganhou permissão de microfone; demais páginas administrativas continuam fechadas.
- A avaliação consulta jobs e outbox pendentes do contato/agente/canal/conexão exatos antes de concluir o turno. Trabalho pendente ao fim da janela não aprova silêncio nem efeito.
- IA testadora agora exige modelo explícito e executa dentro do orçamento transacional por etapa. Falha de geração não é mais interpretada como conclusão normal. O modo continua bloqueado até medir também o agente testado e concluir o canário.
- Migração V4 e suas regressões foram executadas somente em PostgreSQL descartável. Não houve upload de conteúdo de clientes nem mensagens reais.
- Na leitura da nuvem desta etapa: zero conexões e zero execuções do laboratório; apenas as duas migrações de fundação aplicadas. O preview `048e12e` estava READY e CI aprovado.

## Continuação em 2026-09-11 — simulação durável V5

- Cada claim de simulação executa no máximo um turno. Etapa iniciada antes de uma interrupção não é reenviada cegamente à IA.
- Histórico privado do teste e proposta de agenda pendente passam entre etapas sem consultar conversa de cliente. Pausa e claim obsoleta impedem finalizar o turno como aprovado.
- O motor rejeita um adaptador de agenda com mutações dentro do dry-run. Prompts e histórico preservam o conteúdo configurado, sem instruções comerciais novas.
- A conclusão SQL grava etapa, evidências, mensagens e estado em uma transação; a retenção remove também o estado privado da simulação.
- O dispatcher não inicia turno sem reserva de tempo. A recuperação processa um run por invocação para não somar cinco chamadas longas dentro de 60 segundos.
- Migrações V2–V5 aplicadas: funções verificadas sem EXECUTE para anon/authenticated e disponíveis ao service_role. Nenhum lead, compromisso ou mensagem real foi criado.
- Pendências verificadas na nuvem: zero conexões e execuções de laboratório; nenhum cron próprio do laboratório. Credencial restrita do runner e ativação por ambiente ainda exigem verificação.
- Esta etapa não certifica paridade de todo o estado virtual da agenda, contabilização de todas as mídias/IA, agente original, formulário Meta ou limpeza. Os bloqueios explícitos desses recursos permanecem.
- Verificação local: suíte completa de 3.066 testes aprovada, seguida dos quatro novos testes de reserva de tempo aprovados; TypeScript, build de produção, cobertura de auditoria e as quatro regressões SQL (V2–V5, com rollback) aprovados. O CI repetirá a suíte completa no commit publicado.
- Advisors após a migração: nenhum alerta de segurança de nível WARN/ERROR específico do laboratório; RLS sem políticas é intencional para tabelas exclusivas do backend. Nenhuma chave estrangeira sem índice foi apontada no laboratório. Avisos preexistentes de outros módulos não foram alterados.
