const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

function buildFlowUrl(baseEnvName) {
  const base = (process.env[baseEnvName] || "").trim();
  if (!base) {
    return "";
  }

  const apiVersion = (process.env.FLOW_API_VERSION || "1").trim();
  const sp = (process.env.FLOW_SP || "").trim();
  const sv = (process.env.FLOW_SV || "").trim();
  const sig = (process.env.FLOW_SIG || "").trim();

  const queryParts = [
    `api-version=${encodeURIComponent(apiVersion)}`,
    sp ? `sp=${sp}` : "",
    sv ? `sv=${encodeURIComponent(sv)}` : "",
    sig ? `sig=${encodeURIComponent(sig)}` : ""
  ].filter(Boolean);

  return queryParts.length > 0 ? `${base}?${queryParts.join("&")}` : base;
}

function resolveUpstreamUrl(action) {
  const direct = (process.env.COPILOT_UPSTREAM_URL || "").trim();
  if (direct) {
    return direct;
  }

  const lookupFlow = buildFlowUrl("FLOW_LOOKUP_BASE_URL");
  const updateFlow = buildFlowUrl("FLOW_UPDATE_BASE_URL");
  const sharedFlow = buildFlowUrl("FLOW_BASE_URL");

  if (action === "update" && updateFlow) {
    return updateFlow;
  }

  if (action === "lookup" && lookupFlow) {
    return lookupFlow;
  }

  return sharedFlow;
}

function normalizeTable(input) {
  if (input.includes("orderlines") || input.includes("order lines") || input.includes("line ")) {
    return "orderlines";
  }
  if (input.includes("customers") || input.includes("customer ")) {
    return "customers";
  }
  if (input.includes("products") || input.includes("product ") || input.includes("sku")) {
    return "products";
  }
  return "orders";
}

function normalizeAction(input) {
  if (
    (input.includes("email") || input.includes("e-mail") || input.includes("mail")) &&
    (input.includes("send") || input.includes("notify") || input.includes("inform") || input.includes("contact"))
  ) {
    return "notify";
  }

  if (input.includes("notify customer") || input.includes("send update to customer")) {
    return "notify";
  }

  if (input.includes("update") || input.includes("set ") || input.includes("change ")) {
    return "update";
  }
  return "lookup";
}

function parseNotifyInstruction(input, tokens) {
  const lowered = String(input || "").toLowerCase();
  const quotedMessage = String(input || "").match(/"([^"]+)"/);
  const invalidCustomerValues = new Set(["for", "to", "the", "a", "an", "of", "about", "customer", "order"]);
  const inlineEmailMatch = String(input || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  const messageMatch = String(input || "").match(/\bmessage\s*[:=]\s*(.+)$/i);
  const explicitMessage = quotedMessage?.[1] || messageMatch?.[1] || "";

  let template = "status_update";
  if (lowered.includes("delayed") || lowered.includes("delay")) template = "delay_notice";
  if (lowered.includes("shipped") || lowered.includes("shipping")) template = "shipping_update";
  if (lowered.includes("backorder")) template = "backorder_notice";
  if (lowered.includes("confirm") || lowered.includes("confirmed")) template = "confirmation_notice";

  const requestedCustomer = String(tokens.customerid || tokens.customer || "").trim();
  const requestedEmail = String(tokens.email || tokens.to || inlineEmailMatch?.[0] || "").trim();

  return {
    channel: "email",
    template,
    message: explicitMessage.trim(),
    customerId: invalidCustomerValues.has(requestedCustomer.toLowerCase()) ? "" : requestedCustomer,
    orderNumber: tokens.ordernumber || tokens.order || "",
    toEmail: requestedEmail,
  };
}

function parseKeyValueTokens(input) {
  const parsed = {};
  const tokenRegex = /([a-zA-Z][a-zA-Z0-9_]*)=([^,\s]+)/g;
  let match = tokenRegex.exec(input);
  while (match) {
    const key = String(match[1] || "").trim();
    const value = String(match[2] || "").trim();
    if (key && value) {
      parsed[key] = value;
    }
    match = tokenRegex.exec(input);
  }
  return parsed;
}

function toCanonicalKey(table, tokenMap) {
  const map = Object.fromEntries(Object.entries(tokenMap).map(([k, v]) => [k.toLowerCase(), v]));

  if (table === "orders") {
    const orderNumber = map.ordernumber || map.order;
    return orderNumber ? { OrderNumber: orderNumber } : {};
  }

  if (table === "orderlines") {
    const lineKey = map.linekey;
    const orderNumber = map.ordernumber || map.order;
    const lineNumber = map.linenumber || map.line;
    if (lineKey) return { LineKey: lineKey };
    if (orderNumber && lineNumber) return { LineKey: `${orderNumber}-${lineNumber}` };
    return {};
  }

  if (table === "customers") {
    const customerId = map.customerid || map.customer;
    return customerId ? { CustomerID: customerId } : {};
  }

  if (table === "products") {
    const sku = map.sku || map.product;
    return sku ? { SKU: sku } : {};
  }

  return {};
}

function toCanonicalUpdates(table, tokenMap, input) {
  const map = Object.fromEntries(Object.entries(tokenMap).map(([k, v]) => [k.toLowerCase(), v]));
  const updates = {};

  if (table === "orders") {
    if (map.status) updates.Status = map.status;
    if (map.customerrqddate) updates.CustomerReqDelDate = map.customerrqddate;
    if (map.customerrqddate) updates.CustomerReqDelDate = map.customerrqddate;
    if (map.customerreqdeldate) updates.CustomerReqDelDate = map.customerreqdeldate;
    if (map.estshipdate) updates.EstShipDate = map.estshipdate;
    if (map.deliveryblock) updates.DeliveryBlock = map.deliveryblock;
    if (map.billingblock) updates.BillingBlock = map.billingblock;
  }

  if (table === "orderlines") {
    if (map.openqty) updates.OpenQty = map.openqty;
    if (map.linestatus) updates.LineStatus = map.linestatus;
    if (map.orderqty) updates.OrderQty = map.orderqty;
  }

  if (table === "customers") {
    if (map.region) updates.Region = map.region;
    if (map.shiptocountry) updates.ShipToCountry = map.shiptocountry;
  }

  if (table === "products") {
    if (map.baseunitprice) updates.BaseUnitPrice = map.baseunitprice;
    if (map.productfamily) updates.ProductFamily = map.productfamily;
    if (map.description) updates.Description = map.description;
  }

  if (!updates.Status && table === "orders") {
    if (input.includes("status to shipped")) updates.Status = "Shipped";
    if (input.includes("status to backorder")) updates.Status = "Backorder";
    if (input.includes("status to blocked")) updates.Status = "Blocked";
  }

  return updates;
}

function parseAgentIntent(input) {
  const lowered = input.toLowerCase();
  const action = normalizeAction(lowered);
  const table = normalizeTable(lowered);
  const tokens = parseKeyValueTokens(input);

  if (table === "orders" && !tokens.ordernumber && !tokens.order) {
    const match = input.match(/\border\s*(?:number|no\.?|#)?\s*[:=]?\s*([A-Za-z0-9-]+)/i);
    if (match?.[1]) {
      tokens.ordernumber = match[1];
    }
  }

  if (table === "customers" && !tokens.customerid && !tokens.customer) {
    const invalidCustomerValues = new Set(["for", "to", "the", "a", "an", "of", "about", "customer", "order"]);
    const match = input.match(/\bcustomer\s*(?:id|#)?\s*[:=]?\s*([A-Za-z0-9-]+)/i);
    if (match?.[1] && !invalidCustomerValues.has(match[1].toLowerCase())) {
      tokens.customerid = match[1];
    }
  }

  if (table === "products" && !tokens.sku && !tokens.product) {
    const match = input.match(/\b(?:sku|product)\s*(?:id|#)?\s*[:=]?\s*([A-Za-z0-9-]+)/i);
    if (match?.[1]) {
      tokens.sku = match[1];
    }
  }

  if (table === "orderlines" && !tokens.linekey) {
    const orderMatch = input.match(/\border\s*(?:number|no\.?|#)?\s*[:=]?\s*([A-Za-z0-9-]+)/i);
    const lineMatch = input.match(/\bline\s*(?:number|no\.?|#)?\s*[:=]?\s*([A-Za-z0-9-]+)/i);
    if (orderMatch?.[1] && lineMatch?.[1]) {
      tokens.ordernumber = tokens.ordernumber || orderMatch[1];
      tokens.linenumber = tokens.linenumber || lineMatch[1];
    }
  }

  const invalidIdTokens = new Set(["for", "to", "the", "a", "an", "of", "about", "customer", "order"]);

  if (!tokens.ordernumber && !tokens.order) {
    const orderMatch = input.match(/\border\s*(?:number|no\.?|#)?\s*[:=]?\s*([A-Za-z0-9-]+)/i);
    if (orderMatch?.[1] && !invalidIdTokens.has(orderMatch[1].toLowerCase())) {
      tokens.ordernumber = orderMatch[1];
    }
  }

  if (!tokens.customerid && !tokens.customer) {
    const customerMatch = input.match(/\bcustomer\s*(?:id|#)?\s*[:=]?\s*([A-Za-z0-9-]+)/i);
    if (customerMatch?.[1] && !invalidIdTokens.has(customerMatch[1].toLowerCase())) {
      tokens.customerid = customerMatch[1];
    }
  }

  const key = toCanonicalKey(table, tokens);
  const updates = action === "update" ? toCanonicalUpdates(table, tokens, lowered) : {};
  const notify = action === "notify" ? parseNotifyInstruction(input, tokens) : undefined;

  return {
    action,
    table,
    key,
    updates,
    notify,
    query: input,
  };
}

const graphTokenCache = {
  token: "",
  expiresAt: 0,
};

const graphTableCache = new Map();

function getTableCacheTtlMs() {
  const seconds = Number(process.env.GRAPH_TABLE_CACHE_SECONDS || 30);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return seconds * 1000;
}

function getTableCacheKey(tableName) {
  const driveId = process.env.GRAPH_DRIVE_ID || "";
  const itemId = process.env.GRAPH_ITEM_ID || "";
  return `${driveId}|${itemId}|${tableName}`;
}

function tryGetCachedTable(tableName) {
  const ttlMs = getTableCacheTtlMs();
  if (ttlMs <= 0) return null;

  const cacheKey = getTableCacheKey(tableName);
  const cached = graphTableCache.get(cacheKey);
  if (!cached) return null;

  if (cached.expiresAt <= Date.now()) {
    graphTableCache.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function setCachedTable(tableName, value) {
  const ttlMs = getTableCacheTtlMs();
  if (ttlMs <= 0) return;

  const cacheKey = getTableCacheKey(tableName);
  graphTableCache.set(cacheKey, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

function clearTableCache() {
  graphTableCache.clear();
}

function getBackendMode() {
  return (process.env.BACKEND_MODE || "auto").toLowerCase();
}

function isGraphConfigured() {
  return Boolean(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET &&
    process.env.GRAPH_DRIVE_ID &&
    process.env.GRAPH_ITEM_ID
  );
}

function shouldUseGraph() {
  const mode = getBackendMode();
  if (mode === "graph") return true;
  if (mode === "flow") return false;
  return isGraphConfigured();
}

function getTableName(table) {
  const map = {
    orders: process.env.GRAPH_TABLE_ORDERS || "Orders",
    orderlines: process.env.GRAPH_TABLE_ORDERLINES || "OrderLines",
    customers: process.env.GRAPH_TABLE_CUSTOMERS || "Customers",
    products: process.env.GRAPH_TABLE_PRODUCTS || "Products",
  };
  return map[table] || map.orders;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function rowHasQuery(row, query) {
  if (!query) return true;
  const lowered = normalizeValue(query);
  return Object.values(row).some((value) => normalizeValue(value).includes(lowered));
}

function rowMatchesKey(row, key) {
  const pairs = Object.entries(key || {}).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "");
  if (pairs.length === 0) return false;
  return pairs.every(([k, v]) => normalizeValue(row[k]) === normalizeValue(v));
}

function toSummary(order) {
  if (!order) return "No matching order found.";
  return `Order ${order.OrderNumber || ""} | Status: ${order.Status || ""} | Customer: ${order.SoldToName || ""} | Net: ${order.Currency || ""} ${order.NetValue || ""}`.trim();
}

async function getGraphToken() {
  const now = Date.now();
  if (graphTokenCache.token && graphTokenCache.expiresAt > now + 60000) {
    return graphTokenCache.token;
  }

  const tenant = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Graph credentials are missing. Configure GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET.");
  }

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

  graphTokenCache.token = json.access_token;
  graphTokenCache.expiresAt = now + (Number(json.expires_in || 3600) * 1000);
  return graphTokenCache.token;
}

async function graphRequest(path, options = {}) {
  const token = await getGraphToken();
  const base = "https://graph.microsoft.com/v1.0";
  const url = `${base}${path}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Graph request failed (${response.status}): ${JSON.stringify(data)}`);
  }

  return data;
}

async function getTableData(table, cache) {
  if (cache[table]) return cache[table];

  const driveId = process.env.GRAPH_DRIVE_ID;
  const itemId = process.env.GRAPH_ITEM_ID;
  if (!driveId || !itemId) {
    throw new Error("Graph workbook identifiers are missing. Configure GRAPH_DRIVE_ID and GRAPH_ITEM_ID.");
  }

  const tableName = getTableName(table);
  const cached = tryGetCachedTable(tableName);
  if (cached) {
    cache[table] = cached;
    return cached;
  }

  const encodedTable = encodeURIComponent(tableName);
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/tables/${encodedTable}`;

  const columnsResp = await graphRequest(`${base}/columns?$top=300`);
  const rowsResp = await graphRequest(`${base}/rows?$top=2000`);

  const headers = (columnsResp.value || []).map((c) => c.name);
  const rows = (rowsResp.value || []).map((row) => {
    const values = Array.isArray(row.values) && Array.isArray(row.values[0]) ? row.values[0] : [];
    const obj = { __index: row.index, __values: values };
    headers.forEach((h, i) => {
      obj[h] = values[i];
    });
    return obj;
  });

  const result = { headers, rows, tableName };
  cache[table] = result;
  setCachedTable(tableName, result);
  return result;
}

function detectOrderNumberFromText(input) {
  const match = String(input || "").match(/\b\d{8,12}\b/);
  return match ? match[0] : "";
}

async function lookupGraph(intent) {
  const cache = {};
  const table = intent.table || "orders";
  const dataset = await getTableData(table, cache);

  let matches = [];
  if (intent.key && Object.keys(intent.key).length > 0) {
    matches = dataset.rows.filter((row) => rowMatchesKey(row, intent.key));
  }

  if (matches.length === 0 && table === "orders") {
    const detectedOrder = detectOrderNumberFromText(intent.query);
    if (detectedOrder) {
      matches = dataset.rows.filter((row) => normalizeValue(row.OrderNumber) === normalizeValue(detectedOrder));
    }
  }

  if (matches.length === 0) {
    matches = dataset.rows.filter((row) => rowHasQuery(row, intent.query));
  }

  if (table !== "orders") {
    return {
      success: true,
      action: "lookup",
      table,
      result: matches.length > 0 ? `Found ${matches.length} ${table} record(s).` : `No ${table} records found.`,
      data: matches.slice(0, 50).map((r) => {
        const copy = { ...r };
        delete copy.__index;
        delete copy.__values;
        return copy;
      }),
    };
  }

  const order = matches[0];
  if (!order) {
    return { success: true, action: "lookup", table: "orders", result: "No matching order found.", data: [] };
  }

  const linesData = await getTableData("orderlines", cache);
  const customerData = await getTableData("customers", cache);
  const productData = await getTableData("products", cache);

  const lines = linesData.rows.filter((line) => normalizeValue(line.OrderNumber) === normalizeValue(order.OrderNumber));
  const customer = customerData.rows.find((c) =>
    normalizeValue(c.CustomerID) === normalizeValue(order.SoldTo) ||
    normalizeValue(c.ShipToID) === normalizeValue(order.ShipTo)
  ) || null;

  const skuSet = new Set(lines.map((l) => normalizeValue(l.SKU)).filter(Boolean));
  const products = productData.rows.filter((p) => skuSet.has(normalizeValue(p.SKU)));

  const stripMeta = (row) => {
    if (!row) return row;
    const copy = { ...row };
    delete copy.__index;
    delete copy.__values;
    return copy;
  };

  return {
    success: true,
    action: "lookup",
    table: "orders",
    result: toSummary(order),
    order: stripMeta(order),
    customer: stripMeta(customer),
    lines: lines.map(stripMeta),
    products: products.map(stripMeta),
  };
}

async function updateGraph(intent) {
  const cache = {};
  const table = intent.table || "orders";
  const dataset = await getTableData(table, cache);
  const allowedUpdates = {
    orders: ["Status", "CustomerReqDelDate", "EstShipDate", "DeliveryBlock", "BillingBlock", "UpdatedBy", "LastUpdated"],
    orderlines: ["OpenQty", "LineStatus", "OrderQty", "LastUpdated"],
    customers: ["Region", "ShipToCountry"],
    products: ["BaseUnitPrice", "ProductFamily", "Description"],
  };

  const keyObj = intent.key || {};
  if (Object.keys(keyObj).length === 0) {
    return { success: false, action: "update", table, result: "Missing key for update. Example: ordernumber=6600000680" };
  }

  const updates = intent.updates || {};
  const whitelist = allowedUpdates[table] || [];
  const allowedEntries = Object.entries(updates).filter(([field, value]) => whitelist.includes(field) && value !== undefined && value !== null && String(value).trim() !== "");
  if (allowedEntries.length === 0) {
    return { success: false, action: "update", table, result: `No valid update fields provided for ${table}.` };
  }

  const matched = dataset.rows.filter((row) => rowMatchesKey(row, keyObj));
  if (matched.length !== 1) {
    return { success: false, action: "update", table, result: `Expected exactly 1 row to update, found ${matched.length}.`, key: keyObj };
  }

  const target = matched[0];
  const updatedValues = [...target.__values];
  const updatedFields = [];
  allowedEntries.forEach(([field, value]) => {
    const idx = dataset.headers.indexOf(field);
    if (idx >= 0) {
      updatedValues[idx] = value;
      updatedFields.push(field);
    }
  });

  if (table === "orders") {
    const updatedByIdx = dataset.headers.indexOf("UpdatedBy");
    if (updatedByIdx >= 0) updatedValues[updatedByIdx] = "Agent";
    const lastUpdatedIdx = dataset.headers.indexOf("LastUpdated");
    if (lastUpdatedIdx >= 0) updatedValues[lastUpdatedIdx] = new Date().toISOString();
  }

  const driveId = process.env.GRAPH_DRIVE_ID;
  const itemId = process.env.GRAPH_ITEM_ID;
  const tableName = getTableName(table);
  const encodedTable = encodeURIComponent(tableName);
  const base = `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/workbook/tables/${encodedTable}`;
  await graphRequest(`${base}/rows/itemAt(index=${target.__index})`, {
    method: "PATCH",
    body: { values: [updatedValues] },
  });

  clearTableCache();

  const updatedRow = { ...target };
  dataset.headers.forEach((header, idx) => {
    updatedRow[header] = updatedValues[idx];
  });
  delete updatedRow.__index;
  delete updatedRow.__values;

  return {
    success: true,
    action: "update",
    table,
    result: `Updated ${table} successfully (${updatedFields.join(", ")}).`,
    updatedFields,
    record: updatedRow,
  };
}

function getCustomerEmail(customerRow) {
  if (!customerRow || typeof customerRow !== "object") return "";
  const candidates = [
    "Email",
    "EmailAddress",
    "EmailAddress1",
    "ContactEmail",
    "CustomerEmail",
    "PrimaryEmail",
    "ShipToEmail",
  ];

  for (const column of candidates) {
    const value = customerRow[column];
    if (value && String(value).includes("@")) {
      return String(value).trim();
    }
  }

  const dynamicEmailColumn = Object.entries(customerRow).find(([key, value]) =>
    /email/i.test(String(key)) && value && String(value).includes("@")
  );
  if (dynamicEmailColumn?.[1]) {
    return String(dynamicEmailColumn[1]).trim();
  }

  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCustomerEmailMessage(notifyContext) {
  const order = notifyContext.order || {};
  const customer = notifyContext.customer || {};
  const notify = notifyContext.notify || {};
  const lines = Array.isArray(notifyContext.lines) ? notifyContext.lines : [];

  const customerName = customer.CustomerName || order.SoldToName || "Customer";
  const orderNumber = order.OrderNumber || notify.orderNumber || "your order";
  const status = order.Status || "updated";
  const requestedDate = order.CustomerReqDelDate || "TBD";
  const estimatedShipDate = order.EstShipDate || "TBD";
  const currency = order.Currency || "USD";
  const netValue = order.NetValue ?? "";

  const itemsList = lines
    .slice(0, 8)
    .map((line) => {
      const parts = [
        line.SKUDescription || "",
        line.SKU ? `(${line.SKU})` : "",
        line.OrderQty ? `Qty ${line.OrderQty}` : "",
      ].filter(Boolean);
      const label = parts.join(" ").trim();
      return label ? `<li style="margin:0 0 6px 0;">${escapeHtml(label)}</li>` : "";
    })
    .filter(Boolean)
    .join("");

  const defaultIntro = notify.message
    ? escapeHtml(notify.message)
    : `We are sharing an update for order ${escapeHtml(orderNumber)}.`;

  const highlightText = status
    ? `Current status: <strong>${escapeHtml(status)}</strong>`
    : "Your order has been updated.";

  const supportEmail = String(process.env.SUPPORT_EMAIL || "").trim();
  const supportPhone = String(process.env.SUPPORT_PHONE || "").trim();

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5;">
      <h2 style="margin:0 0 14px 0;font-size:20px;font-weight:700;color:#111827;">Order Update</h2>

      <table role="presentation" style="border-collapse:collapse;width:100%;max-width:920px;border:1px solid #d1d5db;">
        <tr>
          <th style="text-align:left;background:#f3f4f6;border-right:1px solid #d1d5db;padding:10px 12px;font-size:12px;letter-spacing:.06em;color:#374151;">ORDER INFORMATION</th>
          <th style="text-align:left;background:#f3f4f6;padding:10px 12px;font-size:12px;letter-spacing:.06em;color:#374151;">DETAILS</th>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">ORDER NUMBER</td>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;">${escapeHtml(orderNumber)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">CUSTOMER</td>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;">${escapeHtml(customerName)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">STATUS</td>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;">${escapeHtml(status)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">REQUESTED DELIVERY</td>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;">${escapeHtml(requestedDate)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">ESTIMATED SHIP</td>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;">${escapeHtml(estimatedShipDate)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">ORDER VALUE</td>
          <td style="padding:10px 12px;border-top:1px solid #e5e7eb;font-size:12px;">${escapeHtml(currency)} ${escapeHtml(netValue)}</td>
        </tr>
      </table>

      <p style="margin:14px 0 10px 0;font-size:13px;">Hello ${escapeHtml(customerName)},</p>
      <p style="margin:0 0 14px 0;font-size:13px;">${defaultIntro}</p>

      <div style="margin:0 0 16px 0;padding:12px 14px;border-left:4px solid #16a34a;background:#ecfdf5;color:#065f46;font-size:13px;">
        ${highlightText}
      </div>

      ${itemsList ? `
        <h3 style="margin:0 0 8px 0;font-size:14px;color:#111827;">Items</h3>
        <ul style="margin:0 0 16px 18px;padding:0;font-size:13px;">${itemsList}</ul>
      ` : ""}

      <h3 style="margin:0 0 8px 0;font-size:14px;color:#111827;">Next Steps</h3>
      <ul style="margin:0 0 16px 18px;padding:0;font-size:13px;">
        <li style="margin:0 0 6px 0;">We will continue processing your order and share updates as they occur.</li>
        <li style="margin:0 0 6px 0;">If the estimated ship date changes, we will notify you.</li>
        <li style="margin:0 0 6px 0;">You can reply to this email with any questions.</li>
      </ul>

      <h3 style="margin:0 0 8px 0;font-size:14px;color:#111827;">Questions?</h3>
      <p style="margin:0 0 6px 0;font-size:13px;">If you have questions about your order or need to make changes, please reach out:</p>
      <ul style="margin:0 0 18px 18px;padding:0;font-size:13px;">
        ${supportEmail ? `<li style=\"margin:0 0 6px 0;\"><strong>Email:</strong> ${escapeHtml(supportEmail)}</li>` : ""}
        ${supportPhone ? `<li style=\"margin:0 0 6px 0;\"><strong>Phone:</strong> ${escapeHtml(supportPhone)}</li>` : ""}
        <li style="margin:0 0 6px 0;"><strong>Reference:</strong> ${escapeHtml(orderNumber)}</li>
      </ul>

      <p style="margin:0;font-size:13px;">Thank you,<br/>Customer Service Team</p>
    </div>`;

  if (notify.template === "shipping_update") {
    return {
      subject: `Shipping update for order ${orderNumber}`,
      body: htmlBody,
    };
  }

  if (notify.template === "delay_notice") {
    return {
      subject: `Delivery delay update for order ${orderNumber}`,
      body: htmlBody,
    };
  }

  if (notify.template === "backorder_notice") {
    return {
      subject: `Backorder notice for order ${orderNumber}`,
      body: htmlBody,
    };
  }

  if (notify.template === "confirmation_notice") {
    return {
      subject: `Order ${orderNumber} confirmed`,
      body: htmlBody,
    };
  }

  return {
    subject: `Order update for ${orderNumber}`,
    body: htmlBody,
  };
}

async function sendGraphMail(toAddress, subject, bodyText) {
  const senderUpn = (process.env.GRAPH_MAIL_SENDER_UPN || "").trim();
  if (!senderUpn) {
    throw new Error("GRAPH_MAIL_SENDER_UPN is not configured.");
  }

  await graphRequest(`/users/${encodeURIComponent(senderUpn)}/sendMail`, {
    method: "POST",
    body: {
      message: {
        subject,
        body: {
          contentType: "HTML",
          content: bodyText,
        },
        toRecipients: [
          {
            emailAddress: {
              address: toAddress,
            },
          },
        ],
      },
      saveToSentItems: true,
    },
  });
}

function getEmailProvider() {
  return String(process.env.EMAIL_PROVIDER || "graph").trim().toLowerCase();
}

function parseCsvValues(value) {
  return String(value || "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function getRecipientDomain(emailAddress) {
  const address = String(emailAddress || "").trim().toLowerCase();
  const atIndex = address.lastIndexOf("@");
  if (atIndex < 0 || atIndex === address.length - 1) return "";
  return address.slice(atIndex + 1);
}

function getConsumerDomains() {
  const configured = parseCsvValues(process.env.EMAIL_CONSUMER_DOMAINS);
  if (configured.length > 0) {
    return configured;
  }

  return [
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "gmail.com",
    "yahoo.com",
    "icloud.com",
    "aol.com",
  ];
}

function isConsumerDomain(domain) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedDomain) return false;

  const consumerDomains = getConsumerDomains();
  return consumerDomains.some((consumerDomain) =>
    normalizedDomain === consumerDomain || normalizedDomain.endsWith(`.${consumerDomain}`)
  );
}

function isSendGridConfigured() {
  const apiKey = String(process.env.SENDGRID_API_KEY || "").trim();
  const fromEmail = String(process.env.SENDGRID_FROM_EMAIL || "").trim();
  return Boolean(apiKey && fromEmail && apiKey !== "<key>" && fromEmail !== "<verified sender>");
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "sendgrid") return "sendgrid";
  return "graph";
}

function resolvePrimaryEmailProvider(toAddress) {
  const configured = getEmailProvider();
  if (configured === "graph" || configured === "sendgrid") {
    return configured;
  }

  const recipientDomain = getRecipientDomain(toAddress);
  if (isConsumerDomain(recipientDomain) && isSendGridConfigured()) {
    return "sendgrid";
  }

  return "graph";
}

function resolveFallbackProvider(primaryProvider) {
  const rawFallback = String(process.env.EMAIL_PROVIDER_FALLBACK || "").trim().toLowerCase();
  if (!rawFallback || rawFallback === "none") {
    return "";
  }

  if (rawFallback === "auto") {
    return primaryProvider === "graph" ? "sendgrid" : "graph";
  }

  const explicit = normalizeProvider(rawFallback);
  if (explicit === primaryProvider) {
    return "";
  }

  return explicit;
}

async function sendWithProvider(provider, toAddress, subject, bodyHtml) {
  if (provider === "sendgrid") {
    await sendSendGridMail(toAddress, subject, bodyHtml);
    return;
  }

  await sendGraphMail(toAddress, subject, bodyHtml);
}

async function sendSendGridMail(toAddress, subject, bodyHtml) {
  const apiKey = String(process.env.SENDGRID_API_KEY || "").trim();
  const fromEmail = String(process.env.SENDGRID_FROM_EMAIL || "").trim();
  const fromName = String(process.env.SENDGRID_FROM_NAME || "Order Operations Team").trim();

  if (!apiKey || !fromEmail) {
    throw new Error("SendGrid is configured but missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL.");
  }

  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: {
        email: fromEmail,
        name: fromName,
      },
      personalizations: [
        {
          to: [{ email: toAddress }],
          subject,
        },
      ],
      content: [
        {
          type: "text/html",
          value: bodyHtml,
        },
      ],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`SendGrid send failed (${response.status}): ${detail}`);
  }
}

async function sendCustomerMail(toAddress, subject, bodyHtml) {
  const primaryProvider = resolvePrimaryEmailProvider(toAddress);
  const fallbackProvider = resolveFallbackProvider(primaryProvider);

  try {
    await sendWithProvider(primaryProvider, toAddress, subject, bodyHtml);
    return { provider: primaryProvider, fallbackUsed: false };
  } catch (primaryError) {
    if (!fallbackProvider) {
      throw primaryError;
    }

    if (fallbackProvider === "sendgrid" && !isSendGridConfigured()) {
      throw primaryError;
    }

    try {
      await sendWithProvider(fallbackProvider, toAddress, subject, bodyHtml);
      return { provider: fallbackProvider, fallbackUsed: true, primaryProvider };
    } catch (fallbackError) {
      const firstMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const secondMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
      throw new Error(`Primary provider (${primaryProvider}) failed: ${firstMessage}. Fallback provider (${fallbackProvider}) failed: ${secondMessage}`);
    }
  }
}

async function notifyCustomerGraph(intent) {
  const notify = intent.notify || {};
  const cache = {};
  const ordersData = await getTableData("orders", cache);
  const customersData = await getTableData("customers", cache);
  const linesData = await getTableData("orderlines", cache);

  let order = null;
  let customer = null;

  const requestedOrder = notify.orderNumber || intent.key?.OrderNumber || "";
  if (requestedOrder) {
    order = ordersData.rows.find((row) => normalizeValue(row.OrderNumber) === normalizeValue(requestedOrder)) || null;
  }

  const requestedCustomer = notify.customerId || "";
  if (requestedCustomer) {
    customer = customersData.rows.find((row) => normalizeValue(row.CustomerID) === normalizeValue(requestedCustomer)) || null;
  }

  if (!customer && order) {
    customer = customersData.rows.find((row) =>
      normalizeValue(row.CustomerID) === normalizeValue(order.SoldTo) ||
      normalizeValue(row.ShipToID) === normalizeValue(order.ShipTo)
    ) || null;
  }

  const lines = order
    ? linesData.rows.filter((line) => normalizeValue(line.OrderNumber) === normalizeValue(order.OrderNumber))
    : [];

  if (!order && !customer) {
    return {
      success: false,
      action: "notify",
      table: "customers",
      result: "I could not identify the customer or order to notify. Include an order number or customer ID.",
    };
  }

  const requestedRecipient = String(notify.toEmail || "").trim();
  const recipient = requestedRecipient || getCustomerEmail(customer);
  if (!recipient) {
    const availableColumns = customer && typeof customer === "object"
      ? Object.keys(customer).filter((name) => !name.startsWith("__"))
      : [];
    return {
      success: false,
      action: "notify",
      table: "customers",
      result: "No customer email address is available for this record. Add an Email column/value in the Customers table, or provide email=<address> in the prompt.",
      availableCustomerColumns: availableColumns,
      customer: customer ? { ...customer, __index: undefined, __values: undefined } : null,
      order: order ? { ...order, __index: undefined, __values: undefined } : null,
    };
  }

  const message = buildCustomerEmailMessage({ notify, order, customer, lines });
  const sendResult = await sendCustomerMail(recipient, message.subject, message.body);

  const clean = (row) => {
    if (!row) return null;
    const copy = { ...row };
    delete copy.__index;
    delete copy.__values;
    return copy;
  };

  return {
    success: true,
    action: "notify",
    channel: "email",
    table: "customers",
    result: `Email sent to ${recipient}.`,
    recipient,
    provider: sendResult.provider,
    fallbackUsed: Boolean(sendResult.fallbackUsed),
    primaryProvider: sendResult.primaryProvider || sendResult.provider,
    subject: message.subject,
    order: clean(order),
    customer: clean(customer),
  };
}

async function handleGraphIntent(intent) {
  if (intent.action === "notify") {
    return notifyCustomerGraph(intent);
  }

  if (intent.action === "update") {
    return updateGraph(intent);
  }
  return lookupGraph(intent);
}

function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || "https://apps.powerapps.com";
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}

function resolveAllowedOrigin(origin) {
  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.includes("*")) {
    return origin || "*";
  }

  if (!origin) {
    return null;
  }

  return allowedOrigins.includes(origin) ? origin : null;
}

function applyCors(req, res) {
  const origin = req.header("origin");
  const allowed = resolveAllowedOrigin(origin);
  if (!allowed) {
    res.status(403).json({ result: "Origin not allowed." });
    return false;
  }

  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-proxy-key");
  res.setHeader("Vary", origin ? "Origin" : "*");
  return true;
}

app.options("/api/chat-proxy", (req, res) => {
  if (!applyCors(req, res)) return;
  res.status(204).send();
});

app.post("/api/chat-proxy", async (req, res) => {
  if (!applyCors(req, res)) return;

  const requireSharedSecret = (process.env.REQUIRE_SHARED_SECRET || "false").toLowerCase() === "true";
  if (requireSharedSecret) {
    const expected = process.env.PROXY_SHARED_SECRET || "";
    const supplied = req.header("x-proxy-key") || "";
    if (!expected || supplied !== expected) {
      res.status(401).json({ result: "Unauthorized." });
      return;
    }
  }

  const input = typeof req.body?.input === "string" ? req.body.input.trim() : "";
  if (!input) {
    res.status(400).json({ result: "Input is required." });
    return;
  }

  const intent = parseAgentIntent(input);
  if (shouldUseGraph()) {
    try {
      const graphResult = await handleGraphIntent(intent);
      res.status(200).json({ ...graphResult, intent });
      return;
    } catch (graphError) {
      const message = graphError instanceof Error ? graphError.message : String(graphError);
      if (getBackendMode() === "graph") {
        res.status(502).json({ result: `Graph backend failed: ${message}`, intent });
        return;
      }
    }
  }

  const upstreamUrl = resolveUpstreamUrl(intent.action);
  if (!upstreamUrl) {
    res.status(200).json({
      result: `Azure proxy is live. Received: ${input}. Configure Graph (preferred) or flow URL for data operations.`,
      intent,
    });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const headers = { "Content-Type": "application/json" };
    if (process.env.COPILOT_UPSTREAM_API_KEY) {
      headers["x-api-key"] = process.env.COPILOT_UPSTREAM_API_KEY;
    }

    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        input,
        action: intent.action,
        table: intent.table,
        key: intent.key,
        updates: intent.updates,
        query: intent.query,
      }),
      signal: controller.signal
    });

    const raw = await response.text();
    if (!response.ok) {
      const detail = raw && raw.trim() ? ` ${raw.trim()}` : "";
      res.status(502).json({ result: `Upstream service error (${response.status}).${detail}` });
      return;
    }

    let resultText = "";
    if (raw && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          const result =
            (typeof parsed.result === "string" && parsed.result) ||
            (typeof parsed.response === "string" && parsed.response) ||
            (typeof parsed.output === "string" && parsed.output) ||
            "No response.";

          const updateSucceeded =
            intent.action !== "update" ||
            parsed.success === true ||
            /\bupdated\b/i.test(result);

          if (!updateSucceeded) {
            res.status(200).json({
              ...parsed,
              result: `Update intent detected (${intent.table}), but upstream flow returned lookup output. Configure flow to handle action=update before updates can be applied. Current upstream result: ${result}`,
              intent,
            });
            return;
          }

          res.status(200).json({
            ...parsed,
            result,
            intent,
          });
          return;
        }

        resultText = raw;
      } catch {
        resultText = raw;
      }
    }

    const fallbackResult = resultText || "No response.";
    if (intent.action === "update" && !/\bupdated\b/i.test(fallbackResult)) {
      res.status(200).json({
        result: `Update intent detected (${intent.table}), but upstream flow returned lookup output. Configure flow to handle action=update before updates can be applied. Current upstream result: ${fallbackResult}`,
        intent,
      });
      return;
    }

    res.status(200).json({ result: fallbackResult, intent });
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    res.status(502).json({ result: isAbort ? "Upstream timeout." : "Proxy request failed." });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Proxy listening on ${port}`);
});
