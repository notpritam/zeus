import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/styles.css';

// Suppress benign ResizeObserver loop errors (triggered by Monaco editor resizing).
// Must be registered BEFORE React mounts. Intercept at both error and unhandledrejection levels.
const isBenignError = (msg: string | undefined) =>
  (msg?.includes('ResizeObserver') || msg === 'Canceled') ?? false;

window.addEventListener('error', (e) => {
  if (isBenignError(e.message)) {
    e.stopImmediatePropagation();
    e.preventDefault();
    return false;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  if (isBenignError(e.reason?.message ?? String(e.reason))) {
    e.preventDefault();
  }
});

// Also patch the global onerror for Electron's renderer crash reporting
const origOnError = window.onerror;
window.onerror = (message, ...rest) => {
  if (isBenignError(typeof message === 'string' ? message : '')) {
    return true; // swallow
  }
  return origOnError?.call(window, message, ...rest) ?? false;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
