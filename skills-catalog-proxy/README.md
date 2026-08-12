# Breadboard skills catalog proxy

This isolated Vercel application is Breadboard's server-to-server gateway to the public `skills.sh` catalog. It acquires a request-scoped Vercel OIDC token, sends that token only to the fixed `https://skills.sh/api/v1` upstream, and returns sanitized public JSON.

The proxy accepts only `GET`/`HEAD` catalog list, search, curated, detail, and audit routes. It does not accept an upstream URL, forward client authorization, expose CORS, or return identity tokens.

## Deploy

1. Import the Breadboard repository as a separate Vercel project and set its Root Directory to `skills-catalog-proxy`.
2. In project Settings -> Security, enable OIDC Federation (team issuer mode is the recommended default).
3. Deploy to production and verify `GET /api/health`.
4. Verify `GET /api/v1/skills?per_page=1`; a 401 means the deployment identity is not being accepted upstream.
5. Set Breadboard's server-side `BREADBOARD_SKILLS_CATALOG_URL` to `https://<production-domain>/api/v1`.

No catalog credentials or Vercel login are required on Breadboard user machines.

## Local checks

```powershell
npm test
npm run build
```

Local proxy requests that reach skills.sh require a Vercel-provided OIDC environment. Unit tests inject a fake request-scoped identity provider and never use a real token.

The complete trust model, outage behavior, skill quarantine lifecycle, and
release procedure are in `../docs/SKILLS_CATALOG_PROXY.md`.
