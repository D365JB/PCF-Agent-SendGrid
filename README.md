# PCF Copilot (Orders Agent)

This repo contains:
- A **Power Apps Component Framework (PCF)** control (React) used in a model-driven app pane.
- An **Azure Container App** backend that:
  - Looks up and updates order data (Microsoft Graph Excel workbook tables)
  - Sends customer emails (Graph or SendGrid)

## Quick start (simple)

### 1) Install prerequisites
- Node.js LTS
- Power Platform CLI (`pac`)
- Azure CLI (`az`)

### 2) Build the PCF control
```powershell
npm install
npm run build
```

### 3) Run backend locally (optional)
```powershell
cd AzureProxyWebApp
npm install
node .\src\server.js
```

### 4) Deploy backend to Azure Container Apps
This repo is set up to deploy with:
```powershell
cd AzureProxyWebApp
az containerapp up --name <your-containerapp> --resource-group <your-rg> --source .
```

### 5) Configure backend settings
Set **App Settings** (environment variables) on the Container App.

Minimum for Graph workbook lookup/update:
- `BACKEND_MODE=graph`
- `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`
- `GRAPH_DRIVE_ID`, `GRAPH_ITEM_ID`

For email sending:
- Graph: `EMAIL_PROVIDER=graph` + `GRAPH_MAIL_SENDER_UPN`
- SendGrid: `EMAIL_PROVIDER=sendgrid` + `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`

## Docs
- See [AzureProxyWebApp/README.md](AzureProxyWebApp/README.md) for full backend details.
- See [TEAM_QUICKSTART.md](TEAM_QUICKSTART.md) for a short runbook.
- See [TEAM_REPLICATION_RUNBOOK.md](TEAM_REPLICATION_RUNBOOK.md) for deeper setup.
