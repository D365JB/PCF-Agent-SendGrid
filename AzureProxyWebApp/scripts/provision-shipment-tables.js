/*
  Provision Shipments + ShipmentEvents Excel tables in the configured workbook using Microsoft Graph.

  Requirements (same as backend Graph mode):
    GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_DRIVE_ID, GRAPH_ITEM_ID

  Alternative (recommended when you only have a SharePoint link):
    GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, SHARE_URL

  Optional:
    GRAPH_TABLE_SHIPMENTS (default Shipments)
    GRAPH_TABLE_SHIPMENTEVENTS (default ShipmentEvents)
    PROVISION_FORCE=true to overwrite (drops/recreates tables)
    PROVISION_SAMPLE_DATA=false to create headers-only tables

  Usage:
    cd AzureProxyWebApp
    node scripts/provision-shipment-tables.js
*/

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const REQUIRED_GRAPH_AUTH_ENV = ["GRAPH_TENANT_ID", "GRAPH_CLIENT_ID", "GRAPH_CLIENT_SECRET"];

function getMissingEnvVars(names) {
  return (Array.isArray(names) ? names : [])
    .map((n) => String(n))
    .filter((n) => n)
    .filter((n) => !optionalEnvRaw(n));
}

function printProvisionHelp({ missingAuth, missingWorkbook } = {}) {
  const missingAuthList = Array.isArray(missingAuth) ? missingAuth : [];
  const missingWorkbookList = Array.isArray(missingWorkbook) ? missingWorkbook : [];

  console.error("\nProvisioning setup required:\n");

  if (missingAuthList.length > 0) {
    console.error("Missing Graph auth env vars:");
    for (const name of missingAuthList) console.error(`- ${name}`);
    console.error("");
  }

  if (missingWorkbookList.length > 0) {
    console.error("Missing workbook identifier env vars:");
    for (const name of missingWorkbookList) console.error(`- ${name}`);
    console.error("");
  }

  console.error("You must provide ONE of these workbook identifier options:\n");
  console.error("Option A (direct IDs):");
  console.error("- GRAPH_DRIVE_ID");
  console.error("- GRAPH_ITEM_ID\n");
  console.error("Option B (sharing link):");
  console.error("- SHARE_URL\n");

  console.error("Quick example (PowerShell):");
  console.error(
    "$env:GRAPH_TENANT_ID='<tenant-guid>'\n" +
      "$env:GRAPH_CLIENT_ID='<app-client-id>'\n" +
      "$env:GRAPH_CLIENT_SECRET='<app-secret>'\n" +
      "$env:SHARE_URL='<share link to the workbook>'\n" +
      "npm run provision:shipments\n",
  );
}

function ensureFetchAvailable() {
  if (typeof fetch === "function") return;
  const err = new Error(
    "Global fetch() is not available. Use Node.js 18+ (recommended) to run this provisioning script.",
  );
  err.code = "FETCH_UNAVAILABLE";
  throw err;
}

function optionalEnv(name, defaultValue) {
  const value = String(process.env[name] || "").trim();
  return value || defaultValue;
}

function optionalEnvRaw(name) {
  return String(process.env[name] || "").trim();
}

function isTruthy(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "y";
}

function toBase64Url(input) {
  return Buffer.from(String(input || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildShareIdFromUrl(shareUrl) {
  return `u!${toBase64Url(shareUrl)}`;
}

function toColumnLetter(index1Based) {
  let n = index1Based;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function getEmbeddedTemplate(tableKind) {
  if (tableKind === "shipments") {
    const headers = [
      "ShipmentId",
      "OrderNumber",
      "Mode",
      "Carrier",
      "TrackingNumber",
      "PlannedShipDate",
      "PlannedDeliveryDate",
      "SAPShipmentId",
      "Origin",
      "Destination",
      "CustomerEmailOverride",
      "LastEvaluatedAt",
      "PredictedDeliveryDate",
      "PredictedDelayHours",
      "IsRunningLate",
      "LastMilestoneCode",
      "LastMilestoneAt",
    ];

    const sampleRows = [
      [
        "SHP-6600000680-01",
        "6600000680",
        "parcel",
        "UPS",
        "1Z999AA10123456784",
        "2026-02-15T08:00:00Z",
        "2026-02-22T17:00:00Z",
        "80001234",
        "Dallas",
        "Redmond",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    ];

    return { headers, sampleRows };
  }

  if (tableKind === "shipmentevents") {
    const headers = [
      "ShipmentId",
      "TrackingNumber",
      "Source",
      "EventTime",
      "EventCode",
      "Status",
      "EventDescription",
      "Location",
      "EstimatedDeliveryDate",
      "Mode",
    ];

    const sampleRows = [
      [
        "SHP-6600000680-01",
        "1Z999AA10123456784",
        "Carrier",
        "2026-02-15T10:15:00Z",
        "PU",
        "Picked up",
        "Picked up by carrier",
        "Dallas",
        "2026-02-22T17:00:00Z",
        "parcel",
      ],
      [
        "SHP-6600000680-01",
        "1Z999AA10123456784",
        "Carrier",
        "2026-02-16T03:40:00Z",
        "IT",
        "In transit",
        "Departed facility",
        "Dallas",
        "2026-02-22T17:00:00Z",
        "parcel",
      ],
    ];

    return { headers, sampleRows };
  }

  throw new Error(`Unknown table kind: ${tableKind}`);
}

async function getGraphToken() {
  const tenant = requiredEnv("GRAPH_TENANT_ID");
  const clientId = requiredEnv("GRAPH_CLIENT_ID");
  const clientSecret = requiredEnv("GRAPH_CLIENT_SECRET");

  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const resp = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = await resp.json();
  if (!resp.ok || !json.access_token) {
    throw new Error(`Failed to get Graph token: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

async function graphRequest(token, method, graphPath, body) {
  const url = `https://graph.microsoft.com/v1.0${graphPath}`;
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    throw new Error(`Graph request failed (${resp.status}) ${method} ${graphPath}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function ensureWorksheet(token, driveId, itemId, worksheetName) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedWs = encodeURIComponent(worksheetName);

  try {
    await graphRequest(token, "GET", `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/${encodedWs}`, null);
    return;
  } catch {
    await graphRequest(token, "POST", `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/add`, { name: worksheetName });
  }
}

async function listTables(token, driveId, itemId) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const resp = await graphRequest(token, "GET", `/drives/${encodedDrive}/items/${encodedItem}/workbook/tables?$top=200`, null);
  return Array.isArray(resp.value) ? resp.value : [];
}

async function resolveDriveItemFromShareUrl(token, shareUrl) {
  const raw = String(shareUrl || "").trim();
  if (!raw) {
    throw new Error("SHARE_URL is empty.");
  }

  const shareId = buildShareIdFromUrl(raw);
  const encoded = encodeURIComponent(shareId);
  const driveItem = await graphRequest(token, "GET", `/shares/${encoded}/driveItem`, null);

  const driveId = driveItem?.parentReference?.driveId || driveItem?.remoteItem?.parentReference?.driveId || "";
  const itemId = driveItem?.id || driveItem?.remoteItem?.id || "";

  if (!driveId || !itemId) {
    throw new Error(`Could not resolve driveId/itemId from SHARE_URL. Response: ${JSON.stringify(driveItem)}`);
  }

  return { driveId, itemId };
}

async function deleteTable(token, driveId, itemId, tableId) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedId = encodeURIComponent(tableId);
  await graphRequest(token, "DELETE", `/drives/${encodedDrive}/items/${encodedItem}/workbook/tables/${encodedId}`, null);
}

async function setRangeValues(token, driveId, itemId, worksheetName, address, values2d) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedWs = encodeURIComponent(worksheetName);
  const encodedAddress = encodeURIComponent(address);

  await graphRequest(
    token,
    "PATCH",
    `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/${encodedWs}/range(address='${encodedAddress}')`,
    { values: values2d },
  );
}

async function getWorksheetUsedRange(token, driveId, itemId, worksheetName) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedWs = encodeURIComponent(worksheetName);

  try {
    return await graphRequest(
      token,
      "GET",
      `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/${encodedWs}/usedRange(valuesOnly=true)`,
      null,
    );
  } catch {
    return null;
  }
}

function safeStartRowFromUsedRange(usedRange) {
  const rowCount = Number(usedRange?.rowCount || 0);
  if (!Number.isFinite(rowCount) || rowCount <= 0) return 1;
  return rowCount + 2;
}

async function addTable(token, driveId, itemId, worksheetName, address) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedWs = encodeURIComponent(worksheetName);

  return graphRequest(
    token,
    "POST",
    `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/${encodedWs}/tables/add`,
    { address, hasHeaders: true },
  );
}

async function renameTable(token, driveId, itemId, tableId, tableName) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedId = encodeURIComponent(tableId);
  await graphRequest(token, "PATCH", `/drives/${encodedDrive}/items/${encodedItem}/workbook/tables/${encodedId}`, {
    name: tableName,
  });
}

async function addTableRows(token, driveId, itemId, tableName, rows2d) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedTable = encodeURIComponent(tableName);
  await graphRequest(token, "POST", `/drives/${encodedDrive}/items/${encodedItem}/workbook/tables/${encodedTable}/rows/add`, {
    values: rows2d,
  });
}

async function provisionTable({ token, driveId, itemId, tableName, worksheetName, headers, sampleRows }) {
  const force = String(process.env.PROVISION_FORCE || "").trim().toLowerCase() === "true";
  const includeSampleData = !String(process.env.PROVISION_SAMPLE_DATA || "").trim()
    ? true
    : isTruthy(process.env.PROVISION_SAMPLE_DATA);

  if (!Array.isArray(headers) || headers.length === 0) {
    throw new Error("Missing headers for table provisioning.");
  }

  await ensureWorksheet(token, driveId, itemId, worksheetName);

  const tables = await listTables(token, driveId, itemId);
  const existing = tables.find((t) => String(t.name || "").toLowerCase() === String(tableName).toLowerCase());

  if (existing && !force) {
    console.log(`Table '${tableName}' already exists. Skipping (set PROVISION_FORCE=true to recreate).`);
    return;
  }

  if (existing && force) {
    console.log(`Deleting existing table '${tableName}'...`);
    await deleteTable(token, driveId, itemId, existing.id);
  }

  const effectiveRows = includeSampleData && Array.isArray(sampleRows) ? sampleRows : [];
  const totalRows = 1 + effectiveRows.length;
  const totalCols = headers.length;

  const usedRange = await getWorksheetUsedRange(token, driveId, itemId, worksheetName);
  const startRow = safeStartRowFromUsedRange(usedRange);
  const endCol = toColumnLetter(totalCols);
  const endRow = (startRow - 1) + totalRows;
  const address = `A${startRow}:${endCol}${endRow}`;

  console.log(`Writing sheet '${worksheetName}' range ${address} for table '${tableName}'...`);
  await setRangeValues(token, driveId, itemId, worksheetName, address, [headers, ...effectiveRows]);

  console.log(`Creating table '${tableName}'...`);
  const created = await addTable(token, driveId, itemId, worksheetName, address);
  const tableId = created && created.id ? created.id : null;
  if (tableId) {
    await renameTable(token, driveId, itemId, tableId, tableName);
  }

  // Best-effort: if Graph didn't attach rows when creating from range, add them directly.
  if ((!existing || force) && includeSampleData && effectiveRows.length > 0) {
    try {
      await addTableRows(token, driveId, itemId, tableName, effectiveRows);
    } catch {
      // Ignore; range already contained them.
    }
  }

  console.log(`Provisioned '${tableName}'.`);
}

async function main() {
  ensureFetchAvailable();

  const shareUrl = optionalEnvRaw("SHARE_URL");
  const configuredDrive = optionalEnvRaw("GRAPH_DRIVE_ID");
  const configuredItem = optionalEnvRaw("GRAPH_ITEM_ID");

  const missingAuth = getMissingEnvVars(REQUIRED_GRAPH_AUTH_ENV);
  if (missingAuth.length > 0) {
    const err = new Error("Missing required Graph auth configuration.");
    err.code = "MISSING_AUTH_ENV";
    err.missingAuth = missingAuth;
    throw err;
  }

  const shipmentsTable = optionalEnv("GRAPH_TABLE_SHIPMENTS", "Shipments");
  const eventsTable = optionalEnv("GRAPH_TABLE_SHIPMENTEVENTS", "ShipmentEvents");

  const shipmentsTemplate = getEmbeddedTemplate("shipments");
  const eventsTemplate = getEmbeddedTemplate("shipmentevents");

  console.log("Authenticating to Microsoft Graph...");
  const token = await getGraphToken();

  let driveId = configuredDrive;
  let itemId = configuredItem;
  if ((!driveId || !itemId) && shareUrl) {
    console.log("Resolving driveId/itemId from SHARE_URL...");
    const resolved = await resolveDriveItemFromShareUrl(token, shareUrl);
    driveId = resolved.driveId;
    itemId = resolved.itemId;
  }

  if (!driveId || !itemId) {
    const missingWorkbook = getMissingEnvVars(["GRAPH_DRIVE_ID", "GRAPH_ITEM_ID"]);
    const err = new Error("Missing workbook identifiers.");
    err.code = "MISSING_WORKBOOK";
    err.missingWorkbook = missingWorkbook;
    throw err;
  }

  await provisionTable({
    token,
    driveId,
    itemId,
    tableName: shipmentsTable,
    worksheetName: shipmentsTable,
    headers: shipmentsTemplate.headers,
    sampleRows: shipmentsTemplate.sampleRows,
  });

  await provisionTable({
    token,
    driveId,
    itemId,
    tableName: eventsTable,
    worksheetName: eventsTable,
    headers: eventsTemplate.headers,
    sampleRows: eventsTemplate.sampleRows,
  });

  console.log("Done.");
}

main().catch((err) => {
  if (err && (err.code === "MISSING_AUTH_ENV" || err.code === "MISSING_WORKBOOK")) {
    printProvisionHelp({ missingAuth: err.missingAuth, missingWorkbook: err.missingWorkbook });
    process.exit(1);
  }

  if (err && err.code === "FETCH_UNAVAILABLE") {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }

  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
