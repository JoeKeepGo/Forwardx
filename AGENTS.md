# ForwardX Pocket ID fork maintenance

This is JoeKeepGo's authentication-focused fork of poouo/Forwardx. Read
`docs/guide/oidc-login.md` and `docs/fork-maintenance.md` before changing authentication.

## Scope and invariants

- Keep changes minimal and confined to panel authentication and its UI, tests and documentation.
- Do not change database schemas, add migrations, or change Agent, forwarding engines or rules unless the owner explicitly expands the scope.
- Reuse `googleSubject`, `googleEmail` and `googleLinkedAt`. Run only one external identity provider at a time.
- Preserve raw Google subjects. OIDC subjects use the existing issuer/sub hash namespace; never merge or bind accounts by matching email alone.
- Verify discovery issuer, endpoints, ID token signature, issuer, audience, authorized party, nonce, expiry and verified email. Preserve single-use browser-bound state and PKCE S256.
- Provider/issuer switches require explicit confirmation and password recovery for every bound account. Keep old bindings dormant until users explicitly unbind and rebind.
- Preserve disabled-user checks, sessions, local roles/permissions, 2FA, registration restrictions and email allowlists.
- The owner requested the enterprise UI: hide Telegram/Discord login, bindings, bot settings, community promotions and ordinary-user purchase entries by default. Preserve SSO/password/2FA/email and existing data, backend integrations and API permissions. `VITE_FORWARDX_COMMUNITY_UI=1` restores community UI at frontend build time; it is not a runtime access-control switch.
- Never commit credentials, real account data, generated test databases or build outputs.

## Git and maintenance

- `origin` is `JoeKeepGo/Forwardx`; `upstream` is `poouo/Forwardx`.
- `pocket-id-oidc` is the maintained branch. `main` retains the upstream baseline.
- Fetch and inspect upstream updates. Prepare integration in an isolated checkout/branch and test it before presenting the result.
- Weekly maintenance is authorized to inspect upstream and CI, run relevant tests and prepare local fixes. Do not automatically merge upstream, push scheduled changes, create releases/tags, publish packages or deploy. Ask the owner to approve a concrete tested update before those actions.
- Preserve uncommitted work, avoid force-pushing, and do not contact upstream maintainers without explicit authorization.
- Publish Docker images only on an explicit owner request, using the manual `docker-image.yml` workflow on `pocket-id-oidc` after successful authentication CI. Use `oidc` and a commit-specific tag; verify both native architectures before exposing the multi-platform tag. Publishing an image does not authorize deployment.
- Report only a meaningful authentication compatibility change, test failure, completed requested update or required owner action. Remain quiet when state is unchanged or non-actionable.

## Validation

Use Node.js 22 and pnpm 10.28.1 with `pnpm install --frozen-lockfile`.
Run `pnpm test:oidc-auth`, the authentication regression command in
`.github/workflows/oidc-auth.yml`, `pnpm exec tsc --noEmit`, `pnpm build` and
`pnpm docs:build` for changes that affect these surfaces. Confirm the schema,
migrations, Agent and forwarding engine diff remains empty. Do not repeat passing
checks unless later changes or new evidence justify it.
