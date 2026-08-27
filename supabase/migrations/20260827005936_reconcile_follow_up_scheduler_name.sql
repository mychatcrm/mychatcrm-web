-- Reconcile an early production scheduler label while keeping fresh installs
-- idempotent. The command itself and its cadence are unchanged.

alter table private.follow_up_scheduler_dispatches enable row level security;

select cron.unschedule(jobid)
  from cron.job
 where jobname in (
   'mychatcrm-follow-up-minte',
   'mychatcrm-follow-up-minute'
 );

select cron.schedule(
  'mychatcrm-follow-up-minute',
  '* * * * *',
  $$select private.dispatch_follow_up_processing();$$
);
