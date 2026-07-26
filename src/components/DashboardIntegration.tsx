import React, { useState, useEffect } from 'react';
import { Building2, BarChart3, X } from 'lucide-react';
import GlobalDashboard from './GlobalDashboard';

interface DashboardIntegrationProps {
  sucursalActual: string;
  onClose?: () => void;
}

const DashboardIntegration: React.FC<DashboardIntegrationProps> = ({ 
  sucursalActual, 
  onClose 
}) => {
  const [mostrarDashboard, setMostrarDashboard] = useState(false);

  if (!mostrarDashboard) {
    return (
      <button
        onClick={() => setMostrarDashboard(true)}
        className="fixed bottom-20 right-5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white rounded-full p-4 shadow-2xl transition-all duration-300 transform hover:scale-105 z-50"
        title="Dashboard Global - Comparar Sucursales"
      >
        <div className="flex items-center space-x-2">
          <BarChart3 className="h-6 w-6" />
          <Building2 className="h-5 w-5" />
        </div>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[9999] overflow-auto">
      <div className="min-h-screen bg-gray-100">
        {/* Header con botón de cierre */}
        <div className="bg-white shadow-lg border-b-2 border-blue-600">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="py-4 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="bg-gradient-to-r from-purple-600 to-blue-600 p-2 rounded-lg">
                  <Building2 className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Dashboard Global de Sucursales</h1>
                  <p className="text-sm text-gray-600">
                    Análisis comparativo integral • Sucursal actual: {sucursalActual}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                  Vista de Administrador
                </span>
                <button
                  onClick={() => {
                    setMostrarDashboard(false);
                    onClose?.();
                  }}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-full p-2 transition-colors"
                  title="Cerrar Dashboard"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Dashboard Component */}
        <GlobalDashboard />
        
        {/* Footer */}
        <div className="bg-white border-t border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <div className="flex items-center space-x-4">
                <span>🏥 Sistema de Gestión Dental</span>
                <span>•</span>
                <span>Dashboard Global v1.0</span>
              </div>
              <div className="flex items-center space-x-2">
                <span>Datos en tiempo real</span>
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardIntegration;