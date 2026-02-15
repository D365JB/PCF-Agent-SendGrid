import { IInputs, IOutputs } from "../generated/ManifestTypes";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { CopilotChat } from "./CopilotChat";

export class PCFCopilotControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
  private _container: HTMLDivElement;
  private _root: Root | null = null;
  private _value: string = "";
  private _messages: Array<{ sender: string; text: string }> = [];
  private _notifyOutputChanged: () => void;
  private _copilotApiKey: string = "";
  private _proxyUrl: string = "";
  private _proxyKey: string = "";
  private _pipelineSteps: Array<{ label: string; status: string; detail?: string }> = [];

  constructor() {}

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, state: ComponentFramework.Dictionary, container: HTMLDivElement) {
    this._container = container;
    this._root = createRoot(this._container);
    this._notifyOutputChanged = notifyOutputChanged;
    this._copilotApiKey = context.parameters.CopilotApiKey?.raw || "";
    this._proxyUrl = context.parameters.ProxyUrl?.raw || "";
    this._proxyKey = context.parameters.ProxyKey?.raw || "";
    this.render();
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this._copilotApiKey = context.parameters.CopilotApiKey?.raw || "";
    this._proxyUrl = context.parameters.ProxyUrl?.raw || "";
    this._proxyKey = context.parameters.ProxyKey?.raw || "";
    this.render();
  }

  private render() {
    if (!this._root) {
      return;
    }

    this._root.render(
      React.createElement(CopilotChat, {
        value: this._value,
        onSend: this.handleSend,
        messages: this._messages,
        pipelineSteps: this._pipelineSteps,
      })
    );
  }

  private handleSend = (message: string) => {
    this._messages.push({ sender: "User", text: message });
    this._notifyOutputChanged();
    this.render();

    void this.sendToProxy(message);
  };

  private resolveChatProxyUrl(): string {
    const raw = String(this._proxyUrl || "").trim();
    if (!raw) return "";
    const trimmed = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    if (trimmed.toLowerCase().endsWith("/api/chat-proxy")) {
      return trimmed;
    }
    return `${trimmed}/api/chat-proxy`;
  }

  private async sendToProxy(message: string): Promise<void> {
    const url = this.resolveChatProxyUrl();
    if (!url) {
      this._messages.push({ sender: "Copilot", text: "ProxyUrl is not configured. Set the PCF input property 'Proxy URL' to your AzureProxyWebApp base URL." });
      this._notifyOutputChanged();
      this.render();
      return;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this._proxyKey) {
        headers["x-proxy-key"] = this._proxyKey;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ input: message }),
      });

      const raw = await response.text();
      if (!response.ok) {
        this._messages.push({ sender: "Copilot", text: `Proxy error (${response.status}). ${raw || ""}`.trim() });
        this._notifyOutputChanged();
        this.render();
        return;
      }

      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = null;
      }

      const resultText = parsed && typeof parsed.result === "string" ? parsed.result : (raw || "No response.");
      this._messages.push({ sender: "Copilot", text: resultText });

      const steps = parsed?.shipmentPipeline?.steps;
      if (Array.isArray(steps)) {
        this._pipelineSteps = steps;
      } else {
        this._pipelineSteps = [];
      }

      this._notifyOutputChanged();
      this.render();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this._messages.push({ sender: "Copilot", text: `Request failed: ${messageText}` });
      this._notifyOutputChanged();
      this.render();
    }
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    this._root?.unmount();
    this._root = null;
  }
}
