# Cloudflare architecture research — 2026-11-10

## Recommended app infrastructure

- React + Vite browser interface; Hono Worker serves `/api/*`; Worker static assets serve Vite output.
- D1 stores project scripts and async video generation tasks.
- R2 stores reference uploads and downloaded video results privately; authenticated Worker routes return objects. Do not enable public R2 access for private creator media.
- Workers AI supplies prompt refinement through Vercel AI SDK. Current official recommendation is `agents/models/ai-sdk`, replacing the now-deprecated `workers-ai-provider` package.
- Cloudflare Access One-time PIN sends a login code to the allowed administrator address `xiexuanxi@outlook.fr`. No independent email delivery vendor is needed.
- GitHub repository and GitHub Actions are code/CI requirements; deployments run Wrangler against Cloudflare. No Vercel hosting is needed to use the Vercel AI SDK.
- Seedance inference is a ByteDance/Volcengine external model API, not a Cloudflare service. Cloudflare hosts the application, database, file storage, identity, and AI script helper, but Seedance cannot honestly be described as running wholly on Cloudflare.

## Current SDK compatibility (verified from registry + official repo)

- `agents` current npm version read: `0.33.0`.
- `ai` current npm version read: `7.0.166`.
- The current `agents/models/ai-sdk` provider expects `ai@^7` and `@ai-sdk/provider@^4`. Install `agents ai @ai-sdk/provider`; pin/lock tested versions.
- `workers-ai-provider` current `4.0.1` is explicitly deprecated. Its README recommends `createAI` from the Agents SDK instead.

```ts
import { createAI } from 'agents/models/ai-sdk';
import { generateText } from 'ai';

const model = createAI({ binding: env.AI });
const { text } = await generateText({
  model: model('@cf/zai-org/glm-4.7-flash'),
  prompt: 'Rewrite this shot prompt while preserving the product details.',
});
```

Add `"ai": {"binding":"AI"}` to Wrangler. Binding use requires no runtime Cloudflare API token. A stable documented example model is `@cf/meta/llama-3.1-8b-instruct`; the new provider docs use `@cf/zai-org/glm-4.7-flash`. Confirm account access before inference.

**Sources:**

- https://developers.cloudflare.com/agents/models/ai-sdk/
- Verified Markdown: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/agents/models/ai-sdk.mdx
- https://github.com/cloudflare/ai/tree/main/packages/workers-ai-provider
- https://registry.npmjs.org/agents/latest
- https://registry.npmjs.org/ai/latest
- https://registry.npmjs.org/workers-ai-provider/latest

### Optional OpenAI-compatible endpoint

Cloudflare also documents `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1` as its OpenAI-compatible base URL. Chat completions endpoint is `/chat/completions`; Authorization is Bearer Cloudflare API token. For AI SDK this is compatible with `@ai-sdk/openai-compatible` + `createOpenAICompatible({name:'cloudflare',apiKey,baseURL})`, then `generateText({model:provider(modelId),...})`. Prefer the native binding above to avoid runtime CF credentials.

- https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/
- Verified Markdown: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers-ai/configuration/open-ai-compatibility.mdx
- https://ai-sdk.dev/providers/openai-compatible-providers

## Authentication: verified token, email owner

1. Cloudflare Zero Trust > Integrations > Identity providers > Add new identity provider > One-time PIN. New organizations no longer add OTP automatically.
2. Add a self-hosted Access application protecting the whole app hostname. Add Allow policy with email exactly `xiexuanxi@outlook.fr`; select OTP provider.
3. Worker must cryptographically verify `Cf-Access-Jwt-Assertion`; do not trust a caller-supplied email header or a decoded but unsigned JWT.
4. Verify JWKS from `${TEAM_DOMAIN}/cdn-cgi/access/certs`, issuer exactly `TEAM_DOMAIN`, audience exactly the Access application's AUD, and restrict signing algorithm to RS256.
5. After JWT validation, compare `payload.email` to the configured admin email; derive admin role on server only.
6. A missing TEAM_DOMAIN/AUD must fail closed in deployed mode. Local demo mode can be explicitly enabled only in local Wrangler configuration, never as an implicit fallback after failed JWT verification.

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';
const jwks = createRemoteJWKSet(new URL(`${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
const { payload } = await jwtVerify(token, jwks, {
  issuer: env.ACCESS_TEAM_DOMAIN,
  audience: env.ACCESS_AUD,
  algorithms: ['RS256'],
});
if (typeof payload.email !== 'string' ||
    payload.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase()) {
  return new Response('Forbidden', {status:403});
}
```

Keep JWKS cached across requests (module-level keyed by team domain). OTP PIN expires 10 minutes after request, is single use, and requesting a new PIN invalidates the previous one. Cloudflare intentionally displays the same sent-code screen to denied addresses, but only allowed addresses receive mail. Do not claim login occurred just because the email was set in app config.

OTP can also be created through `POST /accounts/{account_id}/access/identity_providers` with JSON `{name:'One-time PIN login',type:'onetimepin',config:{}}`.

**Sources:**

- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- Verified Markdown: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/cloudflare-one/integrations/identity-providers/one-time-pin.mdx
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/
- Verified Markdown: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json.mdx

## Wrangler binding shape

```jsonc
{
  "name": "christmas-kitten-studio",
  "main": "server/index.ts",
  "compatibility_date": "2026-11-10",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "ai": {"binding":"AI"},
  "d1_databases": [{
    "binding":"DB",
    "database_name":"christmas-kitten-db",
    "database_id":"ACTUAL-D1-UUID",
    "migrations_dir":"migrations"
  }],
  "r2_buckets": [{"binding":"MEDIA","bucket_name":"christmas-kitten-media"}],
  "vars": {
    "ADMIN_EMAIL":"xiexuanxi@outlook.fr",
    "ACCESS_TEAM_DOMAIN":"https://YOURTEAM.cloudflareaccess.com",
    "ACCESS_AUD":"ACTUAL-APPLICATION-AUDIENCE"
  }
}
```

A placeholder D1 UUID cannot be deployed. Provision once, place the real ID in generated configuration or repository variables; do not silently deploy with fake IDs. `database_id` is not secret. Account ID is not an authentication token, but GitHub docs conventionally place it in secrets alongside API token.

`run_worker_first` with `/api/*` prevents SPA fallback from turning API misses into `index.html`. If server-side auth should also protect static assets on workers.dev, use `run_worker_first:true` and authenticate before ASSETS.fetch, or rely on Access covering the exact hostname and disable unprotected workers.dev route.

Provision commands:

```sh
npx wrangler d1 create christmas-kitten-db
npx wrangler r2 bucket create christmas-kitten-media
npx wrangler d1 migrations apply christmas-kitten-db --remote
npx wrangler secret put SEEDANCE_API_KEY
npx wrangler deploy
```

Use `wrangler d1 migrations apply DB --local` for local tests. Wrangler default local mode persists to local state and does not use production D1/R2. Supply production resources only after the user's deployment credential step.

**Sources:**

- https://developers.cloudflare.com/workers/wrangler/configuration/
- Verified Markdown: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/wrangler/configuration.mdx
- https://developers.cloudflare.com/d1/get-started/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
- https://developers.cloudflare.com/workers/wrangler/commands/r2/
- https://developers.cloudflare.com/workers/static-assets/binding/

## GitHub Actions deployment

Cloudflare's current official sample uses `actions/checkout@v6` and `cloudflare/wrangler-action@v4`. A Node project should install the locked dependencies and build before deploy.

```yaml
name: Deploy Cloudflare Worker
on:
  workflow_dispatch:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: cloudflare-production
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm run build
      - uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: d1 migrations apply DB --remote
      - uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

Use GitHub Environment `production` protection for a review gate if configured. The user explicitly asks to be prompted for credentials at deployment; do not make a first main push deploy without having acquired/configured the production secrets. `workflow_dispatch` alone for initial delivery is the least surprising trigger until configuration is complete.

Cloudflare API token permissions must cover deployed resources: Workers Scripts Edit, D1 Edit, R2 Edit; Access provisioning additionally needs Access Organizations/Identity Providers/Groups and Apps/Policies Edit. Scope to the chosen account; do not request a Global API key.

**Sources:**

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Verified Markdown: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/ci-cd/external-cicd/github-actions.mdx
- https://github.com/cloudflare/wrangler-action
