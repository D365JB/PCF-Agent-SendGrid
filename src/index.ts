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

  constructor() {}

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void, state: ComponentFramework.Dictionary, container: HTMLDivElement) {
    this._container = container;
    this._root = createRoot(this._container);
    this._notifyOutputChanged = notifyOutputChanged;
    this._copilotApiKey = context.parameters.CopilotApiKey?.raw || "";
    this.render();
  }

  public updateView(context: ComponentFramework.Context<IInputs>): void {
    this._copilotApiKey = context.parameters.CopilotApiKey?.raw || "";
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
      })
    );
  }

  private handleSend = (message: string) => {
    this._messages.push({ sender: "User", text: message });
    // Placeholder: Integrate Copilot API call here using this._copilotApiKey
    this._messages.push({ sender: "Copilot", text: "Copilot response placeholder." });
    this._notifyOutputChanged();
    this.render();
  };

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    this._root?.unmount();
    this._root = null;
  }
}
