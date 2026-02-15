# Azure Proxy Web App

Secure proxy endpoint for the PCF chat control.

## Endpoint
- POST `/api/chat-proxy`
- Request body: `{ "input": "look up order 6600000680" }`
- Response body always includes `result`, and can include structured fields (`order`, `customer`, `lines`, `products`, `intent`).

## Local
```powershell
npm install
$env:PORT=8080; node .\src\server.js
```

## Backend Modes
- `BACKEND_MODE=graph` -> Azure-only mode (Microsoft Graph direct Excel read/write)
- `BACKEND_MODE=flow` -> Power Automate mode only
- `BACKEND_MODE=auto` -> try Graph if configured, otherwise fall back to flow

## Graph (Azure-only) App Settings
Required:
- `BACKEND_MODE=graph` (or `auto`)
- `GRAPH_TENANT_ID`
- `GRAPH_CLIENT_ID`
- `GRAPH_CLIENT_SECRET`
- `GRAPH_DRIVE_ID`
- `GRAPH_ITEM_ID`
- `GRAPH_MAIL_SENDER_UPN` (mailbox used to send outbound customer emails)

Email provider selection:
- `EMAIL_PROVIDER=graph` (default)
- `EMAIL_PROVIDER=sendgrid` (recommended for broader personal-email deliverability)
- `EMAIL_PROVIDER=auto` (domain-based routing: Graph by default, SendGrid for consumer domains when configured)

Optional routing/fallback settings:
- `EMAIL_CONSUMER_DOMAINS` (comma-separated; defaults include outlook.com, gmail.com, yahoo.com, icloud.com, etc.)
- `EMAIL_PROVIDER_FALLBACK=sendgrid|graph|auto|none` (empty/none disables fallback)

SendGrid settings (required when `EMAIL_PROVIDER=sendgrid`):
- `SENDGRID_API_KEY`
- `SENDGRID_FROM_EMAIL` (verified sender/domain in SendGrid)
- `SENDGRID_FROM_NAME` (optional)

Optional table names:
- `GRAPH_TABLE_ORDERS` (default `Orders`)
- `GRAPH_TABLE_ORDERLINES` (default `OrderLines`)
- `GRAPH_TABLE_CUSTOMERS` (default `Customers`)
- `GRAPH_TABLE_PRODUCTS` (default `Products`)

## Flow fallback App Settings
- `FLOW_BASE_URL` OR `FLOW_LOOKUP_BASE_URL` + `FLOW_UPDATE_BASE_URL`
- `FLOW_API_VERSION`, `FLOW_SP`, `FLOW_SV`, `FLOW_SIG`
- `COPILOT_UPSTREAM_URL` (direct override)
- `COPILOT_UPSTREAM_API_KEY` (optional)

## Security App Settings
- `ALLOWED_ORIGINS` (comma-separated)
- `REQUIRE_SHARED_SECRET` (`true|false`)
- `PROXY_SHARED_SECRET` (optional)

## Microsoft Graph permissions
Grant app permission and admin consent:
- `Files.ReadWrite.All`
- `Mail.Send` (required for `notify`/email action)
- `Sites.ReadWrite.All` (recommended for SharePoint/OneDrive access reliability)

## Deliverability note (personal email)
For personal inbox targets (Outlook.com, Gmail, Yahoo, etc.), `sendgrid` provider is usually more reliable than direct Graph mailbox sending if recipient domains are enforcing strict anti-spam policies. Use verified sender domain with SPF/DKIM/DMARC.

## Customer Email Notification Action
The proxy now supports `notify` intents for customer email updates.

Example prompts:
- `send email update to customer for order 6600000942`
- `notify customer C000029 about shipping for order 6600000942`
- `email customer for order 6600000942 message: Your order has shipped and is on the way.`
- `send email update to customer for order 6600000942 email=someone@contoso.com`

Behavior:
- Resolves order/customer from workbook tables.
- Finds recipient email from customer columns (`Email`, `EmailAddress`, `EmailAddress1`, `ContactEmail`, etc.).
- Sends mail using selected provider strategy:
	- `graph`: always Graph (`GRAPH_MAIL_SENDER_UPN`)
	- `sendgrid`: always SendGrid
	- `auto`: SendGrid for consumer recipient domains, Graph otherwise
- Can attempt fallback provider when `EMAIL_PROVIDER_FALLBACK` is set.
- Returns delivery result payload to the PCF pane.

## Notes
- For order-line updates, include a stable key column in Excel (`LineKey = OrderNumber-LineNumber`) for deterministic updates.
- For best reliability under concurrent edits, migrate from Excel tables to Dataverse or Azure SQL later.
