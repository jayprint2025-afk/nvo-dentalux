import React, { useState, useEffect } from 'react';
import { getSucursalActual, setSucursal } from '../lib/api';

interface SucursalSelectorProps {
  onSucursalChange: (sucursalId: string) => void;
  showDebug?: boolean;
}

const SUCURSALES = [
  { id: 'sucursal_1', name: 'Sucursal 1' },
  { id: 'sucursal_2', name: 'Sucursal 2' },
];

export default function SucursalSelector({ onSucursalChange, showDebug = false }: SucursalSelectorProps) {
  const [selectedSucursal, setSelectedSucursal] = useState(getSucursalActual());

  const handleChange = (sucursalId: string) => {
    setSucursal(sucursalId);
    setSelectedSucursal(sucursalId);
    onSucursalChange(sucursalId);
  };

  return (
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700">Sucursal:</label>
      <select
        value={selectedSucursal}
        onChange={(e) => handleChange(e.target.value)}
        className="px-3 py-2 border rounded-lg bg-white text-sm"
      >
        {SUCURSALES.map((suc) => (
          <option key={suc.id} value={suc.id}>
            {suc.name}
          </option>
        ))}
      </select>
      {showDebug && (
        <span className="text-xs text-gray-500">({selectedSucursal})</span>
      )}
    </div>
  );
}