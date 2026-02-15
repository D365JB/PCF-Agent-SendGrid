# Team Quick Start (1-Page)

Use this when you need to replicate the solution quickly.

## Goal
Deliver a business-ready PCF chat assistant with:
- Azure backend (`/api/chat-proxy`)
- Graph + Excel lookup/update
- Clean business UI in Dynamics

---

## 1) Login

```powershell
az login --tenant <TENANT_ID>
pac auth create --url <DATAVERSE_ENV_URL>
pac auth list
```

---

## 2) Build + deploy backend

From `AzureProxyWebApp`:

```powershell
node --check .\src\server.js
az containerapp up --name <APP_NAME> --resource-group <RESOURCE_GROUP> --environment <ENV_NAME> --source . --ingress external --target-port 8080
```

Set Graph env vars:

```powershell
az containerapp update -n <APP_NAME> -g <RESOURCE_GROUP> --set-env-vars \
BACKEND_MODE=graph \
GRAPH_TENANT_ID=<TENANT_ID> \
GRAPH_CLIENT_ID=<APP_ID> \
GRAPH_CLIENT_SECRET=<APP_SECRET> \
GRAPH_DRIVE_ID=<GRAPH_DRIVE_ID> \
GRAPH_ITEM_ID=<GRAPH_ITEM_ID> \
GRAPH_TABLE_ORDERS=<ORDERS_TABLE> \
GRAPH_TABLE_ORDERLINES=<ORDERLINES_TABLE> \
GRAPH_TABLE_CUSTOMERS=<CUSTOMERS_TABLE> \
GRAPH_TABLE_PRODUCTS=<PRODUCTS_TABLE>
```

---

## 3) Build + push PCF

From `PCFInitTest/PCFReactTest`:

```powershell
npm install
npm run build
pac pcf push
```

If changes do not appear, increment version in:
- `PCFInitTest/PCFReactTest/CopilotReactControl/ControlManifest.Input.xml`

Then run build + push again.

---

## 4) Smoke tests

```powershell
$uri = 'https://<CONTAINER_APP_FQDN>/api/chat-proxy'
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (@{ input = 'lookup order 6600000942' } | ConvertTo-Json)
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (@{ input = 'update order 6600000942 status=Confirmed' } | ConvertTo-Json)
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (@{ input = 'lookup order 6600000942' } | ConvertTo-Json)
```

---

## 5) In-app prompts (business users)

- `lookup order 6600000942`
- `update order 6600000942 status=Shipped`
- `lookup customer C000029`
- `lookup product SKU-00081`

---

## 6) Copilot prompts for teammates

## Prompt A (full replicate)

```text
Reproduce this solution end-to-end in this repo: Azure Container App backend with Graph Excel lookup/update, business-friendly PCF chat UI, build and deploy backend and PCF, and provide smoke test outputs.
```

## Prompt B (backend only)

```text
Implement and deploy Azure-only Graph Excel lookup/update in AzureProxyWebApp, configure env vars for graph mode, and run lookup/update/lookup smoke tests.
```

## Prompt C (UI only)

```text
Polish PCF UI for business users in PCFInitTest/PCFReactTest/CopilotAgentUI.tsx: remove endpoint controls, remove update confirmation, add in-chat typing spinner, simplify error copy, keep rich cards, add centered Milliken logo below header, then build.
```

## Prompt D (push latest PCF)

```text
Build and push PCF from PCFInitTest/PCFReactTest to current Dataverse environment. Bump manifest version if needed and confirm publish success.
```

---

## 7) Expected UI

- No endpoint textbox
- No update-confirm dialog
- In-chat “Agent is typing...” spinner bubble
- Business-friendly messages
- Milliken logo centered under header

---

## 8) Required hardening after rollout

- Rotate Graph client secret
- Store secrets securely (prefer Key Vault)
- Restrict allowed CORS origins
