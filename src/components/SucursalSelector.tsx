import React, { useState, useEffect } from 'react';
import { Building2, ChevronDown, CheckCircle, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import {
  api,
  buildApiUrl,
  getSucursalActual,
  setSucursal,
  debugSucursalConfig,
  testSucursalAPI
} from '../lib/api';


const SucursalSelector = ({ onSucursalChange, showDebug = false }) => {
  const [sucursalActual, setSucursalActual] = useState(getSucursalActual);
  const [estadisticas, setEstadisticas] = useState(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('checking');
  
  const sucursales = [
    { 
      id: 'sucursal_1', 
      nombre: 'Sucursal Victoria', 
      color: 'bg-blue-500',
      descripcion: 'Oficina principal'
    },
    { 
      id: 'sucursal_2', 
      nombre: 'Sucursal Condesa', 
      color: 'bg-green-500',
      descripcion: 'Sucursal secundaria'
    }
  ];

  useEffect(() => {
    // Escuchar cambios de sucursal
    const handleSucursalChange = (event) => {
      setSucursalActual(event.detail.sucursal);
      setIsOpen(false);
    };
    
    window.addEventListener('sucursalChanged', handleSucursalChange);
    
    // Verificar estadísticas al montar
    verificarEstadisticas();
    
    return () => {
      window.removeEventListener('sucursalChanged', handleSucursalChange);
    };
  }, []);

  const verificarEstadisticas = async () => {
    setLoading(true);
    try {
      // Probar conexión real al backend
      const testResult = await testSucursalAPI();
      setConnectionStatus(testResult?.ok ? 'connected' : 'disconnected');

      // Cargar estadísticas desde el backend real
      const s = getSucursalActual() || 'sucursal_1';
      const data = await api(`/debug/sucursales?sucursal=${encodeURIComponent(s)}`);
      setEstadisticas(data);
      console.log('📊 Estadísticas cargadas:', data);
    } catch (error) {
      console.error('Error verificando estadísticas:', error);
      setConnectionStatus('disconnected');

      // Mock para desarrollo si algo falla
      setEstadisticas({
        sucursales: ['sucursal_1', 'sucursal_2'],
        estadisticas: {
          doctors: [
            { sucursal_id: 'sucursal_1', count: '3' },
          ],
          appointments: [
            { sucursal_id: 'sucursal_1', count: '15' },
          ]
        }
      });
    } finally {
      setLoading(false);
    }
  };

  const cambiarSucursal = (nuevaSucursal) => {
    if (nuevaSucursal === sucursalActual) {
      setIsOpen(false);
      return;
    }
    
    console.log(`🔄 Iniciando cambio de ${sucursalActual} a ${nuevaSucursal}`);
    
    // Confirmar cambio si hay datos
    const sucursalData = sucursales.find(s => s.id === nuevaSucursal);
    const hasData = getSucursalStats(nuevaSucursal) > 0;
    
    if (hasData) {
      const confirmChange = window.confirm(
        `¿Cambiar a ${sucursalData?.nombre}?\n\nEsto cargará los datos específicos de esa sucursal.\n\nLa página se recargará automáticamente.`
      );
      
      if (!confirmChange) {
        setIsOpen(false);
        return;
      }
    }
    
    // Realizar el cambio
    setSucursal(nuevaSucursal);
    
    // Notificar al componente padre si existe
    if (onSucursalChange) {
      onSucursalChange(nuevaSucursal);
    }
    
    setIsOpen(false);
    
    // Recargar la página automáticamente
    setTimeout(() => {
      window.location.reload();
    }, 100);
  };

  const getSucursalStats = (sucursalId) => {
    if (!estadisticas?.estadisticas) return 0;
    
    let totalRecords = 0;
    Object.values(estadisticas.estadisticas).forEach(table => {
      if (Array.isArray(table)) {
        const sucursalRow = table.find(row => row.sucursal_id === sucursalId);
        if (sucursalRow) {
          totalRecords += parseInt(sucursalRow.count) || 0;
        }
      }
    });
    
    return totalRecords;
  };

  const sucursalActualData = sucursales.find(s => s.id === sucursalActual);

  return (
    <div className="relative">
      {/* Botón selector actual */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-4 py-3 bg-white border border-gray-200 rounded-xl shadow-sm hover:bg-gray-50 hover:shadow-md transition-all duration-200 min-w-[200px]"
      >
        <div className={`w-4 h-4 rounded-full ${sucursalActualData?.color}`}></div>
        <Building2 className="w-5 h-5 text-gray-600" />
        <div className="flex-1 text-left">
          <div className="font-medium text-gray-900">
            {sucursalActualData?.nombre || 'Sucursal Desconocida'}
          </div>
          <div className="text-xs text-gray-500">
            {getSucursalStats(sucursalActual)} registros
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connectionStatus === 'connected' && <Wifi className="w-4 h-4 text-green-500" />}
          {connectionStatus === 'disconnected' && <WifiOff className="w-4 h-4 text-red-500" />}
          {loading && <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />}
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-800">Seleccionar Sucursal</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={verificarEstadisticas}
                  className="p-1 hover:bg-gray-100 rounded-lg"
                  title="Actualizar estadísticas"
                  disabled={loading}
                >
                  <RefreshCw className={`w-4 h-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
                </button>
                {connectionStatus === 'connected' && <Wifi className="w-4 h-4 text-green-500" />}
                {connectionStatus === 'disconnected' && <WifiOff className="w-4 h-4 text-red-500" />}
              </div>
            </div>
            
            <div className="space-y-2">
              {sucursales.map((sucursal) => {
                const stats = getSucursalStats(sucursal.id);
                const isSelected = sucursal.id === sucursalActual;
                
                return (
                  <button
                    key={sucursal.id}
                    onClick={() => cambiarSucursal(sucursal.id)}
                    className={`w-full flex items-center justify-between p-3 rounded-lg text-left transition-all duration-200 ${
                      isSelected 
                        ? 'bg-blue-50 border-2 border-blue-200 shadow-sm' 
                        : 'hover:bg-gray-50 border border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-4 h-4 rounded-full ${sucursal.color}`}></div>
                      <div>
                        <div className="font-medium text-gray-900">
                          {sucursal.nombre}
                        </div>
                        <div className="text-xs text-gray-500">
                          {sucursal.descripcion}
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {stats ? `${stats} registros` : 'Sin datos'}
                        </div>
                      </div>
                    </div>
                    
                    {isSelected && (
                      <CheckCircle className="w-5 h-5 text-blue-600" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Estado de conexión */}
            <div className="mt-4 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Estado:</span>
                <div className="flex items-center gap-2">
                  {connectionStatus === 'connected' ? (
                    <>
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                      <span className="text-green-600">Conectado</span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                      <span className="text-red-600">Desconectado</span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Sucursal actual: {sucursalActual}
              </div>
            </div>

            {/* Debug section - solo en desarrollo */}
            {(showDebug || process.env.NODE_ENV === 'development') && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <div className="text-xs font-medium text-gray-600 mb-2">Debug Tools</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const config = debugSucursalConfig();
                      alert(`Debug Info:\n${JSON.stringify(config, null, 2)}`);
                    }}
                    className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
                  >
                    Config
                  </button>
                  <button
                    onClick={() => {
                      const s = getSucursalActual() || 'sucursal_1';
                      window.open(
                        buildApiUrl(`/debug/sucursales?sucursal=${encodeURIComponent(s)}`),
                        '_blank'
                      );
                    }}
                    className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
                  >
                    Stats API
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* Overlay para cerrar */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
};

export default SucursalSelector;