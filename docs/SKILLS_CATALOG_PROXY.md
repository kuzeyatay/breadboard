# Skills catalog proxy

## Architecture and trust boundaries

```text
Breadboard renderer
  -> authenticated Breadboard dashboard routes
     -> unauthenticated HTTPS to the Breadboard catalog proxy
        -> request-scoped Vercel OIDC identity
           -> fixed https://skills.sh/api/v1 upstream
```

The renderer never calls the proxy or skills.sh directly. The dashboard sends
only `Accept: application/json` to the configured proxy and sends no catalog
credential. The standalone `skills-catalog-proxy/` application is the only
Breadboard component that obtains an OIDC token. It accepts only the documented
read-only catalog routes, validates paths and query parameters, discards incoming
authorization and arbitrary headers, and sends the token only to the fixed
skills.sh origin.

This boundary exists because skills.sh authenticates programmatic catalog calls
with a Vercel deployment identity. Breadboard users do not have to create a
Vercel account, sign in to Vercel, install its CLI, or receive an API key. The
desktop application contains only the public proxy URL.

## Proxy deployment

The deployment operator, not an end user, performs these steps:

1. In the Vercel dashboard, import the Breadboard repository as a new project.
2. Set the project's Root Directory to `skills-catalog-proxy` and leave the
   framework preset as Next.js.
3. Open the project's Settings, enable OIDC Federation under Security, and use
   team issuer mode unless the organization's trust policy requires global mode.
4. Deploy to production. No long-lived upstream secret is added to the project.
5. Verify `GET https://<production-domain>/api/health` returns `200` and a small
   `ok` response. This endpoint never requests an identity token.
6. Verify a supported route such as `GET /api/v1/skills?per_page=1` returns JSON.
   A `401` here means the deployment identity is not accepted by skills.sh;
   confirm OIDC is enabled and the project/team/environment claims are correct.
7. Assign or confirm the production domain and set
   `BREADBOARD_SKILLS_CATALOG_URL=https://<production-domain>/api/v1` in the
   server or desktop development environment. The checked-in desktop default is
   `https://breadboard-skills-catalog-kuzeyatay.vercel.app/api/v1`.

Vercel exposes function identity in request context. The route handler calls the
official helper inside each request handler; it is deliberately not called at
module scope. The upstream validates Vercel's issuer, audience, subject, expiry,
and signing key. If a Vercel team or project is renamed, review those trust
claims before promoting the next deployment.

## Configuration and local development

`BREADBOARD_SKILLS_CATALOG_URL` is required by an ordinary standalone dashboard
process. It must be an HTTPS URL with no credentials, query string, or fragment,
and its path must be exactly `/api/v1`. HTTP is accepted only for `localhost`,
`127.0.0.1`, or `[::1]` proxy testing. A direct skills.sh URL is rejected.

Desktop always injects the public production default into its supervised
dashboard process unless the parent process provides an override. The value is
server configuration and is not placed in Electron preload/IPC state,
diagnostics, or renderer-visible runtime configuration. For ordinary dashboard
development, copy the value from `dashboard/.env.example` into
`dashboard/.env.local`.

Proxy unit tests do not require a real identity: they inject a fake token getter
and upstream fetch. A local end-to-end proxy call does require an operator-owned
Vercel development identity; this is not part of end-user setup.

## Caching, rate limits, and outages

Successful proxy responses use bounded CDN `s-maxage` and
`stale-while-revalidate` policies, while respecting an upstream `no-store` or
`private` directive. Only content/cache validators, retry timing, and rate-limit
headers are returned. Upstream HTML and arbitrary headers are never proxied.
The dashboard retains its bounded timeout, retry, jitter, rate-limit parsing,
refresh coalescing, and durable synchronization-failure record.

The durable catalog snapshot is the product's availability boundary:

- fresh local data is returned immediately;
- stale data remains available while background revalidation runs;
- a failed refresh never replaces or deletes the last-known-good snapshot;
- an unavailable proxy with no first-run snapshot produces a truthful catalog
  unavailable response, not an application startup failure;
- approved and conditional skills remain installed and usable during an outage;
- Garden Chat, Terminal, Quartz, startup, and unrelated features do not depend
  on proxy availability.

## Download, quarantine, approval, and updates

Catalog installation fetches a fresh detail record through the proxy and uses
its complete file tree. It does not use a package manager, a system Node runtime,
the Skills CLI, Git, or a shell. Breadboard requires a nonempty snapshot with
exactly one root `SKILL.md`, validates every normalized path and all file/count/
aggregate/depth limits before writing, and rejects traversal, ambiguous
separators, Windows reserved names, collisions, and escaping paths.

Files are written as UTF-8 with exclusive creation into a fresh isolated staging
directory. Breadboard inspects and classifies the complete staging tree without
executing it, then atomically replaces the inactive quarantine entry. Database
and audit records keep the upstream stable id, source, slug, upstream hash,
catalog revision, and a separate deterministic local SHA-256. Upstream and local
hashes are not claimed to use the same algorithm.

Promotion remains an explicit user decision. Breadboard re-hashes the reviewed
tree before promotion; changed content is rejected. General skills enter the
approved directory and coding skills enter the conditional directory. Updates
are downloaded into quarantine first and never update an installed directory in
place. A locally modified installation is marked for review and is not
overwritten. If the upstream detail contains no snapshot, installation stops
with a sanitized snapshot-unavailable result and leaves existing copies intact.

Packaged mutable directories remain below the desktop data root. They are not
stored in `resources`, `app.asar`, `.next`, or the installation directory, so
normal application restart, reinstall, and update operations do not delete them.

## Security limitations and operations

The proxy reduces credential exposure and request forgery risk; it does not make
third-party skill content trustworthy. Catalog classification and static
inspection are review aids, not a sandbox or malware proof. Approval grants only
the existing Breadboard capability envelope, and conditional skills still need
an authorized scoped implementation task.

Operators should monitor sanitized status counts, upstream latency, `429`/`5xx`
rates, and CDN behavior without logging authorization headers, response file
contents, or full request bodies. Keep the allowlisted routes narrow when the
upstream API changes. Before an update, run the proxy, dashboard, and desktop
test/build matrix, deploy a preview, test health/list/search/detail/audit, then
promote the proxy before releasing a desktop build that depends on new behavior.
