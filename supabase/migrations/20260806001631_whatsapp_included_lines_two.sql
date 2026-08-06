-- Passa para 2 as linhas WhatsApp incluídas nos tenants já provisionados.
--
-- `lib/plan-policy.ts` agora inclui 2 linhas em todos os planos, mas
-- `enterprise_provisions.included_whatsapp` sobrepõe a policy através de
-- `resolveEffectivePlanLimits` (ver `lib/plan-limits.ts`). Sem este backfill,
-- todo tenant já provisionado continuaria preso em 1 linha mesmo depois do
-- deploy — o código sozinho não entrega a segunda linha a ninguém.
--
-- `is not null` preserva o sentinela de "sem limite" (mapeado para 99.999.999
-- em `lib/enterprise-provision-limits.ts`); `< 2` preserva contrato Enterprise
-- que já tenha sido elevado à mão acima de 2.

update public.enterprise_provisions
   set included_whatsapp = 2
 where included_whatsapp is not null
   and included_whatsapp < 2;
