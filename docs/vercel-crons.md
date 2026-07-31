# Agendamentos do Vercel (crons)

A conta está no plano **Hobby**, que só aceita cron **uma vez por dia**.
Expressões como `*/15 * * * *` ou `* * * * *` fazem o **deploy inteiro
falhar** — não é aviso, o Vercel recusa antes de construir.

Por isso os dois agendamentos do Meta (`meta-connections/reconcile` e
`meta-leadgen-inbox/process`) estão em horário diário.

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
