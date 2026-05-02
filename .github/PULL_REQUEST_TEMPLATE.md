<!--
  Title format: <type>(<scope>): <summary>
  Examples: feat(templates): add foo workflow · fix(renderer): preserve scoped deps
  See https://www.conventionalcommits.org
-->

## Summary

<!-- 1-3 sentences describing the change and why. -->

## Changes

- 

## Affected templates / downstream impact

<!--
  Anything in templates/ or scripts/lib/ propagates to ~15 downstream servers.
  Note which template tiers / server profiles this touches and whether any servers
  need a follow-up template-sync PR.
-->

## Test plan

- [ ] `node --test scripts/tests/*.mjs`
- [ ] `./scripts/audit-server.sh ../mcp-freescout` (or another sample server)
- [ ] Manual verification (describe below)

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to, e.g. risk areas, follow-ups. -->
