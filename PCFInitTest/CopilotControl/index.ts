import { IInputs, IOutputs } from "./generated/ManifestTypes";
import React from 'react';
import ReactDOM from 'react-dom';

const containerStyle: React.CSSProperties = {
    position: 'relative',
    width: '100%',
    height: '350px',
    background: 'linear-gradient(135deg, #003366 60%, #0055a5 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
};

const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: '20%',
    left: '10%',
    width: '80%',
    background: 'rgba(0, 51, 102, 0.8)',
    color: '#fff',
    padding: '2rem',
    borderRadius: '12px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
    zIndex: 2,
};

const titleStyle: React.CSSProperties = {
    fontSize: '2rem',
    fontWeight: 700,
    marginBottom: '1rem',
};

const subtitleStyle: React.CSSProperties = {
    fontSize: '1.1rem',
    fontWeight: 400,
    opacity: 0.95,
};

class CopilotAgentUI extends React.Component {
    render() {
        return React.createElement(
            'div',
            { style: containerStyle },
            React.createElement(
                'div',
                { style: overlayStyle },
                React.createElement('div', { style: titleStyle }, 'Copilot Studio Agent'),
                React.createElement(
                    'div',
                    { style: subtitleStyle },
                    'Connect and interact with your Dynamics Copilot agent.',
                    React.createElement('br'),
                    React.createElement(
                        'span',
                        { style: { fontSize: '0.95rem', opacity: 0.85 } },
                        'Modern, secure, and easy to use.'
                    )
                ),
                React.createElement(
                    'div',
                    { style: { marginTop: '2rem', fontSize: '1rem', opacity: 0.8 } },
                    React.createElement(
                        'em',
                        null,
                        'To enable agent interaction, configure your Dynamics environment and Copilot Studio agent endpoint.'
                    )
                )
            )
        );
    }
}

export class CopilotControl implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    /**
     * Empty constructor.
     */
    constructor() {
        // Empty
    }

    /**
     * Used to initialize the control instance. Controls can kick off remote server calls and other initialization actions here.
     * Data-set values are not initialized here, use updateView.
     * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to property names defined in the manifest, as well as utility functions.
     * @param notifyOutputChanged A callback method to alert the framework that the control has new outputs ready to be retrieved asynchronously.
     * @param state A piece of data that persists in one session for a single user. Can be set at any point in a controls life cycle by calling 'setControlState' in the Mode interface.
     * @param container If a control is marked control-type='standard', it will receive an empty div element within which it can render its content.
     */

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary,
        container: HTMLDivElement
    ): void {
        // Render CopilotAgentUI React component
        const root = document.createElement('div');
        root.id = 'copilot-agent-root';
        container.appendChild(root);
        ReactDOM.render(
            React.createElement(CopilotAgentUI),
            root
        );
    }


    /**
     * Called when any value in the property bag has changed. This includes field values, data-sets, global values such as container height and width, offline status, control metadata values such as label, visible, etc.
     * @param context The entire property bag available to control via Context Object; It contains values as set up by the customizer mapped to names defined in the manifest, as well as utility functions
     */
    public updateView(context: ComponentFramework.Context<IInputs>): void {
        // Add code to update control view
    }

    /**
     * It is called by the framework prior to a control receiving new data.
     * @returns an object based on nomenclature defined in manifest, expecting object[s] for property marked as "bound" or "output"
     */
    public getOutputs(): IOutputs {
        return {};
    }

    /**
     * Called when the control is to be removed from the DOM tree. Controls should use this call for cleanup.
     * i.e. cancelling any pending remote calls, removing listeners, etc.
     */
    public destroy(): void {
        // Add code to cleanup control if necessary
    }
}
