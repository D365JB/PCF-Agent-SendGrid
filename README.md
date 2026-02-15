# PCF Copilot (Orders Agent)

This repo contains:
- A **Power Apps Component Framework (PCF)** control (React) used in a model-driven app pane.
- An **Azure Container App** backend that:
  - Looks up and updates order data (Microsoft Graph Excel workbook tables)
  - Sends customer emails (Graph or SendGrid)
  - Tracks shipments from workbook event tables (carrier/SAP events -> predicted delay -> proactive notification)

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

### 6) Set up the Excel workbook
This repo includes a sanitized starter workbook you can upload to OneDrive/SharePoint:
- `excel-templates/SAP_Order_Simulator_TEMPLATE.xlsx`

If you need to regenerate the template workbook, see `excel-templates/generate_workbook_template.py`.

Minimum for Graph workbook lookup/update:
- `BACKEND_MODE=graph`
- `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`
- `GRAPH_DRIVE_ID`, `GRAPH_ITEM_ID`

For email sending:
- Graph: `EMAIL_PROVIDER=graph` + `GRAPH_MAIL_SENDER_UPN`
- SendGrid: `EMAIL_PROVIDER=sendgrid` + `SENDGRID_API_KEY` + `SENDGRID_FROM_EMAIL`

## Example prompts (end users)

> Tip: the proxy supports both “plain English” and explicit key/value tokens like `ordernumber=...`.

### Orders
- `lookup order 6600000942`
- `order 6600000942`
- `update order 6600000942 status=Shipped`

### Order lines
- `lookup orderline order=6600000942 line=2`
- `update orderline order=6600000942 line=2 openqty=10`

### Customers
- `lookup customer C000029`

### Products
- `lookup product SKU-00081`

### Shipments
- `track shipment for order 6600000680`
- `carrier events / milestones for order 6600000680`
- `is order 6600000680 running late?`

### Inventory + locations (where to get it)
- `inventory availability for MIL-INV-1002` (InventoryId)
- `inventory availability for MIL-CHEM-GREEN95` (SKU)
- `where can I get MIL-INV-1002`
- `inventory for sku MIL-CHEM-GREEN95 at locationid=MIL-SPART-01`
- `list locations`

### Order allocations
- `allocations for order 6600000942`

### Customer email notification
- `send email update to customer for order 6600000942`
- `email customer for order 6600000942 message: Your order has shipped and is on the way.`

## Docs
- See [AzureProxyWebApp/README.md](AzureProxyWebApp/README.md) for full backend details.
- See [TEAM_QUICKSTART.md](TEAM_QUICKSTART.md) for a short runbook.
- See [TEAM_REPLICATION_RUNBOOK.md](TEAM_REPLICATION_RUNBOOK.md) for deeper setup.
- See [excel-templates/README.md](excel-templates/README.md) for the all-up Excel workbook template (`SAP_Order_Simulator_TEMPLATE.xlsx`).
- Optional: See [EXCEL_SHIPMENT_TABLES.md](EXCEL_SHIPMENT_TABLES.md) for the shipment table schema (already included in the template workbook).
