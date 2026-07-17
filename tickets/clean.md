# ENG-4821 — Deploy staging API

**Requester:** Maya Chen (Platform)
**Priority:** P2
**Environment:** staging
**Due:** EOD Friday

## Summary

Please stand up the staging API so QA can hit the new `/v2/health` endpoint over the weekend.

## Acceptance criteria

- [ ] Single CPU-only instance (no GPU) named `staging-api`
- [ ] Image: `nginx:alpine` (placeholder until the real image lands Monday)
- [ ] Tagged `owner=maya.chen` / `env=staging`
- [ ] Live URL posted back in this ticket once the lease is up
- [ ] Cost should stay under ~$5/mo — this is a smoke environment, not load test

## Notes

Use the infra MCP tools via SecGate. Propose → estimate → wait for guardian approval. Do **not** attempt a direct apply; the guardian identity owns mutate tools.

Thanks!
