# Agent protection notifications

The existing five-minute watchdog consumes protection decisions from the immutable audit. There is no additional cron or trigger on customer tables.

`processAgentTurnV2` records failed/protected turns, including exceptions, with a stable job/generation/code key. Dry-run never creates alerts. Durable blocked/cancelled/error transitions for response jobs, outbound messages, follow-ups, reminders, pending agenda actions and campaign recipients are also consumed from the existing audit. A precise turn event supersedes the generic database transition for the same resource.

Only new events after activation are eligible. Repeated polling does not resend an obligation. The queue uses exclusive expiring claims, provider idempotency, exponential backoff, eight attempts and a 23-hour retry safety boundary. Delivery failures remain visible in `/admin/logs`; they never authorize a lead message or undo a confirmed appointment.

Notices go only to the `super_admin` identity fixed by `OPERATIONAL_AUDIT_OWNER_ADMIN_ID`. Emails contain fixed operator explanations and a link to `/admin/logs`, no tenant/agent identifiers, contact data, prompts or conversation contents. Technical details stay in the protected panel. Acceptance by the email provider is recorded separately from mailbox delivery; acceptance is not proof the owner read the email.

Processing is bounded to four notices per watchdog cycle. Normally a new notice is picked up within five minutes; a backlog or provider retry increases this delay. This release does not configure WhatsApp notifications for individual guard decisions. Runtime-wide WhatsApp alerts remain on the existing external watchdog.

Enable only after the compatible production deployment is READY:

```sql
update private.agent_protection_notification_control
set enabled=true, activated_at=coalesce(activated_at,now())
where singleton;
```

Rollback: disable this control, then restore the previous application deployment. Keep the audit and queue for diagnosis. Never replay historical lead messages.

The agenda change adds a verbatim `readEvidence` field to the structured model plan for contact-scoped reads in any language. It does not grant writes or bypass tenant/contact authorization. Legacy plans, invented quotes, explicit mutation requests and known scheduling-answer misclassifications retain the existing guards.
