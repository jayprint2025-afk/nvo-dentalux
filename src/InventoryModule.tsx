import React, { useState, useEffect, useMemo } from 'react';
import { 
  Package, Search, Filter, Plus, Edit, Trash2, ShoppingCart, 
  AlertTriangle, TrendingUp, DollarSign, BarChart3, FileText,
  Check, X, AlertCircle, Activity, Download, RefreshCw
} from 'lucide-react';
import { api } from './lib/api';

// Tipos
interface InventoryItem {
  id: number;
  sku: string;
  name: string;
  category: 'instrumental' | 'desechable' | 'anestesia' | 'resina' | 'endodoncia' | 'ortodoncia';
  type: 'equipment' | 'material';
  quantity: number;
  minStock: number;
  maxStock: number;
  price: number;
  supplier: string;
  lastPurchase: string;
  usagePerPatient: number;
  expirationDate?: string;
}

interface TreatmentFormula {
  [key: string]: {
    item: string;
    quantity: number;
  }[];
}

interface PurchaseOrder {
  id: number;
  date: string;
  supplier: string;
  items: {
    name: string;
    quantity: number;
    price: number;
  }[];
  total: number;
  status: 'pendiente' | 'recibido' | 'cancelado';
}

type StockStatus = 'critical' | 'low' | 'medium' | 'good';
type TabType = 'equipment' | 'materials' | 'formulas' | 'purchases' | 'analytics';

export function InventoryModule({ onClose }: { onClose: () => void }) {
  // Estados principales
  const [activeTab, setActiveTab] = useState<TabType>('equipment');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockFilter, setStockFilter] = useState<StockStatus | ''>('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [purchases, setPurchases] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(false);

  // Cargar datos iniciales
  useEffect(() => {
    loadInventoryData();
    loadPurchaseHistory();
  }, []);

  // 🔥 FUNCIÓN PRINCIPAL - Cargar desde backend
  const loadInventoryData = async () => {
  setLoading(true);
  try {
    const data = await api('/inventory');
    
    const transformedData: InventoryItem[] = data.map((item: any) => ({
      id: item.id,
      sku: item.sku,
      name: item.name,
      category: item.category,
      type: item.type,
      quantity: item.quantity,
      minStock: item.min_stock,
      maxStock: item.max_stock,
      price: parseFloat(item.price),
      supplier: item.supplier || '',
      lastPurchase: item.last_purchase,
      usagePerPatient: parseFloat(item.usage_per_patient),
      expirationDate: item.expiration_date
    }));
    
    setInventory(transformedData);
    console.log('✅ Inventario cargado desde backend:', transformedData.length, 'items');
  } catch (error) {
    console.error('❌ Error cargando inventario:', error);
    alert('Error al cargar el inventario. Verifica que el backend esté corriendo.');
  } finally {
    setLoading(false);
  }
};


  const loadPurchaseHistory = () => {
    const samplePurchases: PurchaseOrder[] = [
      {
        id: 1,
        date: "2024-12-10",
        supplier: "SafeMed",
        items: [
          { name: "Guantes de Látex", quantity: 20, price: 3600 },
          { name: "Cubrebocas Tricapa", quantity: 15, price: 1800 }
        ],
        total: 5400,
        status: 'recibido'
      }
    ];

    const savedPurchases = localStorage.getItem('dentalux_purchases');
    if (savedPurchases) {
      setPurchases(JSON.parse(savedPurchases));
    } else {
      setPurchases(samplePurchases);
    }
  };

  // Fórmulas de tratamiento
  const treatmentFormulas: TreatmentFormula = {
    "Limpieza Dental": [
      { item: "Guantes de Látex", quantity: 2 },
      { item: "Cubrebocas Tricapa", quantity: 1 },
      { item: "Gasas Estériles", quantity: 3 }
    ],
    "Resina Dental": [
      { item: "Guantes de Látex", quantity: 2 },
      { item: "Cubrebocas Tricapa", quantity: 1 },
      { item: "Resina A2", quantity: 0.5 },
      { item: "Ácido Grabador", quantity: 0.3 }
    ],
    "Extracción Simple": [
      { item: "Guantes de Látex", quantity: 2 },
      { item: "Lidocaína 2%", quantity: 2 },
      { item: "Gasas Estériles", quantity: 10 }
    ],
    "Endodoncia": [
      { item: "Guantes de Látex", quantity: 4 },
      { item: "Lidocaína 2%", quantity: 3 },
      { item: "Limas K", quantity: 0.5 },
      { item: "Gasas Estériles", quantity: 15 }
    ]
  };

  // Funciones de utilidad
  const getStockStatus = (item: InventoryItem): StockStatus => {
    const percentage = (item.quantity / item.minStock) * 100;
    if (percentage <= 50) return 'critical';
    if (percentage <= 100) return 'low';
    if (percentage <= 150) return 'medium';
    return 'good';
  };

  const getStockColor = (status: StockStatus) => {
    switch (status) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'low': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'good': return 'bg-green-100 text-green-800 border-green-200';
    }
  };

  const getStockIcon = (status: StockStatus) => {
    switch (status) {
      case 'critical': return '🔴';
      case 'low': return '🟠';
      case 'medium': return '🟡';
      case 'good': return '🟢';
    }
  };

  // Filtrado de inventario
  const filteredInventory = useMemo(() => {
    let filtered = [...inventory];

    if (activeTab === 'equipment') {
      filtered = filtered.filter(item => item.type === 'equipment');
    } else if (activeTab === 'materials') {
      filtered = filtered.filter(item => item.type === 'material');
    }

    if (searchTerm) {
      filtered = filtered.filter(item =>
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (categoryFilter) {
      filtered = filtered.filter(item => item.category === categoryFilter);
    }

    if (stockFilter) {
      filtered = filtered.filter(item => getStockStatus(item) === stockFilter);
    }

    return filtered;
  }, [inventory, activeTab, searchTerm, categoryFilter, stockFilter]);

  // Estadísticas
  const stats = useMemo(() => {
    const critical = inventory.filter(i => getStockStatus(i) === 'critical').length;
    const low = inventory.filter(i => getStockStatus(i) === 'low').length;
    const totalValue = inventory.reduce((sum, item) => sum + (item.quantity * item.price), 0);
    const optimalStock = inventory.filter(i => getStockStatus(i) === 'good').length;
    
    return {
      totalItems: inventory.length,
      criticalItems: critical,
      lowItems: low,
      totalValue,
      optimalStock: Math.round((optimalStock / inventory.length) * 100)
    };
  }, [inventory]);

  // 🔥 HANDLERS CON BACKEND

  const handleUseItem = async (item: InventoryItem, quantity: number) => {
    try {
      const newQuantity = Math.max(0, item.quantity - quantity);
      
    await api(`/inventory/${item.id}`, {
  method: 'PUT',
  body: JSON.stringify({
    quantity: newQuantity,
    minStock: item.minStock,
    maxStock: item.maxStock
  })
});

      await loadInventoryData();
      console.log('✅ Item usado correctamente');
    } catch (error) {
      console.error('❌ Error usando item:', error);
      alert('Error al actualizar el inventario');
    }
  };

 // 🔥 Aplicar fórmula usando backend
const handleApplyFormula = async (treatmentName: string) => {
  try {
    // Le pedimos al backend que aplique la fórmula y nos regrese el inventario actualizado
    const updatedInventory: InventoryItem[] = await api('/inventory/apply-formula', {
      method: 'POST',
      body: JSON.stringify({ treatmentName })
    });

    setInventory(updatedInventory);
    console.log('✅ Fórmula aplicada desde backend:', treatmentName);
  } catch (error) {
    console.error('❌ Error aplicando fórmula:', error);
    alert('Error al aplicar la fórmula en el inventario');
  }
};

  const handleSaveItem = async (itemData: Partial<InventoryItem>) => {
    try {
      const url = editingItem 
        ? `/api/inventory/${editingItem.id}`
        : '/api/inventory';
      
      const method = editingItem ? 'PUT' : 'POST';
      
      const payload = {
        sku: itemData.sku,
        name: itemData.name,
        category: itemData.category,
        type: itemData.type,
        quantity: itemData.quantity,
        minStock: itemData.minStock,
        maxStock: itemData.maxStock,
        price: itemData.price,
        supplier: itemData.supplier,
        usagePerPatient: itemData.usagePerPatient,
        expirationDate: itemData.expirationDate || null
      };

      await api(url.replace('/api', ''), {
  method,
  body: JSON.stringify(payload)
});

      await loadInventoryData();
      setShowAddModal(false);
      setEditingItem(null);
      console.log('✅ Item guardado correctamente');
    } catch (error) {
      console.error('❌ Error guardando item:', error);
      alert('Error al guardar el item');
    }
  };

  const handleDeleteItem = async (id: number) => {
    if (!window.confirm('¿Estás seguro de eliminar este item?')) return;
    
    try {
      await api(`/inventory/${id}`, {
  method: 'DELETE'
});

      await loadInventoryData();
      console.log('✅ Item eliminado correctamente');
    } catch (error) {
      console.error('❌ Error eliminando item:', error);
      alert('Error al eliminar el item');
    }
  };

  const exportData = () => {
    const data = {
      inventory,
      purchases,
      exportDate: new Date().toISOString(),
      stats
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventario_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-gradient-to-br from-green-50 to-emerald-100">
      <div className="h-full overflow-auto">
        <div className="max-w-7xl mx-auto p-3 sm:p-6 overflow-x-hidden">
          {/* Header */}
          <div className="bg-white rounded-2xl shadow-xl mb-6 p-6">
           <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Package className="w-8 h-8 text-green-600" />
                Inventario Dental
              </h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <button
                  onClick={loadInventoryData}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 text-sm whitespace-nowrap"
                >
                  <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                  Recargar
                </button>
                <button
                  onClick={exportData}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-2 text-sm whitespace-nowrap"
                >
                  <Download className="w-5 h-5" />
                  Exportar
                </button>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 text-sm whitespace-nowrap"
                >
                  <Plus className="w-5 h-5" />
                  Agregar Item
                </button>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="bg-white rounded-xl shadow-lg mb-6">
           <div className="flex border-b overflow-x-auto whitespace-nowrap">
              {[
                { id: 'equipment', label: 'Equipo Básico', icon: '🔧' },
                { id: 'materials', label: 'Material Resurtible', icon: '📦' },
                { id: 'formulas', label: 'Fórmulas de Uso', icon: '🧪' },
                { id: 'purchases', label: 'Historial Compras', icon: '🛒' },
                { id: 'analytics', label: 'Análisis', icon: '📊' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`flex-none shrink-0 px-4 py-3 flex items-center justify-center gap-2 transition-colors
                    ${activeTab === tab.id 
                      ? 'bg-green-50 text-green-700 border-b-2 border-green-600' 
                      : 'hover:bg-gray-50'}`}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Alertas */}
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-[140px]">
                <span className="text-2xl">🔴</span>
                <span className="font-semibold">{stats.criticalItems}</span>
                <span className="text-gray-600">items críticos</span>
              </div>
              <div className="flex items-center gap-2 min-w-[140px]">
                <span className="text-2xl">🟠</span>
                <span className="font-semibold">{stats.lowItems}</span>
                <span className="text-gray-600">items bajos</span>
              </div>
              <div className="flex items-center gap-2 min-w-[140px]">
                <span className="text-2xl">💰</span>
                <span className="font-semibold">${stats.totalValue.toLocaleString()}</span>
                <span className="text-gray-600">valor total</span>
              </div>
              <div className="flex items-center gap-2 min-w-[140px]">
                <span className="text-2xl">📈</span>
                <span className="font-semibold">{stats.optimalStock}%</span>
                <span className="text-gray-600">stock óptimo</span>
              </div>
            </div>
          </div>

          {/* Filtros */}
          {(activeTab === 'equipment' || activeTab === 'materials') && (
            <div className="bg-white rounded-xl shadow-lg p-4 mb-6">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Buscar por nombre o SKU..."
                    className="w-full pl-10 pr-4 py-3 border rounded-lg"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <select
                  className="w-full sm:w-auto px-4 py-3 border rounded-lg"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                >
                  <option value="">Todas las categorías</option>
                  <option value="instrumental">Instrumental</option>
                  <option value="desechable">Desechables</option>
                  <option value="anestesia">Anestesia</option>
                  <option value="resina">Resinas</option>
                  <option value="endodoncia">Endodoncia</option>
                </select>
                <select
                  className="w-full sm:w-auto px-4 py-3 border rounded-lg"
                  value={stockFilter}
                  onChange={(e) => setStockFilter(e.target.value as StockStatus | '')}
                >
                  <option value="">Todo el stock</option>
                  <option value="critical">🔴 Crítico</option>
                  <option value="low">🟠 Bajo</option>
                  <option value="medium">🟡 Medio</option>
                  <option value="good">🟢 Óptimo</option>
                </select>
              </div>
            </div>
          )}

          {/* Contenido principal */}
          <div className="bg-white rounded-xl shadow-lg p-6">
            {loading ? (
              <div className="text-center py-12">
                <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-4 text-green-600" />
                <p className="text-gray-600">Cargando inventario...</p>
              </div>
            ) : (activeTab === 'equipment' || activeTab === 'materials') && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="p-3 text-left">SKU</th>
                      <th className="p-3 text-left">Producto</th>
                      <th className="p-3 text-left">Categoría</th>
                      <th className="p-3 text-left">Stock</th>
                      <th className="p-3 text-left">Estado</th>
                      <th className="p-3 text-left">Precio</th>
                      <th className="p-3 text-left">Valor Total</th>
                      <th className="p-3 text-left">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventory.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-gray-500">
                          <Package className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                          <p>No hay items en esta categoría</p>
                          <button
                            onClick={() => setShowAddModal(true)}
                            className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg"
                          >
                            Agregar Primer Item
                          </button>
                        </td>
                      </tr>
                    ) : (
                      filteredInventory.map(item => {
                        const status = getStockStatus(item);
                        const totalValue = item.quantity * item.price;
                        
                        return (
                          <tr key={item.id} className="border-b hover:bg-gray-50">
                            <td className="p-3 font-mono text-sm">{item.sku}</td>
                            <td className="p-3">
                              <div>
                                <div className="font-semibold">{item.name}</div>
                                {item.expirationDate && (
                                  <div className="text-xs text-gray-500">
                                    Vence: {item.expirationDate}
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-1 bg-gray-100 rounded text-xs">
                                {item.category}
                              </span>
                            </td>
                            <td className="p-3">
                              <div className="flex items-center gap-2 min-w-[140px]">
                                <span className="font-bold">{item.quantity}</span>
                                <span className="text-gray-500">/ {item.maxStock}</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                                <div
                                  className={`h-2 rounded-full ${
                                    status === 'critical' ? 'bg-red-500' :
                                    status === 'low' ? 'bg-orange-500' :
                                    status === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                                  }`}
                                  style={{ width: `${Math.min(100, (item.quantity / item.maxStock) * 100)}%` }}
                                />
                              </div>
                            </td>
                            <td className="p-3">
                              <span className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1 w-fit
                                ${getStockColor(status)}`}>
                                {getStockIcon(status)} {status}
                              </span>
                            </td>
                            <td className="p-3">${item.price.toLocaleString()}</td>
                            <td className="p-3 font-semibold">${totalValue.toLocaleString()}</td>
                            <td className="p-3">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setEditingItem(item);
                                    setShowAddModal(true);
                                  }}
                                  className="p-1 hover:bg-blue-100 rounded"
                                  title="Editar"
                                >
                                  <Edit className="w-4 h-4 text-blue-600" />
                                </button>
                                <button
                                  onClick={() => {
                                    const quantity = window.prompt('¿Cuántas unidades usar?', '1');
                                    if (quantity) handleUseItem(item, parseInt(quantity));
                                  }}
                                  className="p-1 hover:bg-green-100 rounded"
                                  title="Usar material"
                                >
                                  <Package className="w-4 h-4 text-green-600" />
                                </button>
                                <button
                                  onClick={() => handleDeleteItem(item.id)}
                                  className="p-1 hover:bg-red-100 rounded"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-4 h-4 text-red-600" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Fórmulas */}
            {activeTab === 'formulas' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(treatmentFormulas).map(([treatment, items]) => (
                  <div key={treatment} className="border rounded-lg p-4">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="font-semibold text-lg">{treatment}</h3>
                      <button
                        onClick={() => {
                          if (window.confirm(`¿Aplicar fórmula para ${treatment}?`)) {
                            handleApplyFormula(treatment);
                          }
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm"
                      >
                        Aplicar
                      </button>
                    </div>
                    <div className="space-y-2">
                      {items.map((item, idx) => (
                        <div key={idx} className="flex justify-between text-sm">
                          <span>{item.item}</span>
                          <span className="font-semibold">{item.quantity} unidades</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Historial de Compras */}
            {activeTab === 'purchases' && (
              <div className="space-y-4">
                {purchases.map(purchase => (
                  <div key={purchase.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{purchase.supplier}</h3>
                        <p className="text-gray-600">{purchase.date}</p>
                        <div className="mt-2">
                          {purchase.items.map((item, idx) => (
                            <span key={idx} className="inline-block mr-2 mb-1 px-2 py-1 bg-gray-100 rounded text-sm">
                              {item.name} (x{item.quantity})
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold">${purchase.total.toLocaleString()}</div>
                        <span className={`px-2 py-1 rounded text-xs font-semibold
                          ${purchase.status === 'recibido' ? 'bg-green-100 text-green-800' :
                            purchase.status === 'pendiente' ? 'bg-yellow-100 text-yellow-800' :
                            'bg-red-100 text-red-800'}`}>
                          {purchase.status}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Análisis */}
            {activeTab === 'analytics' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">Items por Categoría</h3>
                  <div className="space-y-2">
                    {['instrumental', 'desechable', 'anestesia', 'resina', 'endodoncia'].map(cat => {
                      const count = inventory.filter(i => i.category === cat).length;
                      return (
                        <div key={cat} className="flex justify-between">
                          <span className="capitalize">{cat}</span>
                          <span className="font-semibold">{count} items</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                <div className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">Items Críticos</h3>
                  <div className="space-y-2">
                    {inventory
                      .filter(i => getStockStatus(i) === 'critical')
                      .slice(0, 5)
                      .map(item => (
                        <div key={item.id} className="flex justify-between">
                          <span className="text-sm">{item.name}</span>
                          <span className="text-red-600 font-semibold">{item.quantity} left</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">Valor por Categoría</h3>
                  <div className="space-y-2">
                    {['instrumental', 'desechable', 'anestesia'].map(cat => {
                      const value = inventory
                        .filter(i => i.category === cat)
                        .reduce((sum, i) => sum + (i.quantity * i.price), 0);
                      return (
                        <div key={cat} className="flex justify-between">
                          <span className="capitalize">{cat}</span>
                          <span className="font-semibold">${value.toLocaleString()}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-3">Próximos a Vencer</h3>
                  <div className="space-y-2">
                    {inventory
                      .filter(i => i.expirationDate)
                      .sort((a, b) => (a.expirationDate || '').localeCompare(b.expirationDate || ''))
                      .slice(0, 5)
                      .map(item => (
                        <div key={item.id} className="flex justify-between">
                          <span className="text-sm">{item.name}</span>
                          <span className="text-orange-600 text-xs">{item.expirationDate}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal de Agregar/Editar Item */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-[10001]">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-auto">
            <div className="p-6 border-b">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">
                  {editingItem ? 'Editar Item' : 'Agregar Nuevo Item'}
                </h2>
                <button
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingItem(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleSaveItem({
                sku: formData.get('sku') as string,
                name: formData.get('name') as string,
                category: formData.get('category') as InventoryItem['category'],
                type: formData.get('type') as InventoryItem['type'],
                quantity: parseInt(formData.get('quantity') as string),
                minStock: parseInt(formData.get('minStock') as string),
                maxStock: parseInt(formData.get('maxStock') as string),
                price: parseFloat(formData.get('price') as string),
                supplier: formData.get('supplier') as string,
                usagePerPatient: parseFloat(formData.get('usagePerPatient') as string),
                expirationDate: formData.get('expirationDate') as string
              });
            }} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">SKU</label>
                  <input
                    name="sku"
                    type="text"
                    required
                    defaultValue={editingItem?.sku}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nombre del Producto</label>
                  <input
                    name="name"
                    type="text"
                    required
                    defaultValue={editingItem?.name}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Categoría</label>
                  <select
                    name="category"
                    required
                    defaultValue={editingItem?.category || 'desechable'}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="instrumental">Instrumental</option>
                    <option value="desechable">Desechables</option>
                    <option value="anestesia">Anestesia</option>
                    <option value="resina">Resinas</option>
                    <option value="endodoncia">Endodoncia</option>
                    <option value="ortodoncia">Ortodoncia</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Tipo</label>
                  <select
                    name="type"
                    required
                    defaultValue={editingItem?.type || 'material'}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="equipment">Equipo</option>
                    <option value="material">Material</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Cantidad Actual</label>
                  <input
                    name="quantity"
                    type="number"
                    required
                    min="0"
                    defaultValue={editingItem?.quantity || 0}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Stock Mínimo</label>
                  <input
                    name="minStock"
                    type="number"
                    required
                    min="0"
                    defaultValue={editingItem?.minStock || 10}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Stock Máximo</label>
                  <input
                    name="maxStock"
                    type="number"
                    required
                    min="0"
                    defaultValue={editingItem?.maxStock || 50}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Precio Unitario</label>
                  <input
                    name="price"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    defaultValue={editingItem?.price || 0}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Proveedor</label>
                  <input
                    name="supplier"
                    type="text"
                    required
                    defaultValue={editingItem?.supplier}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Uso por Paciente</label>
                  <input
                    name="usagePerPatient"
                    type="number"
                    required
                    min="0"
                    step="0.1"
                    defaultValue={editingItem?.usagePerPatient || 1}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Fecha de Vencimiento</label>
                  <input
                    name="expirationDate"
                    type="date"
                    defaultValue={editingItem?.expirationDate}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setEditingItem(null);
                  }}
                  className="px-6 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg"
                >
                  {editingItem ? 'Actualizar' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
