
import * as React from "react";

const MILLIKEN_LOGO_URL = "https://www.cornerstonebuildingbrands.com/wp-content/uploads/2023/06/CBBLogo.png";

export interface CopilotChatProps {
  value: string;
  onSend: (message: string) => void;
  messages: Array<{ sender: string; text: string }>;
  pipelineSteps?: Array<{ label: string; status: string; detail?: string }>;
}

export const CopilotChat: React.FC<CopilotChatProps> = ({ value, onSend, messages, pipelineSteps }) => {
  const [input, setInput] = React.useState("");

  const handleSend = () => {
    if (input.trim()) {
      onSend(input);
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSend();
    }
  };

  return (
    <div style={{
      background: "#f7f8fa",
      border: "1px solid #e0e0e0",
      borderRadius: 12,
      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      padding: 24,
      maxWidth: 400,
      margin: "auto"
    }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
        <img
          src={MILLIKEN_LOGO_URL}
          alt="Cornerstone Building Brands"
          style={{ height: 28, width: "auto", display: "block" }}
        />
      </div>
      {Array.isArray(pipelineSteps) && pipelineSteps.length > 0 && (
        <div style={{
          marginBottom: 12,
          background: "#fff",
          borderRadius: 8,
          padding: 12,
          border: "1px solid #e6e6e6",
          boxShadow: "0 1px 4px rgba(0,0,0,0.03)"
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#444", marginBottom: 8 }}>
                  Carrier + SAP shipment events → predicted delay → proactive notification
          </div>
          {pipelineSteps.map((s, idx) => {
            const status = String(s.status || "").toLowerCase();
            const badgeBg = status === "action" ? "#0078d4" : status === "missing" ? "#888" : "#e5e5e5";
            const badgeColor = status === "action" ? "#fff" : status === "missing" ? "#fff" : "#333";
            const badgeText = status === "action" ? "ACTION" : status === "missing" ? "MISSING" : "OK";
            return (
              <div key={idx} style={{ display: "flex", alignItems: "center", marginBottom: idx === pipelineSteps.length - 1 ? 0 : 6 }}>
                <span style={{
                  display: "inline-block",
                  minWidth: 62,
                  textAlign: "center",
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: badgeBg,
                  color: badgeColor,
                  fontSize: 11,
                  fontWeight: 700,
                  marginRight: 10
                }}>
                  {badgeText}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>{s.label}</div>
                  {s.detail && <div style={{ fontSize: 12, color: "#666" }}>{s.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{
        height: 260,
        overflowY: "auto",
        marginBottom: 16,
        background: "#fff",
        borderRadius: 8,
        padding: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.03)"
      }}>
        {messages.length === 0 ? (
          <div style={{ color: "#888", textAlign: "center", marginTop: 80 }}>
            Start your conversation with Copilot...
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                marginBottom: 10,
                display: "flex",
                justifyContent: msg.sender === "User" ? "flex-end" : "flex-start"
              }}
            >
              <div
                style={{
                  background: msg.sender === "User" ? "#0078d4" : "#e5e5e5",
                  color: msg.sender === "User" ? "#fff" : "#333",
                  borderRadius: 16,
                  padding: "8px 16px",
                  maxWidth: "70%",
                  fontSize: 15,
                  boxShadow: msg.sender === "User" ? "0 2px 6px rgba(0,120,212,0.08)" : "0 2px 6px rgba(0,0,0,0.04)"
                }}
              >
                {msg.text}
              </div>
            </div>
          ))
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message..."
          style={{
            flex: 1,
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid #d0d0d0",
            fontSize: 15,
            outline: "none",
            marginRight: 8
          }}
        />
        <button
          onClick={handleSend}
          style={{
            background: "#0078d4",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 18px",
            fontSize: 15,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,120,212,0.08)"
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
};
