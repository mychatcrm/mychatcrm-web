#!/usr/bin/env node
/**
 * Dual-connection claim concurrency smoke.
 *
 * Requires DATABASE_URL (or SUPABASE_DB_URL) + the `pg` package pointing at a
 * NON-PRODUCTION isolated database (Supabase branch / local supabase).
 * Never run against customer production data.
 *
 * If env/package is missing, exits 0 with an explicit "NOT PROVEN" message.
 */
const url = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "";

async function main() {
  if (!url) {
    console.log(
      "[smoke-agenda-claim-dual] SKIPPED — critério concorrente NÃO comprovado (sem DATABASE_URL/SUPABASE_DB_URL).",
    );
    return;
  }

  let pg;
  try {
    pg = await import("pg");
  } catch {
    console.log(
      "[smoke-agenda-claim-dual] SKIPPED — critério concorrente NÃO comprovado (pacote `pg` ausente).",
    );
    return;
  }

  const a = new pg.default.Client({ connectionString: url });
  const b = new pg.default.Client({ connectionString: url });
  await a.connect();
  await b.connect();

  const tenant = `smoke-dual-${Date.now()}`;
  const op = `op-${Date.now()}`;
  let outboxId = null;

  try {
    await a.query("BEGIN");
    const ins = await a.query(
      `INSERT INTO public.agenda_notification_outbox
         (tenant_id, agenda_event_id, action, operation_key, phone_last4, payload, status, next_attempt_at)
       VALUES ($1, NULL, 'scheduled', $2, '0000', '{"phone":"5511999990000","message":"smoke"}'::jsonb, 'pending', now())
       RETURNING id`,
      [tenant, op],
    );
    outboxId = ins.rows[0].id;
    await a.query("COMMIT");

    await a.query("BEGIN");
    await b.query("BEGIN");

    const claimA = await a.query(`SELECT id FROM public.claim_agenda_notifications(10, 300)`);
    const claimB = await b.query(`SELECT id FROM public.claim_agenda_notifications(10, 300)`);

    const aGot = claimA.rows.some((r) => r.id === outboxId);
    const bGot = claimB.rows.some((r) => r.id === outboxId);

    if (aGot === bGot) {
      throw new Error(`expected exactly one worker to claim the row; a=${aGot} b=${bGot}`);
    }

    await a.query("COMMIT");
    await b.query("COMMIT");
    console.log("[smoke-agenda-claim-dual] OK — FOR UPDATE SKIP LOCKED exclusive claim proven");
  } finally {
    try {
      if (outboxId) {
        await a.query(`DELETE FROM public.agenda_notification_outbox WHERE id = $1`, [outboxId]);
      }
      await a.query(`DELETE FROM public.agenda_notification_outbox WHERE tenant_id = $1`, [tenant]);
    } catch {
      /* cleanup best-effort */
    }
    await a.end().catch(() => undefined);
    await b.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("[smoke-agenda-claim-dual] FAILED", err);
  process.exit(1);
});
