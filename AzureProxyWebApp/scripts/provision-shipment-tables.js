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

const fs = require("fs");
const path = require("path");

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optionalEnv(name, defaultValue) {
  const value = String(process.env[name] || "").trim();
  return value || defaultValue;
}

function isTruthy(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "y";
}

function optionalEnvRaw(name) {
  const value = String(process.env[name] || "").trim();
  return value;
}

function toBase64Url(input) {
  return Buffer.from(String(input || ""), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildShareIdFromUrl(shareUrl) {
  // Graph format: u!{base64url(shareUrl)}
  return `u!${toBase64Url(shareUrl)}`;
}

function toColumnLetter(index1Based) {
  // 1 -> A, 26 -> Z, 27 -> AA
  let n = index1Based;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function parseTsv(tsvText) {
  const lines = String(tsvText || "")
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "");

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split("\t").map((h) => h.trim());
  const rows = lines
    .slice(1)
    .map((line) => line.split("\t"))
    .map((cells) => {
      const normalized = headers.map((_, idx) => (cells[idx] === undefined ? "" : String(cells[idx]).trim()));
      return normalized;
    });

  return { headers, rows };
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
  } catch (e) {
    // create
    await graphRequest(token, "POST", `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/add`, {
      name: worksheetName,
    });
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
    { values: values2d }
  );
}

async function getWorksheetUsedRange(token, driveId, itemId, worksheetName) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedWs = encodeURIComponent(worksheetName);

  try {
    // valuesOnly avoids returning full formulas/styles; we just need dimensions.
    return await graphRequest(
      token,
      "GET",
      `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/${encodedWs}/usedRange(valuesOnly=true)`,
      null
    );
  } catch {
    return null;
  }
}

function safeStartRowFromUsedRange(usedRange) {
  // Graph returns rowCount/columnCount; start 2 rows below to avoid overlap.
  const rowCount = Number(usedRange?.rowCount || 0);
  if (!Number.isFinite(rowCount) || rowCount <= 0) return 1;
  return rowCount + 2;
}

async function addTable(token, driveId, itemId, worksheetName, address) {
  const encodedDrive = encodeURIComponent(driveId);
  const encodedItem = encodeURIComponent(itemId);
  const encodedWs = encodeURIComponent(worksheetName);

  // address is relative to worksheet (e.g., A1:J10)
  return graphRequest(
    token,
    "POST",
    `/drives/${encodedDrive}/items/${encodedItem}/workbook/worksheets/${encodedWs}/tables/add`,
    { address, hasHeaders: true }
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

async function provisionTable({ token, driveId, itemId, tableName, worksheetName, tsvPath }) {
  const force = String(process.env.PROVISION_FORCE || "").trim().toLowerCase() === "true";
  const includeSampleData = !String(process.env.PROVISION_SAMPLE_DATA || "").trim()
    ? true
    : isTruthy(process.env.PROVISION_SAMPLE_DATA);

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

  const tsvText = fs.readFileSync(tsvPath, "utf8");
  const { headers, rows } = parseTsv(tsvText);

  if (headers.length === 0) {
    throw new Error(`No headers found in TSV: ${tsvPath}`);
  }

  const effectiveRows = includeSampleData ? rows : [];
  const totalRows = 1 + effectiveRows.length;
  const totalCols = headers.length;

  const usedRange = await getWorksheetUsedRange(token, driveId, itemId, worksheetName);
  const startRow = safeStartRowFromUsedRange(usedRange);
  const endCol = toColumnLetter(totalCols);
  const endRow = (startRow - 1) + totalRows;
  const address = `A${startRow}:${endCol}${endRow}`;

  console.log(`Writing sheet '${worksheetName}' range ${address} for table '${tableName}'...`);
  const values = [headers, ...effectiveRows];
  await setRangeValues(token, driveId, itemId, worksheetName, address, values);

  console.log(`Creating table '${tableName}'...`);
  const created = await addTable(token, driveId, itemId, worksheetName, address);
  const tableId = created && created.id ? created.id : null;

  if (tableId) {
    await renameTable(token, driveId, itemId, tableId, tableName);
  }

  // Graph sometimes keeps the data but doesn't attach rows when table is created from range.
  // Ensure rows are present by adding them if table is empty.
  // We only do this when force-recreating (to avoid duplicates), or when it was missing.
  if (!existing || force) {
    if (includeSampleData && effectiveRows.length > 0) {
      try {
        await addTableRows(token, driveId, itemId, tableName, effectiveRows);
      } catch {
        // best-effort; range already contains them
      }
    }
  }

  console.log(`Provisioned '${tableName}'.`);
}

async function main() {
  const shareUrl = optionalEnvRaw("SHARE_URL");
  const configuredDrive = optionalEnvRaw("GRAPH_DRIVE_ID");
  const configuredItem = optionalEnvRaw("GRAPH_ITEM_ID");

  const shipmentsTable = optionalEnv("GRAPH_TABLE_SHIPMENTS", "Shipments");
  const eventsTable = optionalEnv("GRAPH_TABLE_SHIPMENTEVENTS", "ShipmentEvents");

  const repoRoot = path.resolve(__dirname, "..", "..");
  const shipmentsTsv = path.join(repoRoot, "excel-templates", "Shipments.tsv");
  const eventsTsv = path.join(repoRoot, "excel-templates", "ShipmentEvents.tsv");

  if (!fs.existsSync(shipmentsTsv) || !fs.existsSync(eventsTsv)) {
    throw new Error("Missing TSV templates under excel-templates/. Ensure Shipments.tsv and ShipmentEvents.tsv exist.");
  }

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
    throw new Error("Missing workbook identifiers. Set GRAPH_DRIVE_ID and GRAPH_ITEM_ID, or provide SHARE_URL.");
  }

  await provisionTable({
    token,
    driveId,
    itemId,
    tableName: shipmentsTable,
    worksheetName: shipmentsTable,
    tsvPath: shipmentsTsv,
  });

  await provisionTable({
    token,
    driveId,
    itemId,
    tableName: eventsTable,
    worksheetName: eventsTable,
    tsvPath: eventsTsv,
  });

  console.log("Done.");
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exit(1);
});
