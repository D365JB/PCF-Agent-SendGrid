
import React from 'react';

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

export default function CopilotAgentUI() {
	return (
		<div style={containerStyle}>
			{/* Overlay for content */}
			<div style={overlayStyle}>
				<div style={titleStyle}>Copilot Studio Agent</div>
				<div style={subtitleStyle}>
					Connect and interact with your Dynamics Copilot agent.<br />
					<span style={{ fontSize: '0.95rem', opacity: 0.85 }}>Modern, secure, and easy to use.</span>
				</div>
				{/* Agent interaction UI will be added here */}
				<div style={{ marginTop: '2rem', fontSize: '1rem', opacity: 0.8 }}>
					{/* Placeholder: Connect to Copilot Studio agent endpoint here */}
					<em>To enable agent interaction, configure your Dynamics environment and Copilot Studio agent endpoint.</em>
				</div>
			</div>
			{/* Background image or gradient can be added here if needed */}
		</div>
	);
}
