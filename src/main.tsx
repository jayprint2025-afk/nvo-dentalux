import React from 'react';
import ReactDOM from 'react-dom/client';
import MultiSucursalWrapper from './MultiSucursalWrapper';  // ← CAMBIO 1
import './index.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <MultiSucursalWrapper />                                // ← CAMBIO 2
  </React.StrictMode>
);