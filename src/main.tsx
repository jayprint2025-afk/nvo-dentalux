import React from 'react';
import ReactDOM from 'react-dom/client';
import AuthGate from './AuthGate';
import './index.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
