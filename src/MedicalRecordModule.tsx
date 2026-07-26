// MedicalRecordModule.tsx - Módulo Completo de Expediente Médico Dental
import React, { useState, useEffect, useRef } from 'react';
import { 
   FileText, X, Plus, Save, Edit, Trash2, Calendar, User, Phone, Mail, 
  MapPin, Heart, AlertTriangle, Pill, Activity, FileImage, Camera, 
  Download, Upload, Printer, Eye, CheckCircle, XCircle, Clock,
  Stethoscope, Clipboard, FileCheck, Image, Zap, Shield, Star,
  Search, Filter, RotateCcw, ZoomIn, ZoomOut, Grid, List, ClipboardCheck
} from 'lucide-react';

// ==================== TIPOS DE DATOS ====================

interface ExpedienteMedico {
  id?: string;
  paciente_id: string;
  nombre_paciente: string;
  telefono?: string;
  email?: string;
  fecha_nacimiento?: string;
  edad?: number;
  genero?: 'masculino' | 'femenino' | 'otro';
  direccion?: string;
  ocupacion?: string;
  estado_civil?: string;
  contacto_emergencia?: string;
  telefono_emergencia?: string;
  sucursal_id: string;
  created_at?: string;
  updated_at?: string;
}

interface HistoriaClinicaDental {
  id?: string;
  expediente_id: string;
  motivo_consulta: string;
  enfermedad_actual: string;
  antecedentes_personales: string;
  antecedentes_familiares: string;
  antecedentes_odontologicos: string;
  habitos_nocivos: string;
  alergias: string;
  medicamentos_actuales: string;
  examen_extraoral: string;
  examen_intraoral: string;
  diagnostico_presuntivo: string;
  plan_tratamiento: string;
  observaciones: string;
  doctor_id: string;
  fecha_registro: string;
  sucursal_id: string;
}

interface Odontograma {
  id?: string;
  expediente_id: string;
  diente_numero: number;
  estado: 'sano' | 'cariado' | 'obturado' | 'extraido' | 'endodoncia' | 'corona' | 'implante' | 'protesis';
  superficie?: string; // oclusal, mesial, distal, vestibular, lingual
  observaciones?: string;
  fecha_registro: string;
  doctor_id: string;
  sucursal_id: string;
}

interface ConsentimientoInformado {
  id?: string;
  expediente_id: string;
  tipo_tratamiento: string;
  descripcion_tratamiento: string;
  riesgos_beneficios: string;
  alternativas: string;
  costo_estimado?: number;
  fecha_consentimiento: string;
  firma_paciente: boolean;
  firma_doctor: boolean;
  testigo_nombre?: string;
  testigo_identificacion?: string;
  doctor_id: string;
  sucursal_id: string;
}

interface TratamientoDental {
  id?: string;
  expediente_id: string;
  fecha: string;
  diente_numero?: number;
  procedimiento: string;
  descripcion: string;
  materiales_usados?: string;
  duracion_minutos?: number;
  costo?: number;
  estado: 'planificado' | 'en_progreso' | 'completado' | 'cancelado';
  observaciones?: string;
  doctor_id: string;
  sucursal_id: string;
}

interface DocumentoRadiografia {
  id?: string;
  expediente_id: string;
  tipo: 'radiografia' | 'fotografia' | 'documento' | 'laboratorio';
  nombre: string;
  descripcion?: string;
  fecha_toma: string;
  datos_base64?: string;
  url?: string;
  doctor_id: string;
  sucursal_id: string;
}

// ==================== COMPONENTE PRINCIPAL ====================

interface MedicalRecordModuleProps {
  patientName: string;
  patientPhone?: string;
  appointmentId?: number;
  isOpen: boolean;
  onClose: () => void;
  doctors: Array<{ id: string; name: string; color?: string }>;
  apiRequest?: (endpoint: string, options?: any) => Promise<any>;
  sucursalId: string;
}

export function MedicalRecordModule({
  patientName,
  patientPhone,
  appointmentId,
  isOpen,
  onClose,
  doctors,
  apiRequest: externalApiRequest,
  sucursalId
}: MedicalRecordModuleProps) {
  
  // ==================== ESTADOS ====================
  
  const [activeTab, setActiveTab] = useState<'datos' | 'historia' | 'odontograma' | 'tratamientos' | 'consentimientos' | 'radiografias'>('datos');
  const [loading, setLoading] = useState(false);
  const [expediente, setExpediente] = useState<ExpedienteMedico | null>(null);
  const [historiaClinica, setHistoriaClinica] = useState<HistoriaClinicaDental | null>(null);
  const [odontograma, setOdontograma] = useState<Odontograma[]>([]);
  const [tratamientos, setTratamientos] = useState<TratamientoDental[]>([]);
  const [consentimientos, setConsentimientos] = useState<ConsentimientoInformado[]>([]);
  const [radiografias, setRadiografias] = useState<DocumentoRadiografia[]>([]);

  // Estados de edición
  const [editingDatos, setEditingDatos] = useState(false);
  const [editingHistoria, setEditingHistoria] = useState(false);
  const [selectedTooth, setSelectedTooth] = useState<number | null>(null);
  const [toothState, setToothState] = useState<Odontograma['estado']>('sano');
  const [showConsentimientoForm, setShowConsentimientoForm] = useState(false);
  const [showTratamientoForm, setShowTratamientoForm] = useState(false);
  
  // Estados de formularios
  const [nuevoTratamiento, setNuevoTratamiento] = useState<Partial<TratamientoDental>>({});
  const [nuevoConsentimiento, setNuevoConsentimiento] = useState<Partial<ConsentimientoInformado>>({});
// Estados para impresión
const [showPrintModal, setShowPrintModal] = useState(false);
const [printType, setPrintType] = useState<'complete' | 'consentimiento'>('complete');
const [selectedConsentimientoForPrint, setSelectedConsentimientoForPrint] = useState<ConsentimientoInformado | null>(null);

  // ==================== API REQUEST LOCAL ====================
  // Esta función se usará si no te pasan apiRequest como prop desde App.tsx
  async function apiRequest(
    endpoint: string,
    options: {
      method?: string;
      body?: any;
      sucursalId?: string;
    } = {}
  ) {
    const { method = 'GET', body, sucursalId: sucursalCustom } = options;

    // el backend bueno en Render
    const API_BASE = "http://localhost:4001";

    const url =
      `${API_BASE}/api` +
      (endpoint.startsWith('/') ? endpoint : `/${endpoint}`) +
      ((sucursalCustom || sucursalId)
        ? `?sucursal=${encodeURIComponent(sucursalCustom || sucursalId)}`
        : '');

    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${data?.error || 'Error inesperado'}`);
    }

    return data;
  }

  // preferimos el apiRequest que venga como prop, si existe
  const useApi = externalApiRequest || apiRequest;

  // ==================== GUARDAR DATOS DEL PACIENTE ====================
  const guardarDatosPaciente = async () => {
    if (!expediente) return;

    const payload = {
      nombre_paciente: expediente.nombre_paciente || '',
      telefono: expediente.telefono || '',
      email: expediente.email || '',
      fecha_nacimiento: expediente.fecha_nacimiento || null,
      edad: expediente.edad || null,
      genero: expediente.genero || null,
      direccion: expediente.direccion || '',
      ocupacion: expediente.ocupacion || '',
      estado_civil: expediente.estado_civil || '',
      contacto_emergencia: expediente.contacto_emergencia || '',
      telefono_emergencia: expediente.telefono_emergencia || ''
    };

    try {
      setLoading(true);
      const response = await useApi(`/expediente-medico/${expediente.id}`, {
        method: 'PUT',
        body: payload,
        sucursalId
      });
      
      setExpediente(response);
      setEditingDatos(false);
      console.log('✅ Datos del paciente actualizados correctamente');
    } catch (error) {
      console.error('Error guardando datos del paciente:', error);
      alert('Error al guardar los datos del paciente');
    } finally {
      setLoading(false);
    }
  };

  // ==================== GUARDAR HISTORIA CLÍNICA ====================
  const guardarHistoriaClinica = async () => {
    if (!expediente || !historiaClinica) return;

    const metodo = historiaClinica.id ? 'PUT' : 'POST';
    const endpoint = historiaClinica.id
      ? `/historia-clinica-dental/${historiaClinica.id}`
      : '/historia-clinica-dental';

    // payload completo basado en HistoriaClinicaDental
    const payload = {
      expediente_id: expediente.id,
      sucursal_id: sucursalId,
      fecha_registro:
        historiaClinica.fecha_registro ||
        new Date().toISOString().split('T')[0],
      motivo_consulta: historiaClinica.motivo_consulta || '',
      enfermedad_actual: historiaClinica.enfermedad_actual || '',
      antecedentes_personales: historiaClinica.antecedentes_personales || '',
      antecedentes_familiares: historiaClinica.antecedentes_familiares || '',
      antecedentes_odontologicos: historiaClinica.antecedentes_odontologicos || '',
      habitos_nocivos: historiaClinica.habitos_nocivos || '',
      alergias: historiaClinica.alergias || '',
      medicamentos_actuales: historiaClinica.medicamentos_actuales || '',
      examen_extraoral: historiaClinica.examen_extraoral || '',
      examen_intraoral: historiaClinica.examen_intraoral || '',
      diagnostico_presuntivo: historiaClinica.diagnostico_presuntivo || '',
      plan_tratamiento: historiaClinica.plan_tratamiento || '',
      observaciones: historiaClinica.observaciones || '',
      doctor_id: historiaClinica.doctor_id || (doctors[0]?.id || '')
    };

    try {
      setLoading(true);
      const response = await useApi(endpoint, {
        method: metodo,
        body: payload,
        sucursalId
      });

      setHistoriaClinica(response);
      setEditingHistoria(false);
      console.log('✅ Historia clínica guardada correctamente');
    } catch (err) {
      console.error('❌ Error guardando historia clínica:', err);
      alert('Error al guardar la historia clínica');
    } finally {
      setLoading(false);
    }
  };

  // ==================== EFECTOS ====================
  
  useEffect(() => {
    if (isOpen && patientName) {
      cargarExpedienteMedico();
    }
  }, [isOpen, patientName]);

  // ==================== FUNCIONES DE API ====================
  
  const cargarExpedienteMedico = async () => {
    setLoading(true);
    try {
      const response = await useApi(`/expediente-medico/paciente/${encodeURIComponent(patientName)}`, {
        method: 'GET',
        sucursalId
      });

      if (response) {
        setExpediente(response.expediente);
        setHistoriaClinica(response.historia_clinica);
        setOdontograma(response.odontograma || []);
        setTratamientos(response.tratamientos || []);
        setConsentimientos(response.consentimientos || []);
        setRadiografias(response.radiografias || []);
      }
    } catch (error) {
      console.error('Error cargando expediente médico:', error);
      await crearNuevoExpediente();
    } finally {
      setLoading(false);
    }
  };

  const crearNuevoExpediente = async () => {
    try {
      const nuevoExpediente: Partial<ExpedienteMedico> = {
        paciente_id: `paciente_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        nombre_paciente: patientName,
        telefono: patientPhone || '',
        sucursal_id: sucursalId
      };

      const response = await useApi('/expediente-medico', {
        method: 'POST',
        body: nuevoExpediente,
        sucursalId
      });

      setExpediente(response);
      setHistoriaClinica(null);
      setOdontograma([]);
      setTratamientos([]);
      setConsentimientos([]);
      setRadiografias([]);
    } catch (error) {
      console.error('Error creando expediente médico:', error);
    }
  };

  const actualizarDiente = async (numeroTiente: number, estado: Odontograma['estado'], superficie?: string) => {
    if (!expediente) return;

    try {
      const dienteExistente = odontograma.find(d => d.diente_numero === numeroTiente);
      
      const payload: Partial<Odontograma> = {
        expediente_id: expediente.id,
        diente_numero: numeroTiente,
        estado,
        superficie,
        fecha_registro: new Date().toISOString().split('T')[0],
        doctor_id: doctors[0]?.id || '',
        sucursal_id: sucursalId
      };

      if (dienteExistente) {
        const response = await useApi(`/odontograma/${dienteExistente.id}`, {
          method: 'PUT',
          body: { ...payload, id: dienteExistente.id },
          sucursalId
        });
        
        setOdontograma(prev => prev.map(d => d.id === dienteExistente.id ? response : d));
      } else {
        const response = await useApi('/odontograma', {
          method: 'POST',
          body: payload,
          sucursalId
        });
        
        setOdontograma(prev => [...prev, response]);
      }
    } catch (error) {
      console.error('Error actualizando diente:', error);
      alert('Error al actualizar el diente');
    }
  };

  const agregarTratamiento = async () => {
    if (!expediente || !nuevoTratamiento.procedimiento) return;

    try {
      setLoading(true);
      const payload: Partial<TratamientoDental> = {
        ...nuevoTratamiento,
        expediente_id: expediente.id,
        fecha: nuevoTratamiento.fecha || new Date().toISOString().split('T')[0],
        estado: nuevoTratamiento.estado || 'planificado',
        doctor_id: nuevoTratamiento.doctor_id || doctors[0]?.id || '',
        sucursal_id: sucursalId
      };

      const response = await useApi('/tratamiento-dental', {
        method: 'POST',
        body: payload,
        sucursalId
      });

      setTratamientos(prev => [response, ...prev]);
      setNuevoTratamiento({});
      setShowTratamientoForm(false);
    } catch (error) {
      console.error('Error agregando tratamiento:', error);
      alert('Error al agregar el tratamiento');
    } finally {
      setLoading(false);
    }
  };

  const agregarConsentimiento = async () => {
    if (!expediente || !nuevoConsentimiento.tipo_tratamiento) return;

    try {
      setLoading(true);
      const payload: Partial<ConsentimientoInformado> = {
        ...nuevoConsentimiento,
        expediente_id: expediente.id,
        fecha_consentimiento: nuevoConsentimiento.fecha_consentimiento || new Date().toISOString().split('T')[0],
        firma_paciente: false,
        firma_doctor: false,
        doctor_id: nuevoConsentimiento.doctor_id || doctors[0]?.id || '',
        sucursal_id: sucursalId
      };

      const response = await useApi('/consentimiento-informado', {
        method: 'POST',
        body: payload,
        sucursalId
      });

      setConsentimientos(prev => [response, ...prev]);
      setNuevoConsentimiento({});
      setShowConsentimientoForm(false);
    } catch (error) {
      console.error('Error agregando consentimiento:', error);
      alert('Error al agregar el consentimiento informado');
    } finally {
      setLoading(false);
    }
  };

  const subirRadiografia = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !expediente) return;

    if (file.size > 10 * 1024 * 1024) {
      alert('El archivo es demasiado grande. Máximo 10MB.');
      return;
    }

    try {
      setLoading(true);
      
      const reader = new FileReader();
      reader.onload = async (e) => {
        const datos_base64 = e.target?.result as string;
        
        const payload: Partial<DocumentoRadiografia> = {
          expediente_id: expediente.id,
          tipo: file.type.startsWith('image/') ? 'radiografia' : 'documento',
          nombre: file.name,
          descripcion: '',
          fecha_toma: new Date().toISOString().split('T')[0],
          datos_base64,
          doctor_id: doctors[0]?.id || '',
          sucursal_id: sucursalId
        };

        try {
          const response = await useApi('/documento-radiografia', {
            method: 'POST',
            body: payload,
            sucursalId
          });
          
          setRadiografias(prev => [response, ...prev]);
        } catch (error) {
          console.error('Error subiendo archivo:', error);
          alert('Error al subir el archivo');
        } finally {
          setLoading(false);
        }
      };
      
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error procesando archivo:', error);
      setLoading(false);
    }
  };

// ==================== FUNCIONES DE IMPRESIÓN ====================
const openPrintComplete = () => {
  // Crear ventana nueva con contenido limpio
  const printWindow = window.open('', '_blank');
  const content = `
    <html>
      <head>
        <title>Expediente Médico - ${expediente?.nombre_paciente}</title>
        <style>
          body { font-family: Arial; font-size: 12px; margin: 0; padding: 20px; }
          h1 { text-align: center; font-size: 24px; margin-bottom: 5px; }
          h2 { text-align: center; font-size: 18px; margin-bottom: 20px; }
          h3 { font-size: 16px; border-bottom: 1px solid #000; padding-bottom: 5px; margin-top: 20px; }
          .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0; }
          .full-width { grid-column: span 2; }
          .section { border: 1px solid #ccc; padding: 15px; margin-bottom: 15px; }
          .odonto-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 5px; text-align: center; margin: 10px 0; }
         .diente { width: 30px; height: 30px; border: 1px solid #000; display: inline-block; text-align: center; line-height: 30px; margin: 2px; color: white; font-weight: bold; font-size: 10px; }
.diente.sano { background-color: #22c55e !important; }
.diente.cariado { background-color: #ef4444 !important; }
.diente.obturado { background-color: #3b82f6 !important; }
.diente.extraido { background-color: #6b7280 !important; }
.diente.endodoncia { background-color: #8b5cf6 !important; }
.diente.corona { background-color: #f59e0b !important; }
.diente.implante { background-color: #06b6d4 !important; }
.diente.protesis { background-color: #ec4899 !important; }
          p { margin: 5px 0; }
        </style>
      </head>
      <body>
        <h1>Clínica Dental</h1>
        <p style="text-align: center;">Dirección de la clínica • Teléfono de la clínica</p>
        <h2>EXPEDIENTE MÉDICO DENTAL</h2>
        
        <div class="section">
          <h3>Información del Paciente</h3>
          <div class="info-grid">
            <p><strong>Nombre:</strong> ${expediente?.nombre_paciente || ''}</p>
            <p><strong>Teléfono:</strong> ${expediente?.telefono || ''}</p>
            <p><strong>Email:</strong> ${expediente?.email || ''}</p>
            <p><strong>Edad:</strong> ${expediente?.edad || ''} años</p>
            <p><strong>Género:</strong> ${expediente?.genero || ''}</p>
            <p><strong>Estado Civil:</strong> ${expediente?.estado_civil || ''}</p>
            <p class="full-width"><strong>Dirección:</strong> ${expediente?.direccion || ''}</p>
          </div>
        </div>
        
        ${historiaClinica ? `
        <div class="section">
          <h3>Historia Clínica</h3>
          <p><strong>Motivo de Consulta:</strong> ${historiaClinica.motivo_consulta}</p>
          <p><strong>Diagnóstico:</strong> ${historiaClinica.diagnostico_presuntivo}</p>
          <p><strong>Plan de Tratamiento:</strong> ${historiaClinica.plan_tratamiento}</p>
        </div>
        ` : ''}
        
       ${odontograma.length > 0 ? `
        <div class="section">
          <h3>Odontograma</h3>
          <p><strong>Dientes Superiores:</strong></p>
          <div style="display: flex; justify-content: center; gap: 2px; margin: 10px 0;">
            ${[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28].map(numero => {
              const diente = odontograma.find(d => d.diente_numero === numero);
              const estado = diente?.estado || 'sano';
              return `<span class="diente ${estado}">${numero}</span>`;
            }).join('')}
          </div>
          <p><strong>Dientes Inferiores:</strong></p>
          <div style="display: flex; justify-content: center; gap: 2px; margin: 10px 0;">
            ${[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38].map(numero => {
              const diente = odontograma.find(d => d.diente_numero === numero);
              const estado = diente?.estado || 'sano';
              return `<span class="diente ${estado}">${numero}</span>`;
            }).join('')}
          </div>
          <p><strong>Leyenda:</strong> 
            <span class="diente sano" style="display: inline-block; margin: 0 5px;">S</span>Sano
            <span class="diente cariado" style="display: inline-block; margin: 0 5px;">C</span>Cariado
            <span class="diente obturado" style="display: inline-block; margin: 0 5px;">O</span>Obturado
            <span class="diente extraido" style="display: inline-block; margin: 0 5px;">E</span>Extraído
            <span class="diente endodoncia" style="display: inline-block; margin: 0 5px;">En</span>Endodoncia
            <span class="diente corona" style="display: inline-block; margin: 0 5px;">Co</span>Corona
          </p>
        </div>
        ` : ''}
        
        ${tratamientos.length > 0 ? `
        <div class="section">
          <h3>Tratamientos</h3>
          ${tratamientos.map(t => `
            <p><strong>${t.procedimiento}</strong> - ${new Date(t.fecha).toLocaleDateString()}</p>
            <p>${t.descripcion}</p>
            ${t.diente_numero ? `<p>Diente #${t.diente_numero}</p>` : ''}
          `).join('')}
        </div>
        ` : ''}
        
        ${consentimientos.length > 0 ? `
        <div class="section">
          <h3>Consentimientos Informados</h3>
          ${consentimientos.map(c => `
            <div style="margin-bottom: 15px; border: 1px solid #ddd; padding: 10px;">
              <p><strong>Tratamiento:</strong> ${c.tipo_tratamiento}</p>
              <p><strong>Fecha:</strong> ${new Date(c.fecha_consentimiento).toLocaleDateString()}</p>
              <p><strong>Descripción:</strong> ${c.descripcion_tratamiento}</p>
              ${c.costo_estimado ? `<p><strong>Costo:</strong> $${c.costo_estimado.toLocaleString()}</p>` : ''}
              <p><strong>Firma Paciente:</strong> ${c.firma_paciente ? 'Sí' : 'No'} | <strong>Firma Doctor:</strong> ${c.firma_doctor ? 'Sí' : 'No'}</p>
            </div>
          `).join('')}
        </div>
        ` : ''}
        
        <p style="text-align: center; margin-top: 40px; font-size: 10px;">
          Expediente generado el ${new Date().toLocaleString()}
        </p>
      </body>
    </html>
  `; 
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.print();
  printWindow.close();
};

const openPrintConsentimiento = (consentimiento: ConsentimientoInformado) => {
  // Similar pero solo para consentimiento
  const printWindow = window.open('', '_blank');
  const content = `
    <html>
      <head>
        <title>Consentimiento - ${expediente?.nombre_paciente}</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          .section { margin-bottom: 20px; border: 1px solid #ccc; padding: 15px; }
        </style>
      </head>
      <body>
        <div style="text-align: center; margin-bottom: 30px;">
          <h1>Clínica Dental</h1>
          <h2>CONSENTIMIENTO INFORMADO</h2>
        </div>
        
        <div class="section">
          <h3>Información del Paciente</h3>
          <p><strong>Nombre:</strong> ${expediente?.nombre_paciente}</p>
        </div>
        
        <div class="section">
          <h3>Consentimiento</h3>
          <p><strong>Tratamiento:</strong> ${consentimiento.tipo_tratamiento}</p>
          <p><strong>Descripción:</strong> ${consentimiento.descripcion_tratamiento}</p>
        </div>
      </body>
    </html>
  `;
  
  printWindow.document.write(content);
  printWindow.document.close();
  printWindow.print();
  printWindow.close();
};

  // ==================== COMPONENTES DE UI ====================

  const DienteComponent = ({ numero }: { numero: number }) => {
    const diente = odontograma.find(d => d.diente_numero === numero);
    const estado = diente?.estado || 'sano';
    
    const colores = {
      sano: '#22c55e',      // Verde
      cariado: '#ef4444',   // Rojo
      obturado: '#3b82f6', // Azul
      extraido: '#6b7280', // Gris
      endodoncia: '#8b5cf6', // Morado
      corona: '#f59e0b',    // Amarillo
      implante: '#06b6d4',  // Cyan
      protesis: '#ec4899'   // Rosa
    };

    return (
      <div 
        className={`relative w-8 h-10 cursor-pointer transition-all duration-200 ${
          selectedTooth === numero ? 'scale-110 z-10' : ''
        }`}
        onClick={() => setSelectedTooth(numero)}
        title={`Diente ${numero} - ${estado}`}
      >
        <div 
          className="w-full h-full rounded-lg border-2 border-gray-300 flex items-center justify-center text-xs font-bold text-white shadow-sm hover:shadow-md transition-shadow"
          style={{ backgroundColor: colores[estado] }}
        >
          {numero}
        </div>
        {diente && (
          <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-600 rounded-full flex items-center justify-center">
            <div className="w-1.5 h-1.5 bg-white rounded-full"></div>
          </div>
        )}
      </div>
    );
  };

  const OdontogramaView = () => {
    // Dientes superiores (18-11, 21-28)
    const dientesSuperiores = [
      ...Array.from({length: 8}, (_, i) => 18 - i), // 18-11
      ...Array.from({length: 8}, (_, i) => 21 + i)  // 21-28
    ];
    
    // Dientes inferiores (48-41, 31-38)
    const dientesInferiores = [
      ...Array.from({length: 8}, (_, i) => 48 - i), // 48-41
      ...Array.from({length: 8}, (_, i) => 31 + i)  // 31-38
    ];

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-xl p-6 border">
          <h3 className="text-lg font-semibold mb-4">Odontograma Interactivo</h3>
          
          <div className="space-y-8">
            {/* Dientes Superiores */}
            <div>
              <div className="text-sm text-gray-600 mb-2 text-center">Arcada Superior</div>
              <div className="flex justify-center gap-1">
                {dientesSuperiores.map(numero => (
                  <DienteComponent key={numero} numero={numero} />
                ))}
              </div>
            </div>

            {/* Línea divisoria */}
            <div className="border-t-2 border-gray-300 mx-8"></div>

            {/* Dientes Inferiores */}
            <div>
              <div className="text-sm text-gray-600 mb-2 text-center">Arcada Inferior</div>
              <div className="flex justify-center gap-1">
                {dientesInferiores.map(numero => (
                  <DienteComponent key={numero} numero={numero} />
                ))}
              </div>
            </div>
          </div>

          {/* Panel de control de diente seleccionado */}
          {selectedTooth && (
            <div className="mt-6 p-4 bg-blue-50 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-3">
                Diente {selectedTooth} - Modificar Estado
              </h4>
              
              <div className="grid grid-cols-4 gap-2 mb-4">
                {Object.entries({
                  sano: 'Sano',
                  cariado: 'Cariado',
                  obturado: 'Obturado',
                  extraido: 'Extraído',
                  endodoncia: 'Endodoncia',
                  corona: 'Corona',
                  implante: 'Implante',
                  protesis: 'Prótesis'
                }).map(([estado, label]) => (
                  <button
                    key={estado}
                    onClick={() => setToothState(estado as Odontograma['estado'])}
                    className={`px-3 py-2 rounded-lg text-sm transition-colors ${
                      toothState === estado
                        ? 'bg-blue-600 text-white'
                        : 'bg-white border hover:bg-blue-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => actualizarDiente(selectedTooth, toothState)}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
                >
                  <Save className="w-4 h-4" />
                  Guardar Estado
                </button>
                
                <button
                  onClick={() => setSelectedTooth(null)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}

          {/* Leyenda */}
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="font-medium text-gray-900 mb-3">Leyenda de Estados</h4>
            <div className="grid grid-cols-4 gap-3 text-sm">
              {Object.entries({
                sano: { color: '#22c55e', label: 'Sano' },
                cariado: { color: '#ef4444', label: 'Cariado' },
                obturado: { color: '#3b82f6', label: 'Obturado' },
                extraido: { color: '#6b7280', label: 'Extraído' },
                endodoncia: { color: '#8b5cf6', label: 'Endodoncia' },
                corona: { color: '#f59e0b', label: 'Corona' },
                implante: { color: '#06b6d4', label: 'Implante' },
                protesis: { color: '#ec4899', label: 'Prótesis' }
              }).map(([estado, {color, label}]) => (
                <div key={estado} className="flex items-center gap-2">
                  <div 
                    className="w-4 h-4 rounded-full border border-gray-300"
                    style={{ backgroundColor: color }}
                  ></div>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-7xl w-full max-h-[95vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
                <Stethoscope className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Expediente Médico Dental</h2>
                <p className="text-gray-600">{patientName}</p>
                {expediente?.edad && (
                  <p className="text-sm text-gray-500">
                    {expediente.edad} años • {expediente.genero}
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white hover:bg-opacity-50 rounded-lg transition-colors"
            >
              <X className="w-6 h-6 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 py-3 border-b bg-gray-50">
          <div className="flex space-x-1 overflow-x-auto">
            {[
              { id: 'datos', label: 'Datos Personales', icon: User },
              { id: 'historia', label: 'Historia Clínica', icon: Clipboard },
              { id: 'odontograma', label: 'Odontograma', icon: Grid },
              { id: 'tratamientos', label: 'Tratamientos', icon: Activity },
              { id: 'consentimientos', label: 'Consentimientos', icon: FileCheck },
              { id: 'radiografias', label: 'Radiografías', icon: Image }
            ].map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-white hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full"></div>
            </div>
          )}

          {!loading && activeTab === 'datos' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Información Personal</h3>
                <button
                  onClick={() => setEditingDatos(!editingDatos)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <Edit className="w-4 h-4" />
                  {editingDatos ? 'Cancelar' : 'Editar'}
                </button>
              </div>

              {expediente && (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre Completo
                      </label>
                      <input
                        type="text"
                        value={expediente.nombre_paciente || ''}
                        onChange={(e) => setExpediente({...expediente, nombre_paciente: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Fecha de Nacimiento
                        </label>
                        <input
                          type="date"
                          value={expediente.fecha_nacimiento || ''}
                          onChange={(e) => {
                            const fechaNac = e.target.value;
                            const edad = fechaNac ? new Date().getFullYear() - new Date(fechaNac).getFullYear() : undefined;
                            setExpediente({...expediente, fecha_nacimiento: fechaNac, edad});
                          }}
                          disabled={!editingDatos}
                          className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Edad
                        </label>
                        <input
                          type="number"
                          value={expediente.edad || ''}
                          disabled
                          className="w-full px-3 py-2 border rounded-lg bg-gray-50"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Género
                      </label>
                      <select
                        value={expediente.genero || ''}
                        onChange={(e) => setExpediente({...expediente, genero: e.target.value as any})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      >
                        <option value="">Seleccionar</option>
                        <option value="masculino">Masculino</option>
                        <option value="femenino">Femenino</option>
                        <option value="otro">Otro</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Phone className="w-4 h-4 inline mr-1" />
                        Teléfono
                      </label>
                      <input
                        type="tel"
                        value={expediente.telefono || ''}
                        onChange={(e) => setExpediente({...expediente, telefono: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <Mail className="w-4 h-4 inline mr-1" />
                        Email
                      </label>
                      <input
                        type="email"
                        value={expediente.email || ''}
                        onChange={(e) => setExpediente({...expediente, email: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      />
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Estado Civil
                      </label>
                      <select
                        value={expediente.estado_civil || ''}
                        onChange={(e) => setExpediente({...expediente, estado_civil: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      >
                        <option value="">Seleccionar</option>
                        <option value="soltero">Soltero(a)</option>
                        <option value="casado">Casado(a)</option>
                        <option value="divorciado">Divorciado(a)</option>
                        <option value="viudo">Viudo(a)</option>
                        <option value="union_libre">Unión Libre</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Ocupación
                      </label>
                      <input
                        type="text"
                        value={expediente.ocupacion || ''}
                        onChange={(e) => setExpediente({...expediente, ocupacion: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        <MapPin className="w-4 h-4 inline mr-1" />
                        Dirección
                      </label>
                      <textarea
                        value={expediente.direccion || ''}
                        onChange={(e) => setExpediente({...expediente, direccion: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                        rows={2}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contacto de Emergencia
                      </label>
                      <input
                        type="text"
                        value={expediente.contacto_emergencia || ''}
                        onChange={(e) => setExpediente({...expediente, contacto_emergencia: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                        placeholder="Nombre del contacto"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Teléfono de Emergencia
                      </label>
                      <input
                        type="tel"
                        value={expediente.telefono_emergencia || ''}
                        onChange={(e) => setExpediente({...expediente, telefono_emergencia: e.target.value})}
                        disabled={!editingDatos}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      />
                    </div>
                  </div>
                </div>
              )}

              {editingDatos && (
                <div className="flex gap-3 pt-4 border-t">
                  <button
                    onClick={guardarDatosPaciente}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Guardar Cambios
                  </button>
                  <button
                    onClick={() => setEditingDatos(false)}
                    className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === 'historia' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Historia Clínica Dental</h3>
                <button
                  onClick={() => setEditingHistoria(!editingHistoria)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <Edit className="w-4 h-4" />
                  {editingHistoria ? 'Cancelar' : 'Editar'}
                </button>
              </div>

              <div className="grid gap-6">
                {/* Primera fila */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Motivo de Consulta
                    </label>
                    <textarea
                      value={historiaClinica?.motivo_consulta || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        motivo_consulta: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={3}
                      placeholder="Describe el motivo principal de la consulta..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Enfermedad Actual
                    </label>
                    <textarea
                      value={historiaClinica?.enfermedad_actual || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        enfermedad_actual: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={3}
                      placeholder="Describe la enfermedad actual..."
                    />
                  </div>
                </div>

                {/* Segunda fila */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Antecedentes Personales
                    </label>
                    <textarea
                      value={historiaClinica?.antecedentes_personales || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        antecedentes_personales: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={3}
                      placeholder="Enfermedades previas, cirugías, hospitalizaciones..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Antecedentes Familiares
                    </label>
                    <textarea
                      value={historiaClinica?.antecedentes_familiares || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        antecedentes_familiares: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={3}
                      placeholder="Enfermedades hereditarias, antecedentes familiares relevantes..."
                    />
                  </div>
                </div>

                {/* Tercera fila */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Antecedentes Odontológicos
                    </label>
                    <textarea
                      value={historiaClinica?.antecedentes_odontologicos || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        antecedentes_odontologicos: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={3}
                      placeholder="Tratamientos dentales previos, extracciones, ortodoncias..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Hábitos Nocivos
                    </label>
                    <textarea
                      value={historiaClinica?.habitos_nocivos || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        habitos_nocivos: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={3}
                      placeholder="Tabaquismo, alcoholismo, bruxismo, succión digital..."
                    />
                  </div>
                </div>

                {/* Cuarta fila */}
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <AlertTriangle className="w-4 h-4 inline mr-1 text-orange-500" />
                      Alergias
                    </label>
                    <textarea
                      value={historiaClinica?.alergias || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        alergias: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={2}
                      placeholder="Medicamentos, materiales dentales, alimentos..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      <Pill className="w-4 h-4 inline mr-1 text-blue-500" />
                      Medicamentos Actuales
                    </label>
                    <textarea
                      value={historiaClinica?.medicamentos_actuales || ''}
                      onChange={(e) => setHistoriaClinica(prev => ({
                        ...prev,
                        medicamentos_actuales: e.target.value
                      } as HistoriaClinicaDental))}
                      disabled={!editingHistoria}
                      className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                      rows={2}
                      placeholder="Lista de medicamentos que toma actualmente..."
                    />
                  </div>
                </div>

                {/* Examen clínico */}
                <div className="border-t pt-6">
                  <h4 className="text-lg font-medium text-gray-900 mb-4">Examen Clínico</h4>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Examen Extraoral
                      </label>
                      <textarea
                        value={historiaClinica?.examen_extraoral || ''}
                        onChange={(e) => setHistoriaClinica(prev => ({
                          ...prev,
                          examen_extraoral: e.target.value
                        } as HistoriaClinicaDental))}
                        disabled={!editingHistoria}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                        rows={4}
                        placeholder="Cara, cuello, ganglios linfáticos, ATM..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Examen Intraoral
                      </label>
                      <textarea
                        value={historiaClinica?.examen_intraoral || ''}
                        onChange={(e) => setHistoriaClinica(prev => ({
                          ...prev,
                          examen_intraoral: e.target.value
                        } as HistoriaClinicaDental))}
                        disabled={!editingHistoria}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                        rows={4}
                        placeholder="Labios, mejillas, lengua, paladar, encías, dientes..."
                      />
                    </div>
                  </div>
                </div>

                {/* Diagnóstico y plan */}
                <div className="border-t pt-6">
                  <h4 className="text-lg font-medium text-gray-900 mb-4">Diagnóstico y Plan de Tratamiento</h4>
                  
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Diagnóstico Presuntivo
                      </label>
                      <textarea
                        value={historiaClinica?.diagnostico_presuntivo || ''}
                        onChange={(e) => setHistoriaClinica(prev => ({
                          ...prev,
                          diagnostico_presuntivo: e.target.value
                        } as HistoriaClinicaDental))}
                        disabled={!editingHistoria}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                        rows={4}
                        placeholder="Diagnóstico principal y secundarios..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Plan de Tratamiento
                      </label>
                      <textarea
                        value={historiaClinica?.plan_tratamiento || ''}
                        onChange={(e) => setHistoriaClinica(prev => ({
                          ...prev,
                          plan_tratamiento: e.target.value
                        } as HistoriaClinicaDental))}
                        disabled={!editingHistoria}
                        className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                        rows={4}
                        placeholder="Tratamientos propuestos, secuencia, prioridades..."
                      />
                    </div>
                  </div>
                </div>

                {/* Observaciones */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Observaciones Generales
                  </label>
                  <textarea
                    value={historiaClinica?.observaciones || ''}
                    onChange={(e) => setHistoriaClinica(prev => ({
                      ...prev,
                      observaciones: e.target.value
                    } as HistoriaClinicaDental))}
                    disabled={!editingHistoria}
                    className="w-full px-3 py-2 border rounded-lg disabled:bg-gray-50"
                    rows={3}
                    placeholder="Cualquier observación adicional relevante..."
                  />
                </div>
              </div>

              {editingHistoria && (
                <div className="flex gap-3 pt-4 border-t">
                  <button
                    onClick={guardarHistoriaClinica}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    Guardar Historia Clínica
                  </button>
                  <button
                    onClick={() => setEditingHistoria(false)}
                    className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          )}

          {!loading && activeTab === 'odontograma' && <OdontogramaView />}

          {!loading && activeTab === 'tratamientos' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Plan de Tratamientos</h3>
                <button
                  onClick={() => setShowTratamientoForm(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Nuevo Tratamiento
                </button>
              </div>

              {showTratamientoForm && (
                <div className="bg-gray-50 p-6 rounded-xl space-y-4">
                  <h4 className="font-medium text-gray-900">Agregar Tratamiento</h4>
                  
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Fecha
                      </label>
                      <input
                        type="date"
                        value={nuevoTratamiento.fecha || new Date().toISOString().split('T')[0]}
                        onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, fecha: e.target.value})}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Diente (Opcional)
                      </label>
                      <input
                        type="number"
                        min="11"
                        max="48"
                        value={nuevoTratamiento.diente_numero || ''}
                        onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, diente_numero: Number(e.target.value) || undefined})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="Ej: 11, 21, 36..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Estado
                      </label>
                      <select
                        value={nuevoTratamiento.estado || 'planificado'}
                        onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, estado: e.target.value as any})}
                        className="w-full px-3 py-2 border rounded-lg"
                      >
                        <option value="planificado">Planificado</option>
                        <option value="en_progreso">En Progreso</option>
                        <option value="completado">Completado</option>
                        <option value="cancelado">Cancelado</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Procedimiento
                    </label>
                    <input
                      type="text"
                      value={nuevoTratamiento.procedimiento || ''}
                      onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, procedimiento: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                      placeholder="Ej: Limpieza dental, Extracción, Obturación..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Descripción
                    </label>
                    <textarea
                      value={nuevoTratamiento.descripcion || ''}
                      onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, descripcion: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={3}
                      placeholder="Descripción detallada del tratamiento..."
                    />
                  </div>

                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Materiales Usados
                      </label>
                      <input
                        type="text"
                        value={nuevoTratamiento.materiales_usados || ''}
                        onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, materiales_usados: e.target.value})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="Materiales utilizados..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Duración (minutos)
                      </label>
                      <input
                        type="number"
                        value={nuevoTratamiento.duracion_minutos || ''}
                        onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, duracion_minutos: Number(e.target.value) || undefined})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="60"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Costo
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={nuevoTratamiento.costo || ''}
                        onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, costo: Number(e.target.value) || undefined})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Doctor
                    </label>
                    <select
                      value={nuevoTratamiento.doctor_id || ''}
                      onChange={(e) => setNuevoTratamiento({...nuevoTratamiento, doctor_id: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">Seleccionar doctor</option>
                      {doctors.map(doctor => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={agregarTratamiento}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Guardar Tratamiento
                    </button>
                    <button
                      onClick={() => {
                        setShowTratamientoForm(false);
                        setNuevoTratamiento({});
                      }}
                      className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {tratamientos.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <Activity className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No hay tratamientos registrados</p>
                  </div>
                ) : (
                  tratamientos.map(tratamiento => (
                    <div key={tratamiento.id} className="bg-white border rounded-xl p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-sm text-gray-500">
                              {new Date(tratamiento.fecha).toLocaleDateString()}
                            </span>
                            {tratamiento.diente_numero && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                                Diente {tratamiento.diente_numero}
                              </span>
                            )}
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              tratamiento.estado === 'completado' ? 'bg-green-100 text-green-800' :
                              tratamiento.estado === 'en_progreso' ? 'bg-yellow-100 text-yellow-800' :
                              tratamiento.estado === 'planificado' ? 'bg-blue-100 text-blue-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {tratamiento.estado.replace('_', ' ').toUpperCase()}
                            </span>
                            <span className="px-2 py-1 bg-purple-100 text-purple-800 text-xs rounded-full">
                              Dr. {doctors.find(d => d.id === tratamiento.doctor_id)?.name || 'Sin asignar'}
                            </span>
                          </div>
                          <h4 className="font-medium text-gray-900">
                            {tratamiento.procedimiento}
                          </h4>
                        </div>
                        {tratamiento.costo && (
                          <div className="text-right">
                            <div className="text-lg font-semibold text-green-600">
                              ${tratamiento.costo.toLocaleString()}
                            </div>
                            {tratamiento.duracion_minutos && (
                              <div className="text-sm text-gray-500">
                                {tratamiento.duracion_minutos} min
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-700">Descripción:</label>
                          <p className="text-gray-900 mt-1">{tratamiento.descripcion}</p>
                        </div>
                        
                        {tratamiento.materiales_usados && (
                          <div>
                            <label className="text-sm font-medium text-gray-700">Materiales:</label>
                            <p className="text-gray-900 mt-1">{tratamiento.materiales_usados}</p>
                          </div>
                        )}

                        {tratamiento.observaciones && (
                          <div>
                            <label className="text-sm font-medium text-gray-700">Observaciones:</label>
                            <p className="text-gray-600 mt-1">{tratamiento.observaciones}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {!loading && activeTab === 'consentimientos' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Consentimientos Informados</h3>
                <button
                  onClick={() => setShowConsentimientoForm(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Nuevo Consentimiento
                </button>
              </div>

              {showConsentimientoForm && (
                <div className="bg-gray-50 p-6 rounded-xl space-y-4">
                  <h4 className="font-medium text-gray-900">Crear Consentimiento Informado</h4>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tipo de Tratamiento
                      </label>
                      <input
                        type="text"
                        value={nuevoConsentimiento.tipo_tratamiento || ''}
                        onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, tipo_tratamiento: e.target.value})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="Ej: Extracción dental, Endodoncia, Implante..."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Costo Estimado
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        value={nuevoConsentimiento.costo_estimado || ''}
                        onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, costo_estimado: Number(e.target.value) || undefined})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Descripción del Tratamiento
                    </label>
                    <textarea
                      value={nuevoConsentimiento.descripcion_tratamiento || ''}
                      onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, descripcion_tratamiento: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={4}
                      placeholder="Descripción detallada del procedimiento..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Riesgos y Beneficios
                    </label>
                    <textarea
                      value={nuevoConsentimiento.riesgos_beneficios || ''}
                      onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, riesgos_beneficios: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={4}
                      placeholder="Explicar los riesgos y beneficios del tratamiento..."
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Alternativas de Tratamiento
                    </label>
                    <textarea
                      value={nuevoConsentimiento.alternativas || ''}
                      onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, alternativas: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={3}
                      placeholder="Otras opciones de tratamiento disponibles..."
                    />
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre del Testigo
                      </label>
                      <input
                        type="text"
                        value={nuevoConsentimiento.testigo_nombre || ''}
                        onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, testigo_nombre: e.target.value})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="Nombre completo del testigo"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Identificación del Testigo
                      </label>
                      <input
                        type="text"
                        value={nuevoConsentimiento.testigo_identificacion || ''}
                        onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, testigo_identificacion: e.target.value})}
                        className="w-full px-3 py-2 border rounded-lg"
                        placeholder="Cédula o identificación"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Doctor Responsable
                    </label>
                    <select
                      value={nuevoConsentimiento.doctor_id || ''}
                      onChange={(e) => setNuevoConsentimiento({...nuevoConsentimiento, doctor_id: e.target.value})}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">Seleccionar doctor</option>
                      {doctors.map(doctor => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctor.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={agregarConsentimiento}
                      className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      Crear Consentimiento
                    </button>
                    <button
                      onClick={() => {
                        setShowConsentimientoForm(false);
                        setNuevoConsentimiento({});
                      }}
                      className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {consentimientos.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <FileCheck className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No hay consentimientos informados</p>
                  </div>
                ) : (
                  consentimientos.map(consentimiento => (
                    <div key={consentimiento.id} className="bg-white border rounded-xl p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-sm text-gray-500">
                              {new Date(consentimiento.fecha_consentimiento).toLocaleDateString()}
                            </span>
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                              Dr. {doctors.find(d => d.id === consentimiento.doctor_id)?.name || 'Sin asignar'}
                            </span>
                            <div className="flex items-center gap-2">
                              {consentimiento.firma_paciente ? (
                                <CheckCircle className="w-4 h-4 text-green-500" title="Firmado por paciente" />
                              ) : (
                                <XCircle className="w-4 h-4 text-red-500" title="Sin firma del paciente" />
                              )}
                              {consentimiento.firma_doctor ? (
                                <Shield className="w-4 h-4 text-green-500" title="Firmado por doctor" />
                              ) : (
                                <Shield className="w-4 h-4 text-red-500" title="Sin firma del doctor" />
                              )}
                            </div>
                          </div>
                          <h4 className="font-medium text-gray-900">
                            {consentimiento.tipo_tratamiento}
                          </h4>
                        </div>
                        <div className="flex items-center gap-3">
                          {consentimiento.costo_estimado && (
                            <div className="text-right">
                              <div className="text-lg font-semibold text-green-600">
                                ${consentimiento.costo_estimado.toLocaleString()}
                              </div>
                            </div>
                          )}
                         <button
                          onClick={() => openPrintConsentimiento(consentimiento)}
                          className="p-2 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50"
                          title="Imprimir consentimiento"
                          >
                          <Printer className="w-5 h-5" />
                         </button>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-gray-700">Descripción:</label>
                          <p className="text-gray-900 mt-1">{consentimiento.descripcion_tratamiento}</p>
                        </div>
                        
                        <div>
                          <label className="text-sm font-medium text-gray-700">Riesgos y Beneficios:</label>
                          <p className="text-gray-900 mt-1">{consentimiento.riesgos_beneficios}</p>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-gray-700">Alternativas:</label>
                          <p className="text-gray-900 mt-1">{consentimiento.alternativas}</p>
                        </div>

                        {consentimiento.testigo_nombre && (
                          <div>
                            <label className="text-sm font-medium text-gray-700">Testigo:</label>
                            <p className="text-gray-600 mt-1">
                              {consentimiento.testigo_nombre} - {consentimiento.testigo_identificacion}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {!loading && activeTab === 'radiografias' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Radiografías y Documentos</h3>
                <label className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 cursor-pointer">
                  <Upload className="w-4 h-4" />
                  Subir Archivo
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.dcm"
                    onChange={subirRadiografia}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {radiografias.length === 0 ? (
                  <div className="col-span-full text-center py-12 text-gray-500">
                    <Image className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                    <p>No hay radiografías o documentos</p>
                  </div>
                ) : (
                  radiografias.map(doc => (
                    <div key={doc.id} className="bg-white border rounded-xl p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            doc.tipo === 'radiografia' ? 'bg-purple-100' :
                            doc.tipo === 'fotografia' ? 'bg-green-100' :
                            doc.tipo === 'laboratorio' ? 'bg-yellow-100' :
                            'bg-blue-100'
                          }`}>
                            {doc.tipo === 'radiografia' ? (
                              <Zap className="w-5 h-5 text-purple-600" />
                            ) : doc.tipo === 'fotografia' ? (
                              <Camera className="w-5 h-5 text-green-600" />
                            ) : (
                              <FileImage className="w-5 h-5 text-blue-600" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">
                              {doc.nombre}
                            </p>
                            <p className="text-sm text-gray-500">
                              {new Date(doc.fecha_toma).toLocaleDateString()}
                            </p>
                            <p className="text-xs text-gray-400 capitalize">
                              {doc.tipo}
                            </p>
                          </div>
                        </div>
                      </div>
                      
                      {doc.descripcion && (
                        <p className="text-sm text-gray-600 mb-3">
                          {doc.descripcion}
                        </p>
                      )}
                      
                      <div className="flex gap-2">
                        <button
                          className="flex-1 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2 text-sm"
                        >
                          <Eye className="w-4 h-4" />
                          Ver
                        </button>
                        <button
                          className="flex-1 px-3 py-2 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 flex items-center justify-center gap-2 text-sm"
                        >
                          <Download className="w-4 h-4" />
                          Descargar
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {expediente && (
                <>
                  Expediente creado: {expediente.created_at ? new Date(expediente.created_at).toLocaleDateString() : 'Hoy'}
                  {expediente.updated_at && expediente.updated_at !== expediente.created_at && (
                    <> • Última actualización: {new Date(expediente.updated_at).toLocaleDateString()}</>
                  )}
                </>
              )}
            </div>
            <div className="flex gap-3">
              <button
              onClick={openPrintComplete}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              title="Imprimir expediente completo"
              >
             <Printer className="w-4 h-4" />
             Imprimir
             </button>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      </div>
{/* Modal de Impresión */}
{showPrintModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-xl w-full max-w-6xl h-full max-h-[95vh] flex flex-col">
      {/* Header - No se imprime */}
      <div className="flex items-center justify-between p-6 border-b print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <Printer className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {printType === 'consentimiento' ? 'Imprimir Consentimiento Informado' : 'Imprimir Expediente Médico'}
            </h2>
            <p className="text-sm text-gray-500">
              {expediente?.nombre_paciente}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </button>
          <button
            onClick={closePrintModal}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Contenido para imprimir */}
      <div className="flex-1 overflow-auto p-8">
        <div id="print-content" className="print:block">
          {/* Encabezado de la clínica */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Clínica Dental</h1>
            <p className="text-gray-600 mt-2">Dirección de la clínica</p>
            <p className="text-gray-600">Teléfono de la clínica</p>
            <div className="w-full h-px bg-gray-300 my-4"></div>
            <h2 className="text-xl font-semibold text-gray-800">
              {printType === 'consentimiento' ? 'CONSENTIMIENTO INFORMADO' : 'EXPEDIENTE MÉDICO DENTAL'}
            </h2>
          </div>

          {/* Información del paciente */}
          <div className="mb-8">
            <div className="bg-gray-50 p-6 rounded-lg">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" />
                Información del Paciente
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <strong>Nombre:</strong> {expediente?.nombre_paciente || 'No especificado'}
                </div>
                <div>
                  <strong>Teléfono:</strong> {expediente?.telefono || 'No especificado'}
                </div>
                <div>
                  <strong>Email:</strong> {expediente?.email || 'No especificado'}
                </div>
                <div>
                  <strong>Fecha de Nacimiento:</strong> {expediente?.fecha_nacimiento ? new Date(expediente.fecha_nacimiento).toLocaleDateString() : 'No especificado'}
                </div>
                <div>
                  <strong>Edad:</strong> {expediente?.edad || 'No especificado'} años
                </div>
                <div>
                  <strong>Género:</strong> {expediente?.genero || 'No especificado'}
                </div>
                <div>
                  <strong>Estado Civil:</strong> {expediente?.estado_civil || 'No especificado'}
                </div>
                <div>
                  <strong>Ocupación:</strong> {expediente?.ocupacion || 'No especificado'}
                </div>
                <div className="md:col-span-2">
                  <strong>Dirección:</strong> {expediente?.direccion || 'No especificado'}
                </div>
                {expediente?.contacto_emergencia && (
                  <>
                    <div>
                      <strong>Contacto de Emergencia:</strong> {expediente.contacto_emergencia}
                    </div>
                    <div>
                      <strong>Teléfono de Emergencia:</strong> {expediente.telefono_emergencia || 'No especificado'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {printType === 'consentimiento' && selectedConsentimientoForPrint ? (
            /* Imprimir solo consentimiento */
            <div className="mb-8">
              <div className="bg-blue-50 p-6 rounded-lg">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-600" />
                  Consentimiento Informado
                </h3>
                <div className="space-y-4">
                  <div>
                    <strong>Tipo de Tratamiento:</strong> {selectedConsentimientoForPrint.tipo_tratamiento}
                  </div>
                  <div>
                    <strong>Fecha:</strong> {new Date(selectedConsentimientoForPrint.fecha_consentimiento).toLocaleDateString()}
                  </div>
                  {selectedConsentimientoForPrint.costo_estimado && (
                    <div>
                      <strong>Costo Estimado:</strong> ${selectedConsentimientoForPrint.costo_estimado.toLocaleString()}
                    </div>
                  )}
                  <div>
                    <strong>Descripción del Tratamiento:</strong>
                    <p className="mt-2 text-gray-700">{selectedConsentimientoForPrint.descripcion_tratamiento}</p>
                  </div>
                  <div>
                    <strong>Riesgos y Beneficios:</strong>
                    <p className="mt-2 text-gray-700">{selectedConsentimientoForPrint.riesgos_beneficios}</p>
                  </div>
                  <div>
                    <strong>Alternativas:</strong>
                    <p className="mt-2 text-gray-700">{selectedConsentimientoForPrint.alternativas}</p>
                  </div>
                  {selectedConsentimientoForPrint.testigo_nombre && (
                    <div>
                      <strong>Testigo:</strong> {selectedConsentimientoForPrint.testigo_nombre} - {selectedConsentimientoForPrint.testigo_identificacion}
                    </div>
                  )}
                </div>
                
                {/* Firmas */}
                <div className="mt-8 pt-6 border-t">
                  <div className="grid md:grid-cols-2 gap-8">
                    <div>
                      <div className="text-center">
                        <div className="h-16 border-b-2 border-gray-300 mb-2"></div>
                        <p><strong>Firma del Paciente</strong></p>
                        <p className="text-sm text-gray-600">{expediente?.nombre_paciente}</p>
                        <p className="text-sm text-gray-500">
                          Estado: {selectedConsentimientoForPrint.firma_paciente ? '✓ Firmado' : '✗ Sin firmar'}
                        </p>
                      </div>
                    </div>
                    <div>
                      <div className="text-center">
                        <div className="h-16 border-b-2 border-gray-300 mb-2"></div>
                        <p><strong>Firma del Doctor</strong></p>
                        <p className="text-sm text-gray-600">{getDoctorName(selectedConsentimientoForPrint.doctor_id)}</p>
                        <p className="text-sm text-gray-500">
                          Estado: {selectedConsentimientoForPrint.firma_doctor ? '✓ Firmado' : '✗ Sin firmar'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Imprimir expediente completo */
            <>
              {/* Historia Clínica */}
              {historiaClinica && (
                <div className="mb-8">
                  <div className="bg-green-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Stethoscope className="w-5 h-5 text-green-600" />
                      Historia Clínica Dental
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <strong>Motivo de Consulta:</strong>
                        <p className="mt-1 text-gray-700">{historiaClinica.motivo_consulta}</p>
                      </div>
                      <div>
                        <strong>Enfermedad Actual:</strong>
                        <p className="mt-1 text-gray-700">{historiaClinica.enfermedad_actual}</p>
                      </div>
                      <div>
                        <strong>Diagnóstico Presuntivo:</strong>
                        <p className="mt-1 text-gray-700">{historiaClinica.diagnostico_presuntivo}</p>
                      </div>
                      <div>
                        <strong>Plan de Tratamiento:</strong>
                        <p className="mt-1 text-gray-700">{historiaClinica.plan_tratamiento}</p>
                      </div>
                      <div className="text-sm text-gray-500 pt-2 border-t">
                        <strong>Doctor:</strong> {getDoctorName(historiaClinica.doctor_id)} | 
                        <strong> Fecha:</strong> {new Date(historiaClinica.fecha_registro).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Tratamientos */}
              {tratamientos.length > 0 && (
                <div className="mb-8">
                  <div className="bg-yellow-50 p-6 rounded-lg">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <ClipboardCheck className="w-5 h-5 text-yellow-600" />
                      Tratamientos Dentales
                    </h3>
               
                  </div>
                </div>
              )}
            </>
          )}

          {/* Pie de página */}
          <div className="mt-8 pt-6 border-t text-center text-sm text-gray-500">
            <p>Expediente generado el {new Date().toLocaleString()}</p>
          </div>
        </div>
      </div>
    </div>

    {/* Estilos para impresión */}
 <style jsx>{`
  @media print {
    /* Ocultar todo excepto nuestro modal */
    .fixed.inset-0 > *:not([class*="bg-white"]) {
      display: none !important;
    }
    
    /* Mostrar solo el contenido del modal */
    #print-content {
      display: block !important;
      visibility: visible !important;
    }
    
    /* Ocultar header del modal en impresión */
    .print\\:hidden {
      display: none !important;
    }
    
    /* Configurar página */
    @page {
      margin: 1cm;
      size: A4;
    }
  }
`}</style>
  </div>
)}

    </div>
  );
}

// Hook personalizado para usar el módulo de expediente médico
export function useMedicalRecord() {
  const [showMedicalRecord, setShowMedicalRecord] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<{
    name: string;
    phone?: string;
    appointmentId?: number;
  } | null>(null);

  const openMedicalRecord = (patient: { name: string; phone?: string; appointmentId?: number }) => {
    setSelectedPatient(patient);
    setShowMedicalRecord(true);
  };

  const closeMedicalRecord = () => {
    setShowMedicalRecord(false);
    setSelectedPatient(null);
  };

  return {
    showMedicalRecord,
    selectedPatient,
    openMedicalRecord,
    closeMedicalRecord
  };
}
