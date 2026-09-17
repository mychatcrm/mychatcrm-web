# Agendamentos do Vercel (crons)

A conta está no plano **Hobby**, que impõe **dois** limites — e eles falham
de formas bem diferentes:

## 1. Frequência: uma vez por dia

Expressões como `*/15 * * * *` ou `* * * * *` fazem o **deploy inteiro
falhar** — não é aviso, o Vercel recusa antes de construir. Barulhento, mas
você descobre na hora.

## 2. Quantidade: no máximo 2 agendamentos

Este é o perigoso, porque **falha em silêncio**. O deploy passa verde, o
`vercel.json` fica bonito, e os agendamentos excedentes simplesmente nunca
disparam. Nada no build avisa.

Foi o que aconteceu em **17/09/2026**: o arquivo acumulou **13 crons** ao
longo de várias features e só os primeiros rodavam. Os outros estavam
parados havia semanas. Só apareceu quando o Healthchecks passou a cobrar
ping de `evolution/reconcile`, `meta-connections/reconcile` e
`process-omnichannel` — os três jobs instrumentados que dependiam só daqui.

Por isso `lib/__tests__/campaign-send-window.test.ts` agora reprova o CI se
o `vercel.json` passar de 2 crons.

## Precisa de mais de 2 agendamentos?

Não adicione aqui. Use uma das duas saídas:

- **pg_cron do Supabase** — sem limite de frequência nem de quantidade, e já
  é o caminho usado por follow-up, meta-maintenance, agenda-reminders,
  evolution-inbox e o watchdog de reuniões. Exige que a rota aceite a
  assinatura HMAC (`verifySignedSchedulerRequest`) e uma migration que
  registre o `cron.schedule`.
- **Plano Pro** — libera 40 crons e frequência por minuto.

## O que está agendado aqui hoje

Só os dois jobs cuja função **nenhuma outra rota executa**:

- `/api/internal/evolution/reconcile` (05:30) — saúde das conexões Evolution.
- `/api/internal/process-omnichannel` (07:00) — redistribuição de leads e
  campanhas agendadas.

Os demais jobs que já viveram neste arquivo saíram porque são cobertos por
outra via (`meta-connections/reconcile` e `meta-leadgen-inbox/process` são
feitos pelo `meta-maintenance`, que roda por pg_cron) ou porque continuam
esperando um agendamento pg_cron próprio — entre eles
`operational-audit/retention`, `meetings/retention`, `external-api-catalog-sync`,
`system-notifications/reconcile`, `process-agenda-notifications` e
`agent-tests/retention`. Eles **não** estavam rodando enquanto figuravam
aqui; tirá-los do arquivo só tornou isso visível.

## Isso atrasa a entrega de leads?

Não. O webhook (`app/api/webhooks/meta/route.ts`) grava o lead na caixa
durável e processa **na mesma requisição**, via `waitUntil`. O cron é só
rede de segurança para reprocessar o que falhou no caminho inline.

O que fica mais lento é apenas o **retry** de um lead que falhou: espera
até o próximo ciclo diário em vez de minutos.

## Como ter retry rápido

Duas opções, nenhuma obrigatória:

1. **Plano Pro no Vercel** — libera cron por minuto; aí basta voltar os
   dois agendamentos para `*/15 * * * *` e `* * * * *`.
2. **Supabase pg_cron** — o endpoint `/api/internal/meta-maintenance` já
   aceita chamada externa assinada (HMAC). Defina
   `META_LEADGEN_SCHEDULER_SECRET` na Vercel e no Supabase Vault e agende
   pelo pg_cron, que não tem limite de frequência.

## Reuniões (MyChat Recorder AI)

O módulo de reuniões usa **as duas camadas**:

- **`vercel.json`** — `/api/internal/meetings/retention`, diário (03:45). Apaga
  áudio vencido pelo prazo do plano e conclui exclusões pedidas pelo usuário.
  Diário basta: retenção é medida em dias.
- **`pg_cron`** — `mychatcrm-meetings-minute` chama
  `/api/internal/meetings/watchdog` a cada minuto
  (migration `20260908130000_meetings_watchdog_cron_v1.sql`). Esse **não pode**
  ser diário: ele recupera leases vencidas, reenfileira reunião que ficou em
  `queued` sem job e reconsulta o provedor quando o callback se perde. Um dia de
  espera aí significaria o usuário olhando "Transcrevendo…" até o dia seguinte.

O watchdog aceita duas autenticações: token interno (operação) e a assinatura
HMAC do Supabase/Vault (`meta_leadgen_scheduler_secret`), igual ao worker de
follow-up. O caminho entra na assinatura, então uma chamada válida para um
worker não é reaproveitável contra o outro.
