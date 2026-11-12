# Cloudflare Access automation — verified 2026-11-12

## Recommended next human step

Open https://one.dash.cloudflare.com for the intended Cloudflare account, complete Zero Trust onboarding, select **Free**, and complete the payment-details step. Cloudflare's current official instructions explicitly require selecting a subscription and entering payment details even for Free, while stating Free will not be charged. Do not silently create or change a subscription through the API.

After onboarding, the user can add these **account-scoped** permission groups to the token already saved in GitHub `production` Secrets:

- **Access: Organizations, Identity Providers, and Groups — Edit**
- **Access: Apps and Policies — Edit**

The current documentation labels them `Edit` for account API tokens; a user API token section may use `Write`. Keep existing Workers / D1 / R2 permissions. No Global API Key, password, mailbox access, or external email provider is needed. The workflow can then discover the existing organization, create/reuse the OTP IdP, and create the single-hostname Access app and owner-only policy automatically.

Official onboarding statement: `Complete your onboarding by selecting a subscription plan and entering your payment details. If you chose the Zero Trust Free plan, this step is still needed but you will not be charged.`

Sources:

- https://developers.cloudflare.com/cloudflare-one/setup/
- Exact rendered partial: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/partials/cloudflare-one/choose-team-name.mdx
- Permission labels: https://developers.cloudflare.com/fundamentals/api/reference/permissions/
- Verified source: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/fundamentals/api/reference/permissions.mdx

## Common API conventions

Base: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}`

Headers: `Authorization: Bearer {CLOUDFLARE_API_TOKEN}` and `Content-Type: application/json`.

Responses use the Cloudflare envelope `{ "success": true, "errors": [], "result": ... }`. Only use `result` after both HTTP success and `success:true`. Follow pagination for list endpoints. Do not output request headers or token values. A permission failure is not evidence that the organization does not exist.

## 1. Reuse the existing Zero Trust organization

**GET `/access/organizations`**

The result is a **single organization object**, not a paginated array. Read `result.auth_domain`, typically `yourteam.cloudflareaccess.com`, and derive `ACCESS_TEAM_DOMAIN = "https://" + result.auth_domain` after hostname validation. Preserve the existing team name, organization name, IdPs, global session/MFA settings, and subscription.

If the org is absent or uninitialized, fail with the dashboard onboarding instruction. Do not interpret a generic 403 as absence, and do not repeatedly attempt organization creation.

**Organization creation reference only:** **POST `/access/organizations`** exists. Current official SDK marks all body fields optional; `auth_domain` can be auto-generated when omitted and `name` defaults accordingly. A supported explicit body is:

```json
{
  "name": "Christmas Kitten Studio",
  "auth_domain": "chosen-unique-team-name.cloudflareaccess.com",
  "session_duration": "24h"
}
```

There is **no `email_settings` field** in the verified `OrganizationCreateParams` schema. Org creation does not document selecting a Free billing plan or supplying payment details. An existing organization should be reused, so the proposed automation needs only GET here, not POST or PUT.

Sources:

- https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/list/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/organizations/methods/create/
- Verified official API client: https://raw.githubusercontent.com/cloudflare/cloudflare-typescript/main/src/resources/zero-trust/organizations/organizations.ts

## 2. Reuse or create the email One-time PIN IdP

**GET `/access/identity_providers`**

Reuse an existing `result[]` entry with `type:"onetimepin"`; its `id` is used below. Do not rename or change existing IdPs. If none exists:

**POST `/access/identity_providers`**

```json
{
  "name": "Email one-time PIN",
  "type": "onetimepin",
  "config": {}
}
```

Read `result.id`. The OTP provider sends the code; the app does not need an SMTP key. New organizations use the Cloudflare identity provider by default and no longer automatically include OTP.

Sources:

- https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/
- Official how-to with this exact body: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/cloudflare-one/integrations/identity-providers/one-time-pin.mdx
- API client: https://raw.githubusercontent.com/cloudflare/cloudflare-typescript/main/src/resources/zero-trust/identity-providers/identity-providers.ts

## 3. Create/reuse only the planned app hostname

**GET `/access/apps`** to find the dedicated application by exact hostname and app name. Use no wildcard, path prefix, all-workers destination, or account-wide setting. If an unrelated existing app already owns this hostname, stop and report the collision instead of replacing its policy.

**POST `/access/apps`**

Example for planned hostname `christmas-kitten-studio.ACCOUNT-SUBDOMAIN.workers.dev` (replace with the discovered actual hostname):

```json
{
  "name": "Christmas Kitten Studio",
  "type": "self_hosted",
  "domain": "christmas-kitten-studio.ACCOUNT-SUBDOMAIN.workers.dev",
  "destinations": [
    {
      "type": "public",
      "uri": "christmas-kitten-studio.ACCOUNT-SUBDOMAIN.workers.dev"
    }
  ],
  "allowed_idps": ["OTP-IDP-ID"],
  "auto_redirect_to_identity": true,
  "app_launcher_visible": true,
  "http_only_cookie_attribute": true,
  "session_duration": "24h",
  "policies": [
    {
      "name": "Kitten Studio administrator",
      "decision": "allow",
      "precedence": 1,
      "include": [
        {"email": {"email": "xiexuanxi@outlook.fr"}}
      ],
      "exclude": [],
      "require": []
    }
  ]
}
```

Inline policy creation is supported by the current application schema and official Workers Access examples. It avoids having to create the app and policy in separate calls. `auto_redirect_to_identity:true` is valid because `allowed_idps` contains exactly one IdP. `destinations` is the current shape; deprecated `self_hosted_domains` should not be used.

Read **`result.id`** (app ID) and **`result.aud`** (the signing audience). `aud` is generated by Access; never invent it or use app ID instead. If the create response omits `aud`, **GET `/access/apps/{app_id}`** and require a nonempty valid AUD before deploying the Worker. Write the discovered domain/AUD into the deployment's Wrangler vars as `ACCESS_TEAM_DOMAIN` and `ACCESS_AUDIENCE`. They are public configuration, not secrets.

The official Workers docs explicitly support **hostname-based Access for `workers.dev`**, custom domains, or paths using a self-hosted application's `domain`. Protecting a specific hostname is narrower than `destinations:[{type:"worker",worker_id:...}]`, which protects all that Worker's routes and previews. Continue keeping `preview_urls:false`.

Sources:

- https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/
- https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/get/
- Exact `SelfHostedApplication` request and `aud` response schemas: https://raw.githubusercontent.com/cloudflare/cloudflare-typescript/main/src/resources/zero-trust/access/applications/applications.ts
- Hostname-based workers.dev support and inline policy example: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Verified Markdown: https://raw.githubusercontent.com/cloudflare/cloudflare-docs/production/src/content/docs/workers/configuration/cloudflare-access.mdx

## 4. Policy endpoints for existing-app reconciliation

If an existing dedicated app is reused, inspect all its policies before making any change:

- **GET `/access/apps/{app_id}/policies`**
- **POST `/access/apps/{app_id}/policies`** creates a policy exclusive to this app.
- **PUT `/access/apps/{app_id}/policies/{policy_id}`** updates that app-specific policy.

The standalone POST body is the same policy object shown inline above:

```json
{
  "name": "Kitten Studio administrator",
  "decision": "allow",
  "precedence": 1,
  "include": [{"email": {"email": "xiexuanxi@outlook.fr"}}],
  "exclude": [],
  "require": []
}
```

Before declaring owner-only access configured, verify the app has only the intended Allow policy and no other Allow, Bypass, or Service Auth rule granting wider access. If unrelated policies exist, stop instead of deleting or weakening them. Keep the app name/domain/policy IDs in deployment metadata so reruns reuse their own resources. Re-fetch the app after create/update and verify exact hostname/destinations/IdP/policy/AUD. The Worker must still validate JWT signature, issuer, audience, expiry and owner email itself.

Cloudflare recommends reusable policies in its generic API documentation; a dedicated app-specific policy is supported and limits this automation's scope. Avoid editing a reusable policy shared by other apps.

Sources:

- https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/subresources/policies/methods/create/
- https://raw.githubusercontent.com/cloudflare/cloudflare-typescript/main/src/resources/zero-trust/access/applications/policies.ts
- Exact regular policy field serialization in official Go client: https://raw.githubusercontent.com/cloudflare/cloudflare-go/main/zero_trust/accessapplicationpolicy.go

## Human versus automated boundary

The next user step can be only **complete Zero Trust Free onboarding**. After it is complete, ask for only the token permission edit if still needed. Once the updated token is saved as the same GitHub secret, the workflow can handle organization discovery, OTP IdP, hostname-scoped app, exact owner policy, audience extraction, Wrangler configuration and deployment. The user should not need to copy an Access AUD manually.

No authenticated Cloudflare requests or subscription changes were performed for this research.
