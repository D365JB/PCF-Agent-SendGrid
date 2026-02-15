# Azure Proxy Function for PCF Copilot

This project provides a secure HTTP proxy endpoint for the PCF control.

## Contract
- Request: `POST /api/chat-proxy` with body:

```json
{ "input": "look up order 6600000680" }
```

- Response:

```json
{ "result": "..." }
```

## Local run
1. Install Azure Functions Core Tools v4 and Node 20.
2. In this folder, run:

```powershell
npm install
Copy-Item local.settings.sample.json local.settings.json
npm run start
```

3. Set `COPILOT_UPSTREAM_URL` in `local.settings.json` to your working backend (Power Automate URL or other).

## Security knobs
- `authLevel: function` (host-generated function key required)
- CORS allowlist via `ALLOWED_ORIGINS`
- Optional extra shared secret header `x-proxy-key`:
  - `REQUIRE_SHARED_SECRET=true`
  - `PROXY_SHARED_SECRET=<value>`

## Deploy to Azure
1. Create Function App (Node 20, Consumption/Premium/App Service Plan).
2. Deploy this folder.
3. In Function App settings, set:
   - `COPILOT_UPSTREAM_URL`
   - `COPILOT_UPSTREAM_API_KEY` (optional)
   - `ALLOWED_ORIGINS`
   - `REQUIRE_SHARED_SECRET`
   - `PROXY_SHARED_SECRET` (if required)
4. Get function URL with key for `chatProxy`.
5. Paste that URL into your PCF **Save Endpoint** field.

## Recommended hardening
- Use Managed Identity + Key Vault references for upstream secrets.
- Restrict allowed origins to your exact app hosts.
- Enable App Insights and monitor failed requests/timeouts.
