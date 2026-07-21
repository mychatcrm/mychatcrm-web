# Evolution API fork delivery

This directory records the production-safe MyChatCRM patch applied over the
official Evolution API source. It does not contain credentials or database
dumps.

- Upstream: `https://github.com/EvolutionAPI/evolution-api`
- Base revision: `b900770a38f52566a9d9c67693e7919e62fc5346`
- Current rollback image: `mychatcrm/evolution-api:2.3.7-baileys-rc13-v2`
- Candidate image: `mychatcrm/evolution-api:2.3.7-baileys-rc13-lid-alias-v3`
- Patch: `patches/2.3.7-lid-alias-v3.patch`

The patch keeps the raw provider LID on each stored message and for WhatsApp
protocol operations. When `remoteJidAlt` is supplied, only the chat identity is
canonicalized to that provider-supplied alternate JID. Message lookup compares
both requested identities against both JSON key fields. No country, language,
industry, prompt, or agenda rule is introduced.

Build validation:

```sh
git checkout b900770a38f52566a9d9c67693e7919e62fc5346
git apply /path/to/2.3.7-lid-alias-v3.patch
npm ci --ignore-scripts
DATABASE_PROVIDER=postgresql npm run db:generate
npx tsc --noEmit
npm run build
docker build -t mychatcrm/evolution-api:2.3.7-baileys-rc13-lid-alias-v3 .
```

Production promotion must happen only after an isolated canary passes. Rollback
is the compose image change back to the exact `v2` tag above; no Evolution
database edit is required by this patch.
