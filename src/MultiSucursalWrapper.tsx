import React, { useEffect, useState } from 'react';
import App from './App';

const getInitialSucursal = () =>
  localStorage.getItem('dentalux_sucursal_actual') || 'sucursal_1';

export default function MultiSucursalWrapper() {
  const [sucursalId, setSucursalId] = useState<string>(getInitialSucursal());

  // Solo escucha cambios de sucursal - NO intercepta fetch
  useEffect(() => {
    const handler = (e: any) => setSucursalId(e.detail?.sucursal || getInitialSucursal());
    window.addEventListener('sucursalChanged', handler);
    
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'dentalux_sucursal_actual') setSucursalId(getInitialSucursal());
    };
    window.addEventListener('storage', onStorage);
    
    return () => {
      window.removeEventListener('sucursalChanged', handler);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // Re-renderiza App cuando cambie la sucursal
  return <App key={`app-${sucursalId}`} />;
}