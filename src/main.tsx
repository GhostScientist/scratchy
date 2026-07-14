import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if (import.meta.env.PROD) {
  // Offline app shell — registered only in production builds; the dev
  // server (and default e2e suite) never runs a service worker.
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
