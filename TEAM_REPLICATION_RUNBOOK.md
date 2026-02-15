# PCF Copilot Replication Runbook (Team Guide)

This guide helps teammates reproduce the exact end result:
- Business-friendly PCF chat UI in Dynamics
- Azure Container App backend
- Microsoft Graph + Excel lookup/update (Azure-first)
- Live deployment to Dataverse via `pac pcf push`

---

## 1) Prerequisites

### Tools required
- Node.js (LTS)
- Power Platform CLI (`pac`)
- Azure CLI (`az`)
- VS Code + GitHub Copilot Chat

### Access required
- Dataverse environment access (maker/admin) for PCF push
- Azure subscription contributor rights
- Entra permissions to create app registration + grant Graph app roles
- Access to target workbook in OneDrive/SharePoint

### Repo folders used
- PCF UI project: `PCFInitTest/PCFReactTest`
- Backend proxy app: `AzureProxyWebApp`

---

## 2) One-time environment login

Run in terminal:

```powershell
az login --tenant <TENANT_ID>
pac auth create --url <DATAVERSE_ENV_URL>
pac auth list
```

---

## 3) Backend setup (Azure-only Graph path)

## 3.1 Create/reuse app registration + Graph permissions

Run:

```powershell
# Variables
$displayName = "pcf-copilot-graph-proxy"

# Create or reuse app
$app = az ad app list --display-name $displayName --query "[0]" -o json | ConvertFrom-Json
if (-not $app) {
  $app = az ad app create --display-name $displayName --sign-in-audience AzureADMyOrg -o json | ConvertFrom-Json
}
$appId = $app.appId
az ad sp create --id $appId | Out-Null

# Resolve Graph service principal + roles
$graphSp = az ad sp show --id 00000003-0000-0000-c000-000000000000 -o json | ConvertFrom-Json
$filesRwAll = ($graphSp.appRoles | Where-Object { $_.value -eq 'Files.ReadWrite.All' -and $_.allowedMemberTypes -contains 'Application' } | Select-Object -First 1).id
$sitesRwAll = ($graphSp.appRoles | Where-Object { $_.value -eq 'Sites.ReadWrite.All' -and $_.allowedMemberTypes -contains 'Application' } | Select-Object -First 1).id

# Add required Graph app roles
az ad app permission add --id $appId --api 00000003-0000-0000-c000-000000000000 --api-permissions "$filesRwAll=Role"
az ad app permission add --id $appId --api 00000003-0000-0000-c000-000000000000 --api-permissions "$sitesRwAll=Role"

# Admin consent (if supported by role)
az ad app permission admin-consent --id $appId

# Create client secret
$secret = az ad app credential reset --id $appId --append --display-name "pcf-copilot-secret" --query password -o tsv
$tenantId = az account show --query tenantId -o tsv

Write-Host "APP_ID=$appId"
Write-Host "TENANT_ID=$tenantId"
Write-Host "SECRET=$secret"
```

> Security: store secret in Key Vault or secure pipeline variable. Do not commit secrets.

---

## 3.2 Resolve workbook Drive/Item IDs

If you have a share link to workbook:

```powershell
# Use app token
$tenant = "<TENANT_ID>"
$client = "<APP_ID>"
$secret = "<APP_SECRET>"
$token = Invoke-RestMethod -Method Post -Uri "https://login.microsoftonline.com/$tenant/oauth2/v2.0/token" -ContentType 'application/x-www-form-urlencoded' -Body @{
  client_id=$client
  client_secret=$secret
  scope='https://graph.microsoft.com/.default'
  grant_type='client_credentials'
}
$headers = @{ Authorization = "Bearer $($token.access_token)" }

# Example: list tables once drive+item are known
Invoke-RestMethod -Method Get -Uri "https://graph.microsoft.com/v1.0/drives/<GRAPH_DRIVE_ID>/items/<GRAPH_ITEM_ID>/workbook/tables" -Headers $headers | ConvertTo-Json -Depth 8
```

Capture:
- `GRAPH_DRIVE_ID`
- `GRAPH_ITEM_ID`
- Table names or IDs (for orders/orderlines/customers/products)

---

## 3.3 Configure Container App env vars

```powershell
az containerapp update -n <APP_NAME> -g <RESOURCE_GROUP> --set-env-vars \
BACKEND_MODE=graph \
GRAPH_TENANT_ID=<TENANT_ID> \
GRAPH_CLIENT_ID=<APP_ID> \
GRAPH_CLIENT_SECRET=<APP_SECRET> \
GRAPH_DRIVE_ID=<GRAPH_DRIVE_ID> \
GRAPH_ITEM_ID=<GRAPH_ITEM_ID> \
GRAPH_TABLE_ORDERS=<TABLE_NAME_OR_ID> \
GRAPH_TABLE_ORDERLINES=<TABLE_NAME_OR_ID> \
GRAPH_TABLE_CUSTOMERS=<TABLE_NAME_OR_ID> \
GRAPH_TABLE_PRODUCTS=<TABLE_NAME_OR_ID>
```

---

## 3.4 Deploy backend code

```powershell
Set-Location .\AzureProxyWebApp
node --check .\src\server.js
az containerapp up --name <APP_NAME> --resource-group <RESOURCE_GROUP> --environment <ENV_NAME> --source . --ingress external --target-port 8080
```

Expected route:
- `POST /api/chat-proxy`
- body: `{ "input": "..." }`

---

## 4) PCF UI setup and deployment

## 4.1 Build and push

```powershell
Set-Location .\PCFInitTest\PCFReactTest
npm install
npm run build
pac pcf push
```

If update not visible, bump control version in:
- `PCFInitTest/PCFReactTest/CopilotReactControl/ControlManifest.Input.xml`

Then build + push again.

---

## 4.2 UI expected outcome

The final UI should include:
- No endpoint input/save button in chat
- Send executes updates directly (no confirm dialog)
- In-chat typing bubble (`Agent is typing...`) with spinner
- Business-friendly errors (no technical stack text)
- Header copy:
  - Title: `Order Operations Assistant`
  - Subtitle: business wording
- Centered Milliken logo under header:
  - `https://www.milliken.com/-/media/milliken/footer-v2/milliken-logo-footer.svg`

---

## 5) Validation checklist

## 5.1 Backend API smoke tests

```powershell
$uri = 'https://<YOUR_CONTAINER_APP_FQDN>/api/chat-proxy'

# Lookup
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (@{ input = 'lookup order 6600000942' } | ConvertTo-Json) | ConvertTo-Json -Depth 8

# Update
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (@{ input = 'update order 6600000942 status=Confirmed' } | ConvertTo-Json) | ConvertTo-Json -Depth 8

# Re-lookup confirm persisted value
Invoke-RestMethod -Uri $uri -Method Post -ContentType 'application/json' -Body (@{ input = 'lookup order 6600000942' } | ConvertTo-Json) | ConvertTo-Json -Depth 8
```

## 5.2 In-app prompts for business users

Use these directly in the chat:
- `lookup order 6600000942`
- `update order 6600000942 status=Shipped`
- `lookup customer C000029`
- `lookup product SKU-00081`
- `update orderline order=6600000942 line=2 openqty=10`
- `track shipment for order 6600000680`
- `carrier events / milestones for order 6600000680`
- `inventory availability for MIL-INV-1002`
- `where can I get MIL-INV-1002`
- `list locations`
- `allocations for order 6600000942`
- `send email update to customer for order 6600000942`

---

## 6) Copilot prompts teammates can use during execution

### Prompt A: Backend end-to-end execution

```text
Implement Azure-only lookup/update for this project using Microsoft Graph Excel in AzureProxyWebApp. Do not rely on Power Automate for core lookup/update logic. Configure backend mode graph, add env-driven table mappings, deploy to existing Container App, and run smoke tests for lookup/update/lookup. Return exact commands executed and results.
```

### Prompt B: Business UI polish in PCF

```text
Update the PCF chat UI in PCFInitTest/PCFReactTest/CopilotAgentUI.tsx for business users: remove endpoint controls, remove update confirmation modal, keep rich cards, add in-chat typing spinner bubble, simplify error text for non-technical users, update header copy to business language, and add centered Milliken logo under header. Build and confirm success.
```

### Prompt C: Deploy latest PCF changes

```text
Build and push the PCF control from PCFInitTest/PCFReactTest to the currently connected Dataverse environment. If needed, increment ControlManifest.Input.xml version first. Confirm import/publish succeeded.
```

### Prompt D: Full replication in one run

```text
Reproduce this solution end-to-end in this repo: Azure Container App backend with Graph Excel lookup/update, business-friendly PCF chat UI, build and deploy both backend and PCF, and provide final validation outputs with runnable test prompts.
```

---

## 7) Troubleshooting

- `Cannot POST /api/chat-proxy`
  - Verify route path and deployment image version.
- `Graph request failed (404)`
  - Table mapping names/IDs likely incorrect.
- `403 access denied`
  - Missing Graph app role assignment/admin consent.
- PCF not showing latest UI
  - Increment manifest version and run `pac pcf push` again.
- Intermittent auth/deployment issues
  - Re-run `az login` and verify tenant/subscription context.

---

## 8) Security hardening (required after setup)

- Rotate `GRAPH_CLIENT_SECRET` after initial rollout.
- Prefer Key Vault references for secrets.
- Restrict allowed origins in backend CORS.
- Use least-privileged Graph permissions when feasible.

---

## 9) Definition of Done

- Backend in Azure responds to lookup and update prompts successfully.
- Updates persist in workbook and are visible on follow-up lookup.
- PCF UI is business-clean (no endpoint controls, no confirm modal, typing indicator in-chat, logo centered).
- `npm run build` succeeds and `pac pcf push` import/publish succeeds.
- Team can reproduce using this runbook and prompts.
