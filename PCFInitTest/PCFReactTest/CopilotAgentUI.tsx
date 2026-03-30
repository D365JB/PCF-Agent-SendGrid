import * as React from "react";

const baseContainerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minHeight: 350,
  background: "linear-gradient(135deg, #003366 60%, #0055a5 100%)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  overflowY: "auto",
  overflowX: "hidden",
  boxSizing: "border-box",
  padding: "24px 0",
};

const overlayStyle: React.CSSProperties = {
  position: "relative",
  width: "80%",
  maxWidth: 900,
  background: "rgba(0, 51, 102, 0.8)",
  color: "#fff",
  padding: "2rem",
  borderRadius: "12px",
  boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
  zIndex: 2,
  boxSizing: "border-box",
};

const titleStyle: React.CSSProperties = {
  fontSize: "2rem",
  fontWeight: 700,
  marginBottom: "1rem",
};

const subtitleStyle: React.CSSProperties = {
  fontSize: "1.1rem",
  fontWeight: 400,
  opacity: 0.95,
};

interface CopilotAgentUIState {
  userInput: string;
  messages: ChatMessage[];
  loading: boolean;
  error?: string;
  toast?: {
    type: "success" | "error" | "info";
    text: string;
  };
}

type DataRow = Record<string, unknown>;

interface AgentPayload {
  result?: string;
  action?: string;
  table?: string;
  order?: DataRow | null;
  customer?: DataRow | null;
  lines?: DataRow[];
  products?: DataRow[];
  data?: DataRow[];
  allocations?: DataRow[];
  inventory?: DataRow[];
  locations?: DataRow[];
  inventorySummary?: Record<string, unknown> | null;
  changedFields?: string[];
  shipmentPipeline?: {
    shipments?: DataRow[];
    events?: DataRow[];
    prediction?: Record<string, unknown>;
    steps?: Array<{ label: string; status: string; detail?: string }>;
    lastMilestone?: Record<string, unknown> | null;
  } | null;
}

interface ChatMessage {
  from: "user" | "agent";
  text: string;
  payload?: AgentPayload;
}

interface CopilotAgentUIProps {
  containerHeight?: number;
  containerWidth?: number;
  agentEndpoint?: string;
}

export class CopilotAgentUI extends React.Component<CopilotAgentUIProps, CopilotAgentUIState> {
  private orderSnapshots: Record<string, DataRow> = {};
  private emailedOrders: Record<string, string> = {};
  private toastTimer?: number;

  state: CopilotAgentUIState = {
    userInput: "",
    messages: [],
    loading: false,
    error: undefined,
    toast: undefined,
  };

  componentWillUnmount(): void {
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
    }
  }

  private normalizeEndpoint(rawEndpoint: string): string {
    const endpoint = rawEndpoint.trim();
    if (!endpoint) return "";
    if (endpoint.startsWith("http://") || endpoint.startsWith("https://") || endpoint.startsWith("/")) {
      return endpoint;
    }
    return `https://${endpoint}`;
  }

  private decodeHtml(input: string): string {
    return input
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  private extractEmbedUrl(rawValue: string): string {
    const raw = rawValue.trim();
    if (!raw) return "";

    const iframeSrcMatch = raw.match(/<iframe[^>]*src=["']([^"']+)["']/i);
    if (iframeSrcMatch?.[1]) {
      return this.decodeHtml(iframeSrcMatch[1]);
    }

    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      return this.decodeHtml(raw);
    }

    return "";
  }

  private isEmbedUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return lower.includes("powerva.microsoft.com") || lower.includes("copilotstudio") || lower.includes("webchat");
  }

  private normalizeProxyEndpoint(rawValue: string): string {
    const normalized = this.normalizeEndpoint(rawValue);
    if (!normalized) return "";

    if (normalized.startsWith("/")) {
      if (normalized === "/") return "/api/chat-proxy";
      return normalized.endsWith("/") ? `${normalized}api/chat-proxy` : normalized;
    }

    try {
      const url = new URL(normalized);
      if (!url.pathname || url.pathname === "/") {
        url.pathname = "/api/chat-proxy";
      }
      return url.toString();
    } catch {
      return normalized;
    }
  }

  private resolveConfiguredUrl(): string {
    const configuredEndpoint = (this.props.agentEndpoint || "").trim();
    const savedEndpoint = typeof window !== "undefined" ? (window.localStorage.getItem("pcfCopilotProxyEndpoint") || "").trim() : "";
    const rawValue = configuredEndpoint || savedEndpoint;
    const embedUrl = this.extractEmbedUrl(rawValue);
    if (embedUrl) return embedUrl;
    return this.normalizeProxyEndpoint(rawValue);
  }

  private toEndpointInfo(endpoint: string): string {
    try {
      if (endpoint.startsWith("/")) {
        return `Using relative endpoint: ${endpoint}`;
      }
      const parsed = new URL(endpoint);
      return `Using endpoint host: ${parsed.host}`;
    } catch {
      return "Endpoint format looks invalid.";
    }
  }

  handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ userInput: e.target.value });
  };

  handleUserInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (this.state.loading || !this.state.userInput.trim()) return;
    this.handleSend();
  };

  private setToast(type: "success" | "error" | "info", text: string): void {
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
    }
    this.setState({ toast: { type, text } });
    this.toastTimer = window.setTimeout(() => this.setState({ toast: undefined }), 5000);
  }

  private isUpdateIntent(input: string): boolean {
    const lowered = input.toLowerCase();
    return lowered.includes("update") || lowered.includes("set ") || lowered.includes("change ");
  }

  private getChangedFields(order: DataRow): string[] {
    const orderNumber = this.toText(order["OrderNumber"]);
    if (!orderNumber || orderNumber === "-") return [];

    const previous = this.orderSnapshots[orderNumber];
    this.orderSnapshots[orderNumber] = { ...order };
    if (!previous) return [];

    const trackedFields = [
      "Status",
      "CustomerReqDelDate",
      "EstShipDate",
      "DeliveryBlock",
      "BillingBlock",
      "TotalOpenQty",
      "NetValue",
      "LastUpdated",
    ];

    return trackedFields.filter((field) => this.toText(previous[field]) !== this.toText(order[field]));
  }

  handleSendClick = () => {
    this.handleSend();
  };

  handleSend = async (forcedInput?: string) => {
    const { messages } = this.state;
    const userInput = (forcedInput ?? this.state.userInput).trim();
    if (!userInput) return;

    const endpoint = this.resolveConfiguredUrl();
    if (!endpoint) {
      this.setState({
        error: "Assistant setup is not complete. Set the PCF input property to your proxy URL (example: https://<your-proxy-host>/api/chat-proxy).",
      });
      return;
    }

    if (this.isEmbedUrl(endpoint)) {
      this.setState({
        error: "Assistant configuration is invalid. Please contact your administrator.",
      });
      return;
    }

    const lowerEndpoint = endpoint.toLowerCase();
    const isPowerAutomateProxy =
      lowerEndpoint.includes("/powerautomate/automations/direct/workflows/") &&
      lowerEndpoint.includes("/triggers/manual/paths/invoke");
    const isDirectAuthenticatedCopilot =
      lowerEndpoint.includes("/authenticated/") && !isPowerAutomateProxy;

    if (isDirectAuthenticatedCopilot) {
      this.setState({
        error: "Assistant configuration is invalid. Please contact your administrator.",
      });
      return;
    }

    this.setState({ loading: true, error: undefined });
    try {
      // Add user message
      const newMessages: CopilotAgentUIState["messages"] = [...messages, { from: "user", text: userInput }];
      this.setState({ messages: newMessages, userInput: "" });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: userInput,
        }),
      });

      const rawResponse = await response.text();

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("You don't have access to this assistant. Please contact your administrator.");
        }
        if (response.status >= 500) {
          throw new Error("The assistant is temporarily unavailable. Please try again in a moment.");
        }
        throw new Error("We couldn't complete your request. Please review it and try again.");
      }

      let agentText = "";
      let agentPayload: AgentPayload | undefined;

      if (rawResponse && rawResponse.trim()) {
        try {
          const data = JSON.parse(rawResponse);

          if (data && typeof data === "object") {
            const action = typeof data.action === "string" ? data.action.toLowerCase() : "";
            const success = data.success === true;
            const recipient = typeof data.recipient === "string" ? data.recipient : "";
            const orderNumber =
              (data.order && typeof data.order === "object" && data.order.OrderNumber !== undefined)
                ? String(data.order.OrderNumber)
                : (data.intent?.notify?.orderNumber ? String(data.intent.notify.orderNumber) : "");

            if (action === "notify" && success && orderNumber) {
              this.emailedOrders[orderNumber] = recipient || "sent";
            }
          }

          if (data && typeof data === "object") {
            const parsed = data as AgentPayload & { response?: string; output?: string };
            const parsedAction = typeof (parsed as any).action === "string" ? String((parsed as any).action) : "";
            const parsedTable = typeof (parsed as any).table === "string" ? String((parsed as any).table) : "";
            const parsedData = Array.isArray((parsed as any).data) ? ((parsed as any).data as DataRow[]) : [];

            const mappedAllocations = Array.isArray((parsed as any).allocations) ? ((parsed as any).allocations as DataRow[]) : [];
            const mappedInventory = Array.isArray((parsed as any).inventory) ? ((parsed as any).inventory as DataRow[]) : [];
            const mappedLocations = Array.isArray((parsed as any).locations) ? ((parsed as any).locations as DataRow[]) : [];

            const fromGeneric = (parsedTable || "").toLowerCase();

            agentPayload = {
              result: typeof parsed.result === "string" ? parsed.result : undefined,
              action: parsedAction,
              table: parsedTable,
              order: parsed.order && typeof parsed.order === "object" ? parsed.order : null,
              customer: parsed.customer && typeof parsed.customer === "object" ? parsed.customer : null,
              lines: Array.isArray(parsed.lines) ? parsed.lines : [],
              products: Array.isArray(parsed.products) ? parsed.products : [],
              shipmentPipeline: parsed.shipmentPipeline && typeof parsed.shipmentPipeline === "object" ? parsed.shipmentPipeline : null,
              data: parsedData,
              allocations: fromGeneric === "orderallocations" && mappedAllocations.length === 0 ? parsedData : mappedAllocations,
              inventory: fromGeneric === "inventory" && mappedInventory.length === 0 ? parsedData : mappedInventory,
              locations: fromGeneric === "locations" && mappedLocations.length === 0 ? parsedData : mappedLocations,
              inventorySummary: (parsed as any).inventorySummary && typeof (parsed as any).inventorySummary === "object" ? ((parsed as any).inventorySummary as Record<string, unknown>) : null,
              changedFields: [],
            };

            if (agentPayload.order) {
              agentPayload.changedFields = this.getChangedFields(agentPayload.order);
            }
          }

          agentText =
            (typeof data?.result === "string" && data.result) ||
            (typeof data?.response === "string" && data.response) ||
            (typeof data?.output === "string" && data.output) ||
            JSON.stringify(data);
        } catch {
          agentText = rawResponse;
        }
      }

      if (!agentText) {
        agentText = "I couldn't find a response for that request. Please try again.";
      }

      if (this.isUpdateIntent(userInput) || agentText.toLowerCase().startsWith("updated ")) {
        this.setToast("success", "Update request completed.");
      } else {
        this.setToast("success", "Lookup completed.");
      }

      this.setState((prev) => ({
        messages: [...prev.messages, { from: "agent", text: agentText, payload: agentPayload }],
        loading: false,
      }));
    } catch (err: any) {
      const message = err?.message || "Unknown error";
      const networkLikeError =
        message === "Failed to fetch" ||
        message.includes("NetworkError") ||
        message.includes("Load failed") ||
        message.includes("ERR_");

      this.setState({
        loading: false,
        error: networkLikeError
          ? "We couldn't reach the assistant right now. Please try again in a moment."
          : message,
      });
      this.setToast("error", networkLikeError ? "Connection issue. Please try again." : message);
    }
  };

  private toText(value: unknown): string {
    if (value === null || value === undefined || value === "") return "-";
    return String(value);
  }

  private renderField(label: string, value: unknown, isNarrowPane: boolean, highlight?: boolean): React.ReactNode {
    return (
      <div style={{ display: "flex", flexDirection: isNarrowPane ? "column" : "row", gap: 4, background: highlight ? "rgba(46, 204, 113, 0.18)" : "transparent", borderRadius: 6, padding: highlight ? "2px 6px" : 0 }}>
        <span style={{ color: "#9ec9ff", minWidth: isNarrowPane ? 0 : 120, fontWeight: 600 }}>{label}:</span>
        <span>{this.toText(value)}</span>
      </div>
    );
  }

  private resolveCustomerEmail(customer: DataRow | null): string {
    if (!customer) return "";
    const candidateFields = [
      "Email",
      "EmailAddress",
      "EmailAddress1",
      "ContactEmail",
      "CustomerEmail",
      "PrimaryEmail",
      "ShipToEmail",
    ];

    for (const field of candidateFields) {
      const value = customer[field];
      if (typeof value === "string" && value.includes("@")) {
        return value.trim();
      }
    }

    return "";
  }

  private sendCustomerEmail = (order: DataRow, customer: DataRow | null): void => {
    const orderNumber = this.toText(order["OrderNumber"]);
    if (!orderNumber || orderNumber === "-") {
      this.setToast("error", "Order number is required before sending email.");
      return;
    }

    const recipient = this.resolveCustomerEmail(customer);
    const prompt = recipient
      ? `send email update to customer for order ${orderNumber} email=${recipient}`
      : `send email update to customer for order ${orderNumber}`;

    this.setToast("info", "Sending customer email...");
    this.handleSend(prompt);
  };

  private renderRichPayload(payload: AgentPayload, isNarrowPane: boolean): React.ReactNode {
    const order = payload.order && typeof payload.order === "object" ? payload.order : null;
    const customer = payload.customer && typeof payload.customer === "object" ? payload.customer : null;
    const lines = Array.isArray(payload.lines) ? payload.lines : [];
    const products = Array.isArray(payload.products) ? payload.products : [];
    const allocations = Array.isArray(payload.allocations) ? payload.allocations : [];
    const inventory = Array.isArray(payload.inventory) ? payload.inventory : [];
    const locations = Array.isArray(payload.locations) ? payload.locations : [];
    const genericData = Array.isArray(payload.data) ? payload.data : [];
    const shipmentPipeline = payload.shipmentPipeline && typeof payload.shipmentPipeline === "object" ? payload.shipmentPipeline : null;
    const shipments = shipmentPipeline && Array.isArray(shipmentPipeline.shipments) ? shipmentPipeline.shipments : [];
    const shipmentEvents = shipmentPipeline && Array.isArray(shipmentPipeline.events) ? shipmentPipeline.events : [];
    const changed = new Set(payload.changedFields || []);

    if (
      !order &&
      !customer &&
      lines.length === 0 &&
      products.length === 0 &&
      shipments.length === 0 &&
      shipmentEvents.length === 0 &&
      allocations.length === 0 &&
      inventory.length === 0 &&
      locations.length === 0 &&
      genericData.length === 0
    ) {
      return null;
    }

    const cardStyle: React.CSSProperties = {
      marginTop: 8,
      padding: isNarrowPane ? 8 : 10,
      borderRadius: 8,
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.12)",
      fontSize: isNarrowPane ? "0.82rem" : "0.9rem",
    };

    return (
      <div style={cardStyle}>
        {order && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Order Details</div>
            {this.renderField("Order", order["OrderNumber"], isNarrowPane)}
            {this.renderField("Status", order["Status"], isNarrowPane, changed.has("Status"))}
            {this.renderField("Customer", order["SoldToName"], isNarrowPane)}
            {this.renderField("PO", order["PONumber"], isNarrowPane)}
            {this.renderField("Net", `${this.toText(order["Currency"])} ${this.toText(order["NetValue"])}`, isNarrowPane, changed.has("NetValue"))}
            {this.renderField("Open Qty", order["TotalOpenQty"], isNarrowPane, changed.has("TotalOpenQty"))}
            {this.renderField("Requested Date", order["CustomerReqDelDate"], isNarrowPane, changed.has("CustomerReqDelDate"))}
            {this.renderField("Estimated Ship", order["EstShipDate"], isNarrowPane, changed.has("EstShipDate"))}
            {this.renderField("Last Updated", order["LastUpdated"], isNarrowPane, changed.has("LastUpdated"))}
            {(() => {
              const orderKey = this.toText(order["OrderNumber"]);
              const sentTo = this.emailedOrders[orderKey];
              if (!sentTo) return null;
              return (
                <div
                  style={{
                    marginTop: 8,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 999,
                    background: "rgba(46, 204, 113, 0.22)",
                    border: "1px solid rgba(109, 243, 167, 0.5)",
                    color: "#6df3a7",
                    fontSize: isNarrowPane ? "0.76rem" : "0.82rem",
                    fontWeight: 600,
                  }}
                >
                  ✓ Email Sent{sentTo !== "sent" ? ` to ${sentTo}` : ""}
                </div>
              );
            })()}
            {changed.size > 0 && <div style={{ marginTop: 6, color: "#6df3a7", fontWeight: 600 }}>Updated fields highlighted.</div>}
          </div>
        )}

        {customer && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Customer</div>
            {this.renderField("Name", customer["CustomerName"], isNarrowPane)}
            {this.renderField("Region", customer["Region"], isNarrowPane)}
            {this.renderField("Currency", customer["Currency"], isNarrowPane)}
            {this.renderField("Ship Country", customer["ShipToCountry"], isNarrowPane)}
          </div>
        )}

        {lines.length > 0 && (
          <div style={{ marginBottom: products.length > 0 ? 10 : 0 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Line Items ({lines.length})</div>
            {lines.slice(0, 5).map((line, idx) => (
              <div key={`line-${idx}`} style={{ marginBottom: 6, padding: 6, borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>
                <div style={{ fontWeight: 600 }}>{this.toText(line["SKU"])} - {this.toText(line["SKUDescription"])}</div>
                <div style={{ opacity: 0.92 }}>
                  Line {this.toText(line["LineNumber"])} | Qty {this.toText(line["OrderQty"])} | Open {this.toText(line["OpenQty"])} | Net {this.toText(line["LineNet"])}
                </div>
              </div>
            ))}
            {lines.length > 5 && <div style={{ opacity: 0.85 }}>Showing first 5 of {lines.length} lines.</div>}
          </div>
        )}

        {products.length > 0 && (
          <div>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Products ({products.length})</div>
            {products.slice(0, 4).map((product, idx) => (
              <div key={`product-${idx}`} style={{ marginBottom: 4 }}>
                {this.toText(product["SKU"])} - {this.toText(product["Description"])} ({this.toText(product["ProductFamily"])})
              </div>
            ))}
            {products.length > 4 && <div style={{ opacity: 0.85 }}>Showing first 4 of {products.length} products.</div>}
          </div>
        )}

        {shipments.length > 0 && (
          <div style={{ marginTop: products.length > 0 ? 10 : 0 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Shipments ({shipments.length})</div>
            {shipments.slice(0, 3).map((s, idx) => (
              <div key={`shipment-${idx}`} style={{ marginBottom: 6, padding: 6, borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>
                <div style={{ fontWeight: 600 }}>
                  {this.toText(s["Carrier"])} {this.toText(s["TrackingNumber"]) !== "-" ? `(${this.toText(s["TrackingNumber"])})` : ""}
                </div>
                <div style={{ opacity: 0.92 }}>
                  Mode {this.toText(s["Mode"])} | Planned Delivery {this.toText(s["PlannedDeliveryDate"])}
                </div>
              </div>
            ))}
            {shipments.length > 3 && <div style={{ opacity: 0.85 }}>Showing first 3 of {shipments.length} shipments.</div>}
          </div>
        )}

        {shipmentEvents.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Shipment Events ({shipmentEvents.length})</div>
            {shipmentEvents.slice(Math.max(0, shipmentEvents.length - 6)).map((e, idx) => (
              <div key={`shipmentevent-${idx}`} style={{ marginBottom: 6, padding: 6, borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>
                <div style={{ fontWeight: 600 }}>
                  {this.toText(e["MilestoneCode"])} {this.toText(e["EventDescription"]) !== "-" ? `- ${this.toText(e["EventDescription"])}` : ""}
                </div>
                <div style={{ opacity: 0.92 }}>
                  {this.toText(e["EventTime"])} {this.toText(e["Location"]) !== "-" ? `| ${this.toText(e["Location"])}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}

        {allocations.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Allocations ({allocations.length})</div>
            {allocations.slice(0, 8).map((a, idx) => (
              <div key={`alloc-${idx}`} style={{ marginBottom: 6, padding: 6, borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>
                <div style={{ fontWeight: 600 }}>
                  {this.toText(a["SKU"])} | Line {this.toText(a["LineNumber"])} | {this.toText(a["AllocatedQty"])} @ {this.toText(a["LocationId"])}
                </div>
                <div style={{ opacity: 0.92 }}>
                  {this.toText(a["AllocationStatus"])} {this.toText(a["PromiseDate"]) !== "-" ? `| Promise ${this.toText(a["PromiseDate"])}` : ""}
                </div>
              </div>
            ))}
            {allocations.length > 8 && <div style={{ opacity: 0.85 }}>Showing first 8 of {allocations.length} allocations.</div>}
          </div>
        )}

        {inventory.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Inventory ({inventory.length})</div>
            {inventory.slice(0, 10).map((inv, idx) => (
              <div key={`inv-${idx}`} style={{ marginBottom: 6, padding: 6, borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>
                <div style={{ fontWeight: 600 }}>
                  {this.toText(inv["SKU"])} @ {this.toText(inv["LocationId"])}
                </div>
                <div style={{ opacity: 0.92 }}>
                  Avail {this.toText(inv["AvailableQty"])} | OnHand {this.toText(inv["OnHandQty"])} | Reserved {this.toText(inv["ReservedQty"])}
                  {this.toText(inv["ATPDate"]) !== "-" ? ` | ATP ${this.toText(inv["ATPDate"])}` : ""}
                </div>
              </div>
            ))}
            {inventory.length > 10 && <div style={{ opacity: 0.85 }}>Showing first 10 of {inventory.length} inventory rows.</div>}
          </div>
        )}

        {locations.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Locations ({locations.length})</div>
            {locations.slice(0, 8).map((loc, idx) => (
              <div key={`loc-${idx}`} style={{ marginBottom: 6, padding: 6, borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>
                <div style={{ fontWeight: 600 }}>
                  {this.toText(loc["LocationId"])} - {this.toText(loc["Name"])}
                </div>
                <div style={{ opacity: 0.92 }}>
                  {this.toText(loc["Type"])} {this.toText(loc["City"]) !== "-" ? `| ${this.toText(loc["City"])}` : ""}{this.toText(loc["State"]) !== "-" ? `, ${this.toText(loc["State"])}` : ""}
                </div>
              </div>
            ))}
            {locations.length > 8 && <div style={{ opacity: 0.85 }}>Showing first 8 of {locations.length} locations.</div>}
          </div>
        )}

        {genericData.length > 0 && allocations.length === 0 && inventory.length === 0 && locations.length === 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: "#9ec9ff", fontWeight: 700, marginBottom: 6 }}>Results ({genericData.length})</div>
            {genericData.slice(0, 6).map((row, idx) => {
              const entries = Object.entries(row || {}).filter(([k]) => !k.startsWith("__")).slice(0, 6);
              return (
                <div key={`data-${idx}`} style={{ marginBottom: 6, padding: 6, borderRadius: 6, background: "rgba(0,0,0,0.15)" }}>
                  {entries.map(([k, v]) => (
                    <div key={`${k}-${idx}`} style={{ opacity: 0.92 }}>
                      <span style={{ color: "#9ec9ff", fontWeight: 600 }}>{k}:</span> {this.toText(v)}
                    </div>
                  ))}
                </div>
              );
            })}
            {genericData.length > 6 && <div style={{ opacity: 0.85 }}>Showing first 6 of {genericData.length} rows.</div>}
          </div>
        )}

        {order && (
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => this.sendCustomerEmail(order, customer)}
              disabled={this.state.loading}
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                border: "none",
                background: "#2d7d46",
                color: "#fff",
                fontWeight: 600,
                cursor: this.state.loading ? "not-allowed" : "pointer",
                width: "100%",
              }}
            >
              Send Customer Email
            </button>
          </div>
        )}
      </div>
    );
  }

  render() {
    const { userInput, messages, loading, error } = this.state;
    const { containerHeight, containerWidth } = this.props;
    const configuredUrl = this.resolveConfiguredUrl();
    const resolvedHeight = typeof containerHeight === "number" && containerHeight > 0 ? containerHeight : undefined;
    const resolvedWidth = typeof containerWidth === "number" && containerWidth > 0 ? containerWidth : undefined;
    const isNarrowPane = typeof resolvedWidth === "number" ? resolvedWidth < 480 : false;
    const containerStyle: React.CSSProperties = {
      ...baseContainerStyle,
      height: resolvedHeight ?? "100%",
      maxWidth: resolvedWidth,
      padding: isNarrowPane ? "8px 0" : baseContainerStyle.padding,
    };
    const responsiveOverlayStyle: React.CSSProperties = {
      ...overlayStyle,
      width: isNarrowPane ? "96%" : overlayStyle.width,
      padding: isNarrowPane ? "0.9rem" : overlayStyle.padding,
      borderRadius: isNarrowPane ? 8 : overlayStyle.borderRadius,
      display: "flex",
      flexDirection: "column",
      minHeight: 0,
    };
    const responsiveTitleStyle: React.CSSProperties = {
      ...titleStyle,
      fontSize: isNarrowPane ? "1.1rem" : titleStyle.fontSize,
      marginBottom: isNarrowPane ? "0.45rem" : titleStyle.marginBottom,
      lineHeight: 1.2,
    };
    const responsiveSubtitleStyle: React.CSSProperties = {
      ...subtitleStyle,
      fontSize: isNarrowPane ? "0.85rem" : subtitleStyle.fontSize,
    };
    const logoContainerStyle: React.CSSProperties = {
      display: "flex",
      justifyContent: "center",
      marginTop: isNarrowPane ? 10 : 14,
      marginBottom: isNarrowPane ? 8 : 12,
    };
    const logoStyle: React.CSSProperties = {
      width: isNarrowPane ? 120 : 170,
      maxWidth: "100%",
      height: "auto",
      opacity: isNarrowPane ? 0.82 : 0.9,
    };
    const messagesContainerStyle: React.CSSProperties = {
      margin: isNarrowPane ? "0.55rem 0" : "1.5rem 0",
      minHeight: isNarrowPane ? 180 : 160,
      background: "rgba(255,255,255,0.05)",
      borderRadius: 8,
      padding: 8,
      overflowY: "auto",
      flex: 1,
      maxHeight: "none",
      fontSize: isNarrowPane ? "0.88rem" : "1rem",
    };
    const messageLineStyle: React.CSSProperties = {
      marginBottom: 4,
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-word",
      lineHeight: 1.35,
    };
    const workingIndicatorStyle: React.CSSProperties = {
      marginBottom: 4,
      padding: "8px 10px",
      borderRadius: 8,
      background: "rgba(255,255,255,0.08)",
      border: "1px solid rgba(255,255,255,0.18)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: isNarrowPane ? "0.82rem" : "0.9rem",
    };
    const spinnerStyle: React.CSSProperties = {
      width: 14,
      height: 14,
      borderRadius: "50%",
      border: "2px solid rgba(255,255,255,0.25)",
      borderTopColor: "#ffffff",
      animation: "pcfSpin 0.8s linear infinite",
      flexShrink: 0,
    };
    const sendRowStyle: React.CSSProperties = {
      display: "flex",
      gap: 8,
      alignItems: isNarrowPane ? "stretch" : "center",
      flexDirection: isNarrowPane ? "column" : "row",
    };
    const sendInputStyle: React.CSSProperties = {
      flex: 1,
      minWidth: 0,
      padding: 8,
      borderRadius: 6,
      border: "none",
      fontSize: isNarrowPane ? "0.9rem" : "1rem",
    };
    const sendButtonStyle: React.CSSProperties = {
      padding: isNarrowPane ? "8px 10px" : "8px 16px",
      borderRadius: 6,
      border: "none",
      background: "#0055a5",
      color: "#fff",
      fontWeight: 600,
      cursor: loading ? "not-allowed" : "pointer",
      width: isNarrowPane ? "100%" : "auto",
      whiteSpace: "nowrap",
    };

    const toastStyle: React.CSSProperties = {
      marginTop: 8,
      padding: "8px 10px",
      borderRadius: 6,
      fontSize: isNarrowPane ? "0.82rem" : "0.9rem",
      background: this.state.toast?.type === "error"
        ? "rgba(255, 92, 92, 0.25)"
        : this.state.toast?.type === "success"
          ? "rgba(46, 204, 113, 0.25)"
          : "rgba(85, 170, 255, 0.25)",
      border: "1px solid rgba(255,255,255,0.22)",
    };

    return (
      <div style={containerStyle}>
        <style>{"@keyframes pcfSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }"}</style>
        <div style={responsiveOverlayStyle}>
          <div style={responsiveTitleStyle}>Order Operations Assistant</div>
          <div style={responsiveSubtitleStyle}>
            Ask questions, review order details, and submit updates in one place.<br />
            <span style={{ fontSize: isNarrowPane ? "0.8rem" : "0.95rem", opacity: 0.85 }}>
              Built for business users.
            </span>
          </div>
          <div style={logoContainerStyle}>
            <img
              src="https://www.milliken.com/-/media/milliken/footer-v2/milliken-logo-footer.svg"
              alt="Milliken & Company"
              style={logoStyle}
            />
          </div>
          <div style={messagesContainerStyle}>
            {messages.length === 0 && <em>No conversation yet.</em>}
            {messages.map((msg, i) => (
              <div key={i} style={{ ...messageLineStyle, color: msg.from === "user" ? "#cce6ff" : "#fff" }}>
                <div>
                  <b>{msg.from === "user" ? "You" : "Agent"}:</b> {msg.text}
                </div>
                {msg.from === "agent" && msg.payload && this.renderRichPayload(msg.payload, isNarrowPane)}
              </div>
            ))}
            {loading && (
              <div style={{ ...messageLineStyle, color: "#fff" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>Agent:</div>
                <div style={workingIndicatorStyle}>
                  <span style={spinnerStyle} />
                  <span>Agent is typing...</span>
                </div>
              </div>
            )}
          </div>
          <div style={sendRowStyle}>
            <input
              type="text"
              value={userInput}
              onChange={this.handleInputChange}
              onKeyDown={this.handleUserInputKeyDown}
              placeholder="Type your message..."
              style={sendInputStyle}
              disabled={loading}
            />
            <button
              onClick={this.handleSendClick}
              disabled={loading || !userInput.trim()}
              style={sendButtonStyle}
            >
              {loading ? "..." : "Send"}
            </button>
          </div>
          {this.state.toast && <div style={toastStyle}>{this.state.toast.text}</div>}
          {error && <div style={{ color: "#ffb3b3", marginTop: 8 }}>{error}</div>}
        </div>
      </div>
    );
  }
}
