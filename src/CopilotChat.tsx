
import * as React from "react";

export interface CopilotChatProps {
  value: string;
  onSend: (message: string) => void;
  messages: Array<{ sender: string; text: string }>;
}

export const CopilotChat: React.FC<CopilotChatProps> = ({ value, onSend, messages }) => {
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
