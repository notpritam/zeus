import React from 'react';
import ReactDOM from 'react-dom/client';
import App from '@/App';
import '@/styles.css';

// Suppress benign ResizeObserver loop errors (triggered by Monaco editor resizing)
window.addEventListener('error', (e) => {
  if (e.message?.includes('ResizeObserver loop')) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
