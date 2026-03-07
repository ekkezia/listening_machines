import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { MicProvider, useMic } from './context/MicContext.jsx';
import MicPermissionOverlay from './components/MicPermissionOverlay.jsx';

/**
 * Sits inside MicProvider so it can read mic state.
 * When the user has attempted mic access and it failed, the whole app
 * is blurred behind the overlay asking them to allow the mic.
 */
function MicGate({ children }) {
  const { micError, attempted } = useMic();
  const blocked = attempted && !!micError;

  return (
    <div className="relative">
      <div className={blocked ? 'pointer-events-none select-none blur-sm opacity-40' : undefined}>
        {children}
      </div>
      {blocked && <MicPermissionOverlay />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MicProvider>
      <MicGate>
        <App />
      </MicGate>
    </MicProvider>
  </StrictMode>
);
