import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p style={{ color: '#ff6b6b', padding: '2rem' }}>An error occurred and was reported to Sentry.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
