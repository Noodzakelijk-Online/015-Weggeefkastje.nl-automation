# Operator runbook

## Start and first run

1. Copy `.env.example` to `.env`; keep loopback defaults.
2. Run `npm ci`, `npm run migrate`, then `npm run dev`.
3. Open `http://127.0.0.1:5173` and create the first owner account.
4. Add a manual intake and complete one test workflow before activating a provider.

## Routine operation

- Keep the API/web process and worker as separate processes.
- Use Beoordelen for rule failures, human decisions and location-less social signals.
- Verify source, giveaway language, approximate location and privacy before approval.
- Copy the generated package, post it yourself, then mark it placed. Never mark placement merely because copying succeeded.
- Record only necessary response/pickup notes; do not copy private conversations wholesale.
- Run `npm run doctor` after upgrades and inspect `/ready` before considering the service ready.

## Provider setup

- Facebook: enter the token/version in `.env`, list approved Page IDs in `FACEBOOK_PAGE_CONTEXTS_JSON`, restart worker, then verify one controlled read. Never broaden permissions just to make ingestion work.
- Nextdoor: obtain an admin/platform-approved export, place it inside `APP_DATA_DIR`, set its relative path, and restart the worker. Do not export private-member fields.

## Backup and restore

- Backup: `npm run backup`.
- Checksum: `npm run cli -- checksum --file data/backups/<file>.sqlite`.
- Restore: stop API and worker, then `npm run cli -- restore --from data/backups/<file>.sqlite --confirm`. The command first preserves the current database and validates the restored copy.

## Failure playbooks

- Provider error: leave jobs queued/retrying, verify scope/token/version, and keep manual operation available. Repeated failures stop after the maximum attempt count.
- Ambiguous external result: do not infer success. Check the provider manually and record only confirmed placement.
- Suspicious intake: dismiss/quarantine it; do not create a public location.
- Incident: enable Veiligheidsstop in Instellingen, stop worker, rotate credentials, back up, run `npm run cli -- support-bundle`, and inspect audit history.

## Release

Run `npm ci`, audit, lint, typecheck, tests, build, Docker build, `npm run smoke`, `npm run doctor`, a browser flow at desktop/mobile sizes, and a backup/restore drill. Roll back by redeploying the prior image and restoring only when a schema/data rollback truly requires it.
