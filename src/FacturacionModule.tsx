// src/facturacion_electronica.tsx - ARCHIVO COMPLETO
import React from "react";
import { api, getSucursalActual } from "./lib/api";

/* ===================== TYPES ===================== */
type Cliente = {
  id: string;
  rfc: string;
  razon_social: string;
  email: string;
  telefono?: string;
  direccion?: string;
  codigo_postal: string;
  regimen_fiscal: string;
  uso_cfdi: string;
  activo: boolean;
  createdAt: string;
};

type Concepto = {
  id: string;
  clave_prodserv: string;
  clave_unidad: string;
  descripcion: string;
  valor_unitario: number;
  cantidad: number;
  importe: number;
  descuento?: number;
  objeto_imp: "01" | "02" | "03";
  impuestos?: {
    traslados?: Array<{
      base: number;
      impuesto: "002" | "003";
      tipo_factor: "Tasa" | "Cuota" | "Exento";
      tasa_o_cuota?: number;
      importe?: number;
    }>;
    retenciones?: Array<{
      base: number;
      impuesto: "001" | "002" | "003";
      tipo_factor: "Tasa" | "Cuota";
      tasa_o_cuota: number;
      importe: number;
    }>;
  };
};

type Factura = {
  id: string;
  folio: number;
  serie?: string;
  fecha: string;
  emisor_rfc: string;
  emisor_nombre: string;
  emisor_regimen: string;
  receptor_id: string;
  receptor_rfc: string;
  receptor_nombre: string;
  receptor_uso_cfdi: string;
  receptor_regimen?: string;
  conceptos: Concepto[];
  subtotal: number;
  descuento?: number;
  total_impuestos_trasladados?: number;
  total_impuestos_retenidos?: number;
  total: number;
  estado: "borrador" | "timbrada" | "cancelada" | "error";
  uuid?: string;
  fecha_timbrado?: string;
  sello_cfd?: string;
  sello_sat?: string;
  cadena_original?: string;
  qr_code?: string;
  xml_path?: string;
  pdf_path?: string;
  cita_id?: number;
  pago_id?: number;
  notas?: string;
  createdAt: string;
  updatedAt: string;
};

type ConfiguracionSAT = {
  rfc: string;
  razon_social: string;
  regimen_fiscal: string;
  codigo_postal: string;
  cer_path?: string;
  key_path?: string;
  key_password?: string;
  pac_proveedor: "finkok" | "facturama" | "sw_sapien" | "otro";
  pac_usuario?: string;
  pac_password?: string;
  pac_url_timbrado?: string;
  pac_url_cancelacion?: string;
  serie_facturas?: string;
  ultimo_folio: number;
  ambiente: "pruebas" | "produccion";
  activo: boolean;
  logo_url?: string;
  logo_base64?: string;
};

type ProductoSAT = {
  id: string;
  nombre: string;
  codigo_interno?: string;
  descripcion: string;
  precio: number;
  clave_prodserv: string;
  clave_unidad: string;
  objeto_imp: "01" | "02" | "03";
};

const LS_KEY_PRODUCTS = "productos_sat";

const loadProductos = (): ProductoSAT[] => {
  try {
    const raw = localStorage.getItem(LS_KEY_PRODUCTS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveProducto = (p: ProductoSAT): ProductoSAT[] => {
  const all = [p, ...loadProductos()];
  localStorage.setItem(LS_KEY_PRODUCTS, JSON.stringify(all));
  return all;
};

/* ===================== API HELPERS ===================== */
const fetchClientes = async (): Promise<Cliente[]> => {
  try {
    const data = await api("/facturacion/clientes");
    return (data || []).map((c: any) => ({
      id: String(c.id),
      rfc: c.rfc,
      razon_social: c.razon_social,
      email: c.email,
      telefono: c.telefono,
      direccion: c.direccion,
      codigo_postal: c.codigo_postal,
      regimen_fiscal: c.regimen_fiscal,
      uso_cfdi: c.uso_cfdi,
      activo: c.activo === undefined ? true : Boolean(c.activo),
      createdAt: c.created_at || new Date().toISOString(),
    }));
  } catch (e) {
    console.error("Error fetching clientes:", e);
    return [];
  }
};

const createCliente = async (clienteData: Partial<Cliente>) => {
  const created = await api("/facturacion/clientes", {
    method: "POST",
    body: JSON.stringify({
      rfc: clienteData.rfc,
      razon_social: clienteData.razon_social,
      email: clienteData.email,
      telefono: clienteData.telefono,
      direccion: clienteData.direccion,
      codigo_postal: clienteData.codigo_postal,
      regimen_fiscal: clienteData.regimen_fiscal,
      uso_cfdi: clienteData.uso_cfdi,
      activo: true,
    }),
  });
  return {
    id: String(created.id),
    ...clienteData,
    activo: true,
    createdAt: new Date().toISOString(),
  } as Cliente;
};

const updateCliente = async (id: string, data: Partial<Cliente>) => {
  return api(`/facturacion/clientes/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
};

const fetchFacturas = async (filtros?: { desde?: string; hasta?: string; estado?: string }) => {
  try {
    let url = "/facturacion/facturas";
    if (filtros) {
      const params = new URLSearchParams();
      if (filtros.desde) params.append("desde", filtros.desde);
      if (filtros.hasta) params.append("hasta", filtros.hasta);
      if (filtros.estado && filtros.estado !== "todas") params.append("estado", filtros.estado);
      if (params.toString()) url += `?${params.toString()}`;
    }

    const data = await api(url);

    return (data || []).map((f: any) => ({
      id: String(f.id),
      folio:
        f.folio !== undefined && f.folio !== null && !isNaN(Number(f.folio))
          ? Number(f.folio)
          : undefined,
      serie: f.serie || undefined,
      fecha: f.fecha || f.created_at,
      emisor_rfc: f.emisor_rfc,
      emisor_nombre: f.emisor_nombre,
      emisor_regimen: f.emisor_regimen,
      receptor_id: f.receptor_id ? String(f.receptor_id) : undefined,
      receptor_rfc: f.receptor_rfc,
      receptor_nombre: f.receptor_nombre || f.cliente || "",
      receptor_uso_cfdi: f.receptor_uso_cfdi,
      conceptos: Array.isArray(f.conceptos) ? f.conceptos : JSON.parse(f.conceptos || "[]"),
      subtotal: Number(f.subtotal || 0),
      descuento: f.descuento ? Number(f.descuento) : undefined,
      total_impuestos_trasladados: f.total_impuestos_trasladados
        ? Number(f.total_impuestos_trasladados)
        : undefined,
      total_impuestos_retenidos: f.total_impuestos_retenidos
        ? Number(f.total_impuestos_retenidos)
        : undefined,
      total: Number(f.total || 0),
      estado: f.estado || "borrador",
      uuid: f.uuid,
      cfdi_id: f.cfdi_id,
      fecha_timbrado: f.fecha_timbrado,
      sello_cfd: f.sello_cfd,
      sello_sat: f.sello_sat,
      xml_path: f.xml_path,
      pdf_path: f.pdf_path,
      cita_id: f.cita_id ? Number(f.cita_id) : undefined,
      pago_id: f.pago_id ? Number(f.pago_id) : undefined,
      notas: f.notas,
      createdAt: f.created_at,
      updatedAt: f.updated_at,
    })) as Factura[];
  } catch (e) {
    console.error("Error fetching facturas:", e);
    return [];
  }
};

const createFactura = async (
  facturaData: Partial<Factura> & {
    tipo_comprobante?: "I" | "E";
    forma_pago?: string;
    metodo_pago?: "PUE" | "PPD";
    cliente_nombre?: string;
    total?: number;
  }
) => {
  const tipo = facturaData.tipo_comprobante === "E" ? "egreso" : "ingreso";

  const conceptosMapped = (facturaData.conceptos || []).map((c: any) => ({
    descripcion: c.descripcion,
    cantidad: c.cantidad,
    valor_unitario: c.valor_unitario,
    importe: c.importe,
    clave_prod_serv: c.clave_prodserv,
    unidad: c.clave_unidad,
    objeto_imp: c.objeto_imp,
  }));

  const created = await api("/facturacion/facturas", {
    method: "POST",
    body: JSON.stringify({
      cliente: facturaData.cliente_nombre || "",
      tipo,
      forma_pago: facturaData.forma_pago,
      metodo_pago: facturaData.metodo_pago,
      cita_id: facturaData.cita_id,
      notas: facturaData.notas,
      total: facturaData.total ?? 0,
      conceptos: conceptosMapped,
    }),
  });

  return created as Factura;
};

const timbrarFactura = async (facturaId: string) => {
  try {
    const result = await facturamaTimbrar({ facturaId });
    
    if (!result.ok) {
      throw new Error(result.error || 'Error al timbrar factura');
    }
    
    return result;
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    
  if (errorMsg.includes('DATOS DEL EMISOR INCOMPLETOS')) {
      throw new Error(
        '❌ DATOS DEL EMISOR INCOMPLETOS\n\n' +
        'Para timbrar facturas necesitas completar los datos fiscales básicos:\n\n' +
        '🔧 Pasos para configurar:\n' +
        '1. Ve a "Configuración Fiscal del Emisor"\n' +
        '2. Completa tu RFC\n' +
        '3. Completa tu Razón Social\n' +
        '4. Selecciona tu Régimen Fiscal\n' +
        '5. Haz clic en "Guardar credenciales"\n\n' +
        'Los certificados están en Facturama, solo necesitas los datos básicos.\n\n' +
        'Detalle técnico: ' + errorMsg
      );
    }
    
    throw error;
  }
};

const cancelarFactura = async (facturaId: string, motivo: string) =>
  api(`/facturacion/facturas/${facturaId}/cancelar`, {
    method: "POST",
    body: JSON.stringify({ motivo }),
  });

const fetchConfiguracionSAT = async (): Promise<ConfiguracionSAT> => {
  try {
    const d = await api("/facturama/configuracion");
    return {
      rfc: d?.rfc || "",
      razon_social: d?.razon_social || "",
      regimen_fiscal: d?.regimen_fiscal || "601",
      codigo_postal: d?.codigo_postal || "",
      pac_proveedor: (d?.pac_proveedor || "finkok") as ConfiguracionSAT["pac_proveedor"],
      pac_usuario: d?.pac_usuario || "",
      pac_password: d?.pac_password || "",
      pac_url_timbrado: d?.pac_url_timbrado || "",
      pac_url_cancelacion: d?.pac_url_cancelacion || "",
      serie_facturas: d?.serie_facturas || "",
      ultimo_folio: Number(d?.ultimo_folio || 1),
      ambiente: (d?.ambiente || "pruebas") as ConfiguracionSAT["ambiente"],
      activo: Boolean(d?.activo),
      logo_url: d?.logo_url || "",
    };
  } catch {
    return {
      rfc: "",
      razon_social: "",
      regimen_fiscal: "601",
      codigo_postal: "",
      pac_proveedor: "finkok",
      pac_usuario: "",
      pac_password: "",
      pac_url_timbrado: "",
      pac_url_cancelacion: "",
      serie_facturas: "",
      ultimo_folio: 1,
      ambiente: "pruebas",
      activo: false,
      logo_url: "",
    };
  }
};

const updateConfiguracionSAT = async (config: Partial<ConfiguracionSAT>) =>
  api("/facturama/configuracion", { method: "PUT", body: JSON.stringify(config) });

/* ===================== CATALOGOS ===================== */
const REGIMENES_FISCALES = [
  { codigo: "601", descripcion: "General de Ley Personas Morales" },
  { codigo: "603", descripcion: "Personas Morales con Fines no Lucrativos" },
  { codigo: "605", descripcion: "Sueldos y Salarios e Ingresos Asimilados a Salarios" },
  { codigo: "606", descripcion: "Arrendamiento" },
  { codigo: "607", descripcion: "Regimen de Enajenacion o Adquisicion de Bienes" },
  { codigo: "608", descripcion: "Demas ingresos" },
  { codigo: "610", descripcion: "Residentes en el Extranjero sin Establecimiento Permanente en Mexico" },
  { codigo: "611", descripcion: "Ingresos por Dividendos (socios y accionistas)" },
  { codigo: "612", descripcion: "Personas Fisicas con Actividades Empresariales y Profesionales" },
  { codigo: "614", descripcion: "Ingresos por intereses" },
  { codigo: "615", descripcion: "Regimen de los ingresos por obtencion de premios" },
  { codigo: "616", descripcion: "Sin obligaciones fiscales" },
  { codigo: "620", descripcion: "Sociedades Cooperativas de Produccion" },
  { codigo: "621", descripcion: "Incorporacion Fiscal" },
  { codigo: "622", descripcion: "Actividades Agricolas, Ganaderas, Silvicolas y Pesqueras" },
  { codigo: "623", descripcion: "Opcional para Grupos de Sociedades" },
  { codigo: "624", descripcion: "Coordinados" },
  { codigo: "625", descripcion: "Actividades por Plataformas Tecnologicas" },
  { codigo: "626", descripcion: "Regimen Simplificado de Confianza" },
];

const USOS_CFDI = [
  { codigo: "D01", descripcion: "Honorarios medicos, dentales y gastos hospitalarios" },
  { codigo: "G03", descripcion: "Gastos en general" },
  { codigo: "S01", descripcion: "Sin efectos fiscales" },
  { codigo: "CP01", descripcion: "Pagos" },
];

const FORMAS_PAGO = [
  { codigo: "01", descripcion: "Efectivo" },
  { codigo: "02", descripcion: "Cheque nominativo" },
  { codigo: "03", descripcion: "Transferencia electronica" },
  { codigo: "04", descripcion: "Tarjeta de credito" },
  { codigo: "28", descripcion: "Tarjeta de debito" },
  { codigo: "99", descripcion: "Por definir" },
];

const METODOS_PAGO = [
  { codigo: "PUE", descripcion: "Pago en una sola exhibicion" },
  { codigo: "PPD", descripcion: "Pago en parcialidades o diferido" },
];

const CLAVES_UNIDAD = [
  { codigo: "E48", descripcion: "Unidad de servicio" },
  { codigo: "H87", descripcion: "Pieza" },
  { codigo: "KGM", descripcion: "Kilogramo" },
  { codigo: "MTR", descripcion: "Metro" },
  { codigo: "XNA", descripcion: "No aplica" },
];

const SAT_ODONTOLOGIA: { code: string; description: string }[] = [
  { code: "85122000", description: "Servicios dentales" },
  { code: "85122001", description: "Servicios de odontologos" },
  { code: "85122002", description: "Servicios de higienistas dentales" },
  { code: "85122003", description: "Servicios de personal de apoyo odontologico" },
  { code: "85122004", description: "Servicios de cirujanos orales" },
  { code: "85122005", description: "Servicios de ortodoncia" },
];

/* ===================== UTILS ===================== */
const calcularImpuestos = (c: Concepto) => {
  let tTras = 0;
  let tRet = 0;
  c.impuestos?.traslados?.forEach((t) => (tTras += t.importe || 0));
  c.impuestos?.retenciones?.forEach((r) => (tRet += r.importe));
  return { tTras, tRet };
};

const calcularTotalesFactura = (conceptos: Concepto[]) => {
  let subtotal = 0;
  let tras = 0;
  let ret = 0;
  conceptos.forEach((c) => {
    subtotal += c.importe;
    const { tTras, tRet } = calcularImpuestos(c);
    tras += tTras;
    ret += tRet;
  });
  const total = subtotal + tras - ret;
  const rnd = (n: number) => Math.round(n * 100) / 100;
  return {
    subtotal: rnd(subtotal),
    totalImpuestosTrasladados: rnd(tras),
    totalImpuestosRetenidos: rnd(ret),
    total: rnd(total),
  };
};

/* ===================== FACTURAMA HELPERS ===================== */
type FacturamaStampResult = {
  ok: boolean;
  sucursalId?: string;
  facturaId?: string;
  cfdiId?: string;
  uuid?: string;
  serie?: string;
  folio?: string;
  facturama?: any;
  updated?: any;
  error?: string;
};

const FACTURAMA_PREFIXES = ["/facturama", "/api/facturama"];

async function apiFacturama<T = any>(path: string, init?: RequestInit & { body?: any }) {
  let lastErr: any = null;
  for (const base of FACTURAMA_PREFIXES) {
    try {
      return (await api(`${base}${path}`, init)) as T;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Facturama API no disponible");
}

const facturamaTest = async (): Promise<{ ok: boolean; count?: number; error?: string }> => {
  return apiFacturama("/test");
};

const facturamaTimbrar = async (params: {
  facturaId?: string;
  payload?: any;
  sucursalId?: string;
}): Promise<FacturamaStampResult> => {
  if (!params.facturaId && !params.payload) {
    throw new Error("Debes enviar facturaId o payload");
  }
  const body: any = {
    factura_id: params.facturaId,
    payload: params.payload,
  };
  if (params.sucursalId) {
    body.sucursal_id = params.sucursalId;
  }
  return apiFacturama("/timbrar", { method: "POST", body: JSON.stringify(body) });
};

const facturamaDescargarZip = async (cfdiId: string, opts?: { sucursalId?: string }) => {
  if (!cfdiId) throw new Error("Falta cfdiId");
  let lastErr: any = null;
  for (const base of FACTURAMA_PREFIXES) {
    try {
      const res = await fetch(`${base}/${encodeURIComponent(cfdiId)}/zip`, {
        method: "GET",
        credentials: "include",
        headers: opts?.sucursalId ? ({ "x-sucursal": opts.sucursalId } as any) : undefined,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${cfdiId}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("No se pudo descargar el ZIP de Facturama");
};

const API_BASE = (
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  "http://localhost:4001"
).replace(/\/$/, "");

async function descargarBlob(url: string, filename: string, headers?: Record<string, string>) {
  const res = await fetch(url, { 
    headers: {
      'Accept': 'application/pdf, application/octet-stream, */*',
      ...headers
    }
  });
  
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(msg || `Falló la descarga (${res.status})`);
  }
  
  const contentType = res.headers.get('content-type') || '';
  let blob: Blob;
  
  if (contentType.includes('application/json')) {
    // El servidor devuelve JSON con base64
    const json = await res.json();
    if (json.base64) {
      // Decodificar base64 a bytes
      const byteCharacters = atob(json.base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: 'application/pdf' });
    } else {
      throw new Error('Respuesta JSON sin campo base64');
    }
  } else {
    // Respuesta directa como blob
    blob = await res.blob();
  }
  
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}

// === FORZAR HOST DEL BACKEND + SUCURSAL EN QUERY ===

// 1) backend base ABSOLUTO (usa .env del Static si existe, si no, fuerza el backend real)
const BACKEND_BASE =
  (import.meta as any)?.env?.VITE_BACKEND_BASE?.replace(/\/$/, '') ||
  'http://localhost:4001'; // <— fuerza backend (no el static)

// 2) sucursal en query (para que el backend no caiga en sucursal_1 por default)
function getSucursalQS() {
  try {
    // Usa el util oficial del proyecto
    const actual = (typeof getSucursalActual === 'function' && getSucursalActual()) || '';

    // Fallbacks por si tu selector usa otras claves
    const s =
      actual ||
      localStorage.getItem('sucursal_actual') ||
      localStorage.getItem('sucursal') ||
      localStorage.getItem('x-sucursal') ||
      sessionStorage.getItem('sucursal_actual') ||
      sessionStorage.getItem('sucursal') ||
      sessionStorage.getItem('x-sucursal') ||
      '';

    return s && s !== 'todas' ? `?sucursal_id=${encodeURIComponent(s)}` : '';
  } catch {
    return '';
  }
}

// 3) helpers para obtener id/uuid de la fila
function getIssuedLiteId(f: any) {
  return f?.facturama_id ?? f?.cfdi_id ?? f?.cfdiId ?? f?.id_facturama ?? null;
}
function getUuid(f: any) {
  return f?.uuid ?? null;
}

// 4) abrir SIEMPRE en el backend (nueva pestaña, sin fetch previo)
function openOnBackend(pathWithLeadingSlash: string) {
  const url = `${BACKEND_BASE}${pathWithLeadingSlash}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// 5) DESCARGAS —> siempre van al backend y SIEMPRE con ?sucursal_id=...
export function descargarPdfFactura(factura: any) {
  const id = getIssuedLiteId(factura);
  const uuid = getUuid(factura);
  const qs = getSucursalQS();
  if (id) return openOnBackend(`/api/facturama/${encodeURIComponent(id)}/pdf${qs}`);
  if (uuid) return openOnBackend(`/api/facturama/${encodeURIComponent(uuid)}/pdf${qs}`);
  alert('No hay id de Facturama ni UUID para esta factura.');
}

export function descargarXmlFactura(factura: any) {
  const id = getIssuedLiteId(factura);
  const uuid = getUuid(factura);
  const qs = getSucursalQS();
  if (id) return openOnBackend(`/api/facturama/${encodeURIComponent(id)}/xml${qs}`);
  if (uuid) return openOnBackend(`/api/facturama/${encodeURIComponent(uuid)}/xml${qs}`);
  alert('No hay id de Facturama ni UUID para esta factura.');
}

export function descargarZipFactura(factura: any) {
  const id = getIssuedLiteId(factura);
  const uuid = getUuid(factura);
  const qs = getSucursalQS();
  if (id) return openOnBackend(`/api/facturama/${encodeURIComponent(id)}/zip${qs}`);
  if (uuid) return openOnBackend(`/api/facturama/${encodeURIComponent(uuid)}/zip${qs}`);
  alert('No hay id de Facturama ni UUID para esta factura.');
}

async function uploadLogoFlexible(
  file: File
): Promise<{ ok: boolean; url?: string; error?: string }> {
  try {
    const fd = new FormData();
    fd.append("logo", file);

    const res = await fetch("/api/facturama/configuracion/logo", {
      method: "POST",
      body: fd,
      credentials: "include",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    let j: any = null;
    try {
      j = await res.json();
    } catch {}

    if (j?.ok) return { ok: true, url: j.url };
    if (j?.url) return { ok: true, url: j.url };

    try {
      const t = await res.text();
      if (t && t.startsWith("http")) return { ok: true, url: t };
    } catch {}

    return { ok: true };
  } catch (_err) {
    try {
      const base64 = await fileToDataURL(file);
      const updated = await updateConfiguracionSAT({ logo_base64: base64 });
      return { ok: true, url: (updated as any)?.logo_url };
    } catch (e2: any) {
      return { ok: false, error: e2?.message || "No se pudo subir el logo" };
    }
  }
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function uploadCertificadosCSD(
  cerFile: File,
  keyFile: File,
  keyPassword: string
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const fd = new FormData();
    fd.append("cer", cerFile);
    fd.append("key", keyFile);
    fd.append("key_password", keyPassword);

    // 🔑 Detectar sucursal actual (mismo mecanismo que usa tu app)
    const sucursal =
      (typeof localStorage !== "undefined" && (localStorage.getItem("sucursal") || localStorage.getItem("x-sucursal"))) ||
      (typeof sessionStorage !== "undefined" && (sessionStorage.getItem("sucursal") || sessionStorage.getItem("x-sucursal"))) ||
      undefined;

    // ✅ Enviar SIEMPRE x-sucursal; además, mandarla en query como respaldo
    const url = sucursal
      ? `/api/facturama/configuracion/certificados?sucursal_id=${encodeURIComponent(sucursal)}`
      : `/api/facturama/configuracion/certificados`;

    const headers: Record<string, string> = {};
    if (sucursal) headers["x-sucursal"] = sucursal;

    const res = await fetch(url, {
      method: "POST",
      body: fd,
      credentials: "include",
      headers, // <- aquí va x-sucursal cuando exista
    });

    if (!res.ok) {
      let errorData: any;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        errorData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      } else {
        const text = await res.text();
        errorData = { error: text || `HTTP ${res.status}` };
      }
      throw new Error(errorData.error || `HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") || "";
    let data: any;
    if (contentType.includes("application/json")) {
      data = await res.json();
    } else {
      const text = await res.text();
      data = { ok: true, message: text || "Certificados subidos correctamente" };
    }

    return {
      ok: data.ok !== false,
      message: data.message || "Certificados cargados correctamente",
    };
  } catch (e: any) {
    console.error("Error uploading certificates:", e);
    return { ok: false, error: e?.message || "No se pudieron subir los certificados" };
  }
}

// ✅ AGREGAR AQUÍ LA NUEVA FUNCIÓN (después de la línea ~950)
async function checkCertificadosStatus(): Promise<{
  tiene_certificados: boolean;
  tiene_cer: boolean;
  tiene_key: boolean;
  tiene_password: boolean;
  cer_size: number;
  key_size: number;
  mensaje: string;
}> {
  try {
    const sucursal =
      (typeof localStorage !== "undefined" && 
       (localStorage.getItem("sucursal") || localStorage.getItem("x-sucursal"))) ||
      (typeof sessionStorage !== "undefined" && 
       (sessionStorage.getItem("sucursal") || sessionStorage.getItem("x-sucursal"))) ||
      'sucursal_1';

    const url = sucursal
      ? `/api/facturama/configuracion/certificados/status?sucursal_id=${encodeURIComponent(sucursal)}`
      : `/api/facturama/configuracion/certificados/status`;

    const headers: Record<string, string> = {};
    if (sucursal) headers["x-sucursal"] = sucursal;

    const res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      tiene_certificados: data.tiene_certificados || false,
      tiene_cer: data.tiene_cer || false,
      tiene_key: data.tiene_key || false,
      tiene_password: data.tiene_password || false,
      cer_size: data.cer_size || 0,
      key_size: data.key_size || 0,
      mensaje: data.mensaje || 'Sin información',
    };
  } catch (e: any) {
    console.error('Error checking certificates status:', e);
    return {
      tiene_certificados: false,
      tiene_cer: false,
      tiene_key: false,
      tiene_password: false,
      cer_size: 0,
      key_size: 0,
      mensaje: 'Error al verificar certificados',
    };
  }
}

function FacturamaCredenciales() {
  const [cfg, setCfg] = React.useState<ConfiguracionSAT | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [logoPreview, setLogoPreview] = React.useState<string>("");
  const [open, setOpen] = React.useState(true);

  const [cerFile, setCerFile] = React.useState<File | null>(null);
  const [keyFile, setKeyFile] = React.useState<File | null>(null);
  const [keyPassword, setKeyPassword] = React.useState("");
  const [uploadingCert, setUploadingCert] = React.useState(false);
  const [certStatus, setCertStatus] = React.useState<any>(null);
  const [showCertSection, setShowCertSection] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const c = await fetchConfiguracionSAT();
      setCfg(c);
      setLogoPreview(c.logo_url || "");
      
      const status = await checkCertificadosStatus();
      setCertStatus(status);
    })();
  }, []);

  const onSave = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const payload: Partial<ConfiguracionSAT> = {
        rfc: cfg.rfc?.toUpperCase(),
        razon_social: cfg.razon_social,
        regimen_fiscal: cfg.regimen_fiscal,
        codigo_postal: cfg.codigo_postal,
        pac_proveedor: "facturama",
        pac_usuario: cfg.pac_usuario,
        pac_password: cfg.pac_password,
        pac_url_timbrado: cfg.pac_url_timbrado,
        pac_url_cancelacion: cfg.pac_url_cancelacion,
        serie_facturas: cfg.serie_facturas,
        ultimo_folio: cfg.ultimo_folio,
        ambiente: cfg.ambiente,
        activo: Boolean(cfg.activo),
      };
      const updated = await updateConfiguracionSAT(payload);
      setCfg((prev) => ({ ...(prev || {} as any), ...(updated as any) }));
      alert("Credenciales guardadas.");
    } catch (e: any) {
      alert("No se pudo guardar la configuracion.");
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const t = await facturamaTest();
      if (t.ok) {
        alert(`Conexion OK${t.count ? ` (muestras: ${t.count})` : ""}`);
      } else {
        alert(`Error de conexion: ${t.error || "desconocido"}`);
      }
    } catch (e: any) {
      alert("No se pudo probar la conexion con Facturama.");
    } finally {
      setTesting(false);
    }
  };

  const onLogoChange = async (file?: File | null) => {
    if (!file) return;
    const local = await fileToDataURL(file);
    setLogoPreview(local);
    const res = await uploadLogoFlexible(file);
    if (!res.ok) {
      alert(res.error || "No se pudo cargar el logo");
      return;
    }
    setCfg((prev) => ({ ...(prev || {} as any), logo_url: res.url || (prev?.logo_url || "") }));
  };

 const onUploadCertificados = async () => {
    if (!cerFile || !keyFile || !keyPassword) {
      alert("Debes seleccionar ambos archivos (.cer y .key) y proporcionar la contraseña");
      return;
    }

    setUploadingCert(true);
    try {
      const res = await uploadCertificadosCSD(cerFile, keyFile, keyPassword);
      if (res.ok) {
        // ✅ LIMPIAR EL FORMULARIO PRIMERO
        setCerFile(null);
        setKeyFile(null);
        setKeyPassword("");
        
        // ✅ RECARGAR EL ESTADO DE LOS CERTIFICADOS (con retry)
        let intentos = 0;
        const maxIntentos = 3;
        let statusCargado = false;
        
        while (intentos < maxIntentos && !statusCargado) {
          await new Promise(resolve => setTimeout(resolve, intentos * 500)); // Esperar 0ms, 500ms, 1000ms
          const status = await checkCertificadosStatus();
          
          if (status.tiene_certificados) {
            setCertStatus(status);
            statusCargado = true;
            setShowCertSection(false);
            alert(res.message || "✅ Certificados cargados correctamente");
          } else {
            intentos++;
            if (intentos >= maxIntentos) {
              // Si después de 3 intentos no se cargaron, mostrar advertencia pero actualizar UI
              setCertStatus(status);
              alert("⚠️ Los certificados se guardaron pero hay un retraso en la verificación. Recarga la página para confirmar.");
            }
          }
        }
      } else {
        alert(res.error || "Error al cargar certificados");
      }
    } catch (e: any) {
      alert("Error: " + (e?.message || "desconocido"));
    } finally {
      setUploadingCert(false);
    }
  };

  if (!cfg) {
    return (
      <div className="bg-white border rounded-xl p-4 shadow-sm mb-6">
        <div className="animate-pulse text-sm text-gray-500">Cargando configuracion...</div>
      </div>
    );
  }

  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm mb-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Configuración Fiscal del Emisor</h3>
          <p className="text-sm text-gray-500 mt-1">
            Configura tus datos fiscales. El timbrado se hace con la cuenta maestra del sistema.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-sm px-3 py-1 border rounded-lg hover:bg-gray-50"
        >
          {open ? "Ocultar" : "Mostrar"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-6">
{/* ⚠️ Mensaje informativo importante */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">ℹ️</span>
              <div className="text-sm">
                <p className="font-semibold text-blue-900 mb-2">¿Cómo funciona el sistema?</p>
                <ul className="space-y-1 text-blue-800">
                  <li>✅ Ingresa tu RFC, razón social y régimen fiscal</li>
                  <li>✅ Estos datos aparecerán como EMISOR en tus facturas</li>
                  <li>✅ El timbrado se descuenta de la cuenta maestra del sistema</li>
                  <li>✅ NO necesitas cuenta propia de Facturama</li>
                  {false && (
  <li>⚠️ Los certificados CSD son opcionales (solo para funciones avanzadas)</li>
)}
                </ul>
              </div>
            </div>
          </div>
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">Datos del Emisor</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">RFC *</label>
                <input
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.rfc}
                  onChange={(e) => setCfg({ ...cfg, rfc: e.target.value.toUpperCase() })}
                  maxLength={13}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-600 mb-1">Razon Social *</label>
                <input
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.razon_social}
                  onChange={(e) => setCfg({ ...cfg, razon_social: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Codigo Postal *</label>
                <input
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.codigo_postal}
                  onChange={(e) => setCfg({ ...cfg, codigo_postal: e.target.value })}
                  maxLength={5}
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-600 mb-1">Regimen Fiscal *</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.regimen_fiscal}
                  onChange={(e) => setCfg({ ...cfg, regimen_fiscal: e.target.value })}
                >
                  {REGIMENES_FISCALES.map((r) => (
                    <option key={r.codigo} value={r.codigo}>
                      {r.codigo} - {r.descripcion}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Serie</label>
                <input
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.serie_facturas || ""}
                  onChange={(e) => setCfg({ ...cfg, serie_facturas: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Ultimo folio</label>
                <input
                  type="number"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.ultimo_folio}
                  onChange={(e) => setCfg({ ...cfg, ultimo_folio: Number(e.target.value || 0) })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Ambiente</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.ambiente}
                  onChange={(e) => setCfg({ ...cfg, ambiente: e.target.value as "pruebas" | "produccion" })}
                >
                  <option value="pruebas">Pruebas</option>
                  <option value="produccion">Produccion</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Activo</label>
                <select
                  className="w-full px-3 py-2 border rounded-lg"
                  value={String(cfg.activo)}
                  onChange={(e) => setCfg({ ...cfg, activo: e.target.value === "true" })}
                >
                  <option value="true">Si</option>
                  <option value="false">No</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-2">PAC - Facturama</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Usuario</label>
                <input
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.pac_usuario || ""}
                  onChange={(e) => setCfg({ ...cfg, pac_usuario: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Contrasena</label>
                <input
                  type="password"
                  className="w-full px-3 py-2 border rounded-lg"
                  value={cfg.pac_password || ""}
                  onChange={(e) => setCfg({ ...cfg, pac_password: e.target.value })}
                />
              </div>
              <div className="hidden">
  <label className="block text-xs text-gray-600 mb-1">URL Timbrado (opcional)</label>
  <input
    className="w-full px-3 py-2 border rounded-lg"
    placeholder="https://.../stamp"
    value={cfg.pac_url_timbrado || ""}
    onChange={(e) => setCfg({ ...cfg, pac_url_timbrado: e.target.value })}
  />
</div>

             <div className="hidden">
  <label className="block text-xs text-gray-600 mb-1">URL Cancelacion (opcional)</label>
  <input
    className="w-full px-3 py-2 border rounded-lg"
    placeholder="https://.../cancel"
    value={cfg.pac_url_cancelacion || ""}
    onChange={(e) => setCfg({ ...cfg, pac_url_cancelacion: e.target.value })}
  />
</div>

            </div>
          </div>

         <div className="hidden">
  <h4 className="text-sm font-medium text-gray-700 mb-2">Logo para PDF</h4>
  <div className="flex items-center gap-4">
    <div className="w-40 h-40 border rounded-lg bg-gray-50 flex items-center justify-center overflow-hidden">
      {logoPreview ? (
        <img src={logoPreview} alt="Logo actual" className="object-contain w-full h-full" />
      ) : (
        <span className="text-xs text-gray-500">Sin logo</span>
      )}
    </div>
    <div className="space-y-2">
      <input
        type="file"
        accept="image/*"
        onChange={(e) => onLogoChange(e.target.files?.[0])}
        className="block text-sm"
      />
      <p className="text-xs text-gray-500">
        Recomendado: PNG/JPG cuadrado menor a 512KB
      </p>
    </div>
  </div>
</div>
          <div className="border-t pt-4 hidden">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-gray-700">
                Certificados CSD (Certificado de Sello Digital)
              </h4>
              <button
                type="button"
                onClick={() => setShowCertSection((v) => !v)}
                className="text-sm px-3 py-1 border rounded-lg hover:bg-gray-50"
              >
                {showCertSection ? "Ocultar" : "Configurar"}
              </button>
            </div>

            {certStatus && (
              <div className={`p-3 rounded-lg mb-3 ${certStatus.tiene_certificados ? "bg-green-50" : "bg-yellow-50"}`}>
                <div className="flex items-center gap-2">
                  <span className={`text-2xl ${certStatus.tiene_certificados ? "text-green-600" : "text-yellow-600"}`}>
                    {certStatus.tiene_certificados ? "✓" : "⚠"}
                  </span>
                  <div className="text-sm">
                    <div className="font-medium">
                      {certStatus.tiene_certificados ? "Certificados configurados" : "Certificados pendientes"}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {certStatus.mensaje}
                    </div>
                    {certStatus.tiene_certificados && (
                      <div className="text-xs text-gray-500 mt-1">
                        .cer: {Math.round((certStatus.cer_size || 0) / 1024)}KB | .key: {Math.round((certStatus.key_size || 0) / 1024)}KB
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {showCertSection && (
              <div className="bg-gray-50 p-4 rounded-lg space-y-4">
                <p className="text-xs text-gray-600">
                  Para timbrar facturas necesitas subir tu certificado de sello digital (.cer y .key) emitido por el SAT.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Archivo .cer (Certificado publico) *
                    </label>
                    <input
                      key={cerFile ? "cer-filled" : "cer-empty"}
                      type="file"
                      accept=".cer"
                      onChange={(e) => setCerFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm"
                    />
                    {cerFile && (
                      <div className="text-xs text-green-600 mt-1">
                        ✓ {cerFile.name} ({Math.round(cerFile.size / 1024)}KB)
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Archivo .key (Llave privada) *
                    </label>
                    <input
                      key={keyFile ? "key-filled" : "key-empty"}
                      type="file"
                      accept=".key"
                      onChange={(e) => setKeyFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm"
                    />
                    {keyFile && (
                      <div className="text-xs text-green-600 mt-1">
                        ✓ {keyFile.name} ({Math.round(keyFile.size / 1024)}KB)
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Contrasena de la llave privada (.key) *
                  </label>
                  <input
                    type="password"
                    value={keyPassword}
                    onChange={(e) => setKeyPassword(e.target.value)}
                    placeholder="Contrasena del certificado"
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onUploadCertificados}
                    disabled={uploadingCert || !cerFile || !keyFile || !keyPassword}
                    className={`px-5 py-2 rounded-lg font-medium ${
                      uploadingCert || !cerFile || !keyFile || !keyPassword
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-blue-600 text-white hover:bg-blue-700"
                    }`}
                  >
                    {uploadingCert ? "Subiendo..." : "Subir certificados"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowCertSection(false);
                      setCerFile(null);
                      setKeyFile(null);
                      setKeyPassword("");
                    }}
                    className="px-5 py-2 border rounded-lg hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                </div>

                <div className="bg-blue-50 p-3 rounded-lg">
                  <h5 className="text-xs font-medium text-blue-900 mb-1">Notas importantes:</h5>
                  <ul className="text-xs text-blue-800 space-y-1 list-disc list-inside">
                    <li>Los certificados deben estar vigentes</li>
                    <li>El RFC debe coincidir con el emisor</li>
                    <li>Los archivos se almacenan de forma segura</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className={`px-5 py-2 rounded-lg font-medium ${
                saving ? "bg-gray-300 text-gray-500 cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {saving ? "Guardando..." : "Guardar credenciales"}
            </button>
            <button
              type="button"
              onClick={onTest}
              disabled={testing}
              className="px-5 py-2 rounded-lg border hover:bg-gray-50"
            >
              {testing ? "Probando..." : "Probar conexion"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClienteForm({ onClienteCreated }: { onClienteCreated: (cliente: Cliente) => void }) {
  const [formData, setFormData] = React.useState({
    rfc: "",
    razon_social: "",
    email: "",
    telefono: "",
    direccion: "",
    codigo_postal: "",
    regimen_fiscal: "612",
    uso_cfdi: "D01",
  });
  const [loading, setLoading] = React.useState(false);

  const submitCliente = async () => {
    if (!formData.rfc || !formData.razon_social || !formData.email) return;
    setLoading(true);
    try {
      const cliente = await createCliente(formData);
      onClienteCreated(cliente);
      setFormData({
        rfc: "",
        razon_social: "",
        email: "",
        telefono: "",
        direccion: "",
        codigo_postal: "",
        regimen_fiscal: "612",
        uso_cfdi: "D01",
      });
    } catch (err: any) {
      alert("Error al crear cliente: " + (err?.message || "desconocido"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-xl p-4 shadow-sm">
      <h3 className="text-base font-semibold mb-3">Nuevo Cliente</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">RFC *</label>
          <input
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.rfc}
            onChange={(e) => setFormData({ ...formData, rfc: e.target.value.toUpperCase() })}
            maxLength={13}
            placeholder="XAXX010101000"
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Razon Social *</label>
          <input
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.razon_social}
            onChange={(e) => setFormData({ ...formData, razon_social: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
          <input
            type="email"
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Telefono</label>
          <input
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.telefono}
            onChange={(e) => setFormData({ ...formData, telefono: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Codigo Postal</label>
          <input
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.codigo_postal}
            onChange={(e) => setFormData({ ...formData, codigo_postal: e.target.value })}
            maxLength={5}
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Direccion</label>
          <input
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.direccion}
            onChange={(e) => setFormData({ ...formData, direccion: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Regimen Fiscal</label>
          <select
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.regimen_fiscal}
            onChange={(e) => setFormData({ ...formData, regimen_fiscal: e.target.value })}
          >
            {REGIMENES_FISCALES.map((r) => (
              <option key={r.codigo} value={r.codigo}>
                {r.codigo} - {r.descripcion}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Uso CFDI</label>
          <select
            className="w-full px-3 py-2 border rounded-lg"
            value={formData.uso_cfdi}
            onChange={(e) => setFormData({ ...formData, uso_cfdi: e.target.value })}
          >
            {USOS_CFDI.map((u) => (
              <option key={u.codigo} value={u.codigo}>
                {u.codigo} - {u.descripcion}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={submitCliente}
          disabled={!formData.rfc || !formData.razon_social || !formData.email}
          className={`px-5 py-2 rounded-lg font-medium ${
            !formData.rfc || !formData.razon_social || !formData.email
              ? "bg-gray-300 text-gray-500 cursor-not-allowed"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          Guardar cliente
        </button>
      </div>
    </div>
  );
}

function FacturaForm({
  clientes,
  appointments,
  payments,
  onFacturaCreated,
}: {
  clientes: Cliente[];
  appointments: any[];
  payments: any[];
  onFacturaCreated: (f: Factura) => void;
}) {
  const [tipoComprobante, setTipoComprobante] = React.useState<"I" | "E">("I");
  const [formaPago, setFormaPago] = React.useState<string>("28");
  const [metodoPago, setMetodoPago] = React.useState<"PUE" | "PPD">("PUE");

  const [showClienteForm, setShowClienteForm] = React.useState(false);
  const [clientesLocal, setClientesLocal] = React.useState<Cliente[]>(clientes);
  React.useEffect(() => setClientesLocal(clientes), [clientes]);

  const [showClienteEdit, setShowClienteEdit] = React.useState(false);
  const [editData, setEditData] = React.useState<Partial<Cliente>>({});
  const [editLoading, setEditLoading] = React.useState(false);

  const [productos, setProductos] = React.useState<ProductoSAT[]>([]);
  const [showProductoForm, setShowProductoForm] = React.useState(false);
  const [productoSel, setProductoSel] = React.useState<string>("");

  React.useEffect(() => {
    setProductos(loadProductos());
  }, []);

  const [formData, setFormData] = React.useState({
    receptor_id: "",
    cita_id: "",
    pago_id: "",
    notas: "",
  });

  const [conceptos, setConceptos] = React.useState<Concepto[]>([]);

  const [loading, setLoading] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);

  const clienteSel = clientesLocal.find((c) => c.id === formData.receptor_id);
  const totales = calcularTotalesFactura(conceptos);

  const [prodForm, setProdForm] = React.useState<ProductoSAT>({
    id: "",
    nombre: "",
    codigo_interno: "",
    descripcion: "",
    precio: 0,
    clave_prodserv: "85122000",
    clave_unidad: "E48",
    objeto_imp: "02",
  });

  const [showSatHelper, setShowSatHelper] = React.useState(false);
  const [satQuery, setSatQuery] = React.useState("");
  const filteredSat = React.useMemo(() => {
    const q = satQuery.trim().toLowerCase();
    if (!q) return SAT_ODONTOLOGIA;
    return SAT_ODONTOLOGIA.filter(
      (i) => i.code.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
    );
  }, [satQuery]);

  const addConceptFromProduct = (p: ProductoSAT) => {
    const base: Concepto = {
      id: Date.now().toString(),
      clave_prodserv: p.clave_prodserv,
      clave_unidad: p.clave_unidad,
      descripcion: p.descripcion || p.nombre,
      valor_unitario: p.precio,
      cantidad: 1,
      importe: p.precio,
      objeto_imp: p.objeto_imp,
      impuestos: {},
    };
    if (p.objeto_imp === "03") {
      base.impuestos = {
        traslados: [
          { base: p.precio, impuesto: "002", tipo_factor: "Tasa", tasa_o_cuota: 0.16, importe: p.precio * 0.16 },
        ],
      };
    } else if (p.objeto_imp === "02") {
      base.impuestos = { traslados: [{ base: p.precio, impuesto: "002", tipo_factor: "Exento" }] };
    }
    setConceptos((prev) => [...prev, base]);
  };

  const actualizarConcepto = (id: string, campo: string, valor: any) => {
    setConceptos((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const updated: any = { ...c, [campo]: valor };
        if (campo === "cantidad" || campo === "valor_unitario") {
          updated.importe = Number(updated.cantidad) * Number(updated.valor_unitario);
          if (updated.impuestos?.traslados) {
            updated.impuestos.traslados = updated.impuestos.traslados.map((t: any) => ({
              ...t,
              base: updated.importe,
              importe: updated.importe * (t.tasa_o_cuota || 0),
            }));
          }
        }
        return updated as Concepto;
      })
    );
  };

  const eliminarConcepto = (id: string) => setConceptos((p) => p.filter((c) => c.id !== id));

  const openClienteEditor = () => {
    if (!clienteSel) return;
    setEditData({
      rfc: clienteSel.rfc,
      razon_social: clienteSel.razon_social,
      email: clienteSel.email,
      telefono: clienteSel.telefono || "",
      direccion: clienteSel.direccion || "",
      codigo_postal: clienteSel.codigo_postal || "",
      regimen_fiscal: clienteSel.regimen_fiscal || "612",
      uso_cfdi: clienteSel.uso_cfdi || "D01",
    });
    setShowClienteEdit(true);
  };

  const saveClienteEdit = async () => {
    if (!formData.receptor_id) return;
    if (!editData.rfc || !editData.razon_social || !editData.email) return;
    setEditLoading(true);
    try {
      const payload = {
        ...editData,
        rfc: (editData.rfc || "").toUpperCase(),
      };
      await updateCliente(formData.receptor_id, payload);
      setClientesLocal((prev) => prev.map((c) => (c.id === formData.receptor_id ? { ...c, ...payload } : c)));
      setShowClienteEdit(false);
    } catch (e) {
      alert("No se pudo actualizar el cliente.");
    } finally {
      setEditLoading(false);
    }
  };

  const guardarProducto = () => {
    if (!prodForm.nombre || !prodForm.clave_prodserv || !prodForm.clave_unidad) return;
    const nuevo: ProductoSAT = { ...prodForm, id: crypto.randomUUID() };
    const list = saveProducto(nuevo);
    setProductos(list);
    setShowProductoForm(false);
    setProdForm({
      id: "",
      nombre: "",
      codigo_interno: "",
      descripcion: "",
      precio: 0,
      clave_prodserv: "85122000",
      clave_unidad: "E48",
      objeto_imp: "02",
    });
  };

  const onClienteInlineCreated = (c: Cliente) => {
    setClientesLocal((prev) => [c, ...prev]);
    setFormData((f) => ({ ...f, receptor_id: c.id }));
    setShowClienteForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.receptor_id || conceptos.length === 0) return;
    setLoading(true);
    try {
      const factura = await createFactura({
        receptor_id: formData.receptor_id,
        conceptos,
        cita_id: formData.cita_id ? Number(formData.cita_id) : undefined,
        pago_id: formData.pago_id ? Number(formData.pago_id) : undefined,
        notas: formData.notas,
        tipo_comprobante: tipoComprobante,
        forma_pago: formaPago,
        metodo_pago: metodoPago,
        total: totales.total,
        cliente_nombre: clienteSel?.razon_social || clienteSel?.rfc,
      });
      onFacturaCreated(factura);
      setFormData({ receptor_id: "", cita_id: "", pago_id: "", notas: "" });
      setConceptos([]);
      setShowPreview(true);
    } catch (err: any) {
      alert("Error al crear factura: " + (err?.message || "desconocido"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <FacturamaCredenciales />

      <form onSubmit={handleSubmit} className="bg-white border rounded-xl p-6 shadow-sm">
        <h3 className="text-lg font-semibold mb-4">Nueva Factura</h3>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-2">
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar Cliente *</label>
            <div className="flex items-center gap-2">
              <select
                value={formData.receptor_id}
                onChange={(e) => setFormData({ ...formData, receptor_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                required
              >
                <option value="">Seleccionar cliente</option>
                {clientesLocal
                  .filter((c) => c.activo)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.rfc} - {c.razon_social}
                    </option>
                  ))}
              </select>

              <button
                type="button"
                title="Nuevo cliente"
                onClick={() => setShowClienteForm((s) => !s)}
                className="px-3 py-2 border rounded-lg hover:bg-gray-50"
              >
                +
              </button>

              <button
                type="button"
                title="Editar datos del cliente"
                onClick={openClienteEditor}
                disabled={!formData.receptor_id}
                className={`px-3 py-2 border rounded-lg ${
                  formData.receptor_id ? "hover:bg-gray-50" : "opacity-50 cursor-not-allowed"
                }`}
              >
                ✎
              </button>
            </div>

            {showClienteForm && (
              <div className="mt-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700">Crear cliente</span>
                  <button
                    type="button"
                    onClick={() => setShowClienteForm(false)}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cerrar ×
                  </button>
                </div>
                <ClienteForm onClienteCreated={onClienteInlineCreated} />
              </div>
            )}

            {showClienteEdit && clienteSel && (
              <div className="mt-3 bg-white border rounded-xl p-4 shadow-sm">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-gray-700">Editar cliente</span>
                  <button
                    type="button"
                    onClick={() => setShowClienteEdit(false)}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Cerrar ×
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">RFC *</label>
                    <input
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.rfc || ""}
                      onChange={(e) => setEditData({ ...editData, rfc: e.target.value.toUpperCase() })}
                      maxLength={13}
                      required
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Razon Social *</label>
                    <input
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.razon_social || ""}
                      onChange={(e) => setEditData({ ...editData, razon_social: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Email *</label>
                    <input
                      type="email"
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.email || ""}
                      onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Telefono</label>
                    <input
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.telefono || ""}
                      onChange={(e) => setEditData({ ...editData, telefono: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Codigo Postal</label>
                    <input
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.codigo_postal || ""}
                      onChange={(e) => setEditData({ ...editData, codigo_postal: e.target.value })}
                      maxLength={5}
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-gray-700 mb-1">Direccion</label>
                    <input
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.direccion || ""}
                      onChange={(e) => setEditData({ ...editData, direccion: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Regimen Fiscal</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.regimen_fiscal || "612"}
                      onChange={(e) => setEditData({ ...editData, regimen_fiscal: e.target.value })}
                    >
                      {REGIMENES_FISCALES.map((r) => (
                        <option key={r.codigo} value={r.codigo}>
                          {r.codigo} - {r.descripcion}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Uso CFDI</label>
                    <select
                      className="w-full px-3 py-2 border rounded-lg"
                      value={editData.uso_cfdi || "D01"}
                      onChange={(e) => setEditData({ ...editData, uso_cfdi: e.target.value })}
                    >
                      {USOS_CFDI.map((u) => (
                        <option key={u.codigo} value={u.codigo}>
                          {u.codigo} - {u.descripcion}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3">
                  <button
                    type="button"
                    onClick={saveClienteEdit}
                    disabled={editLoading || !editData.rfc || !editData.razon_social || !editData.email}
                    className={`px-5 py-2 rounded-lg font-medium ${
                      editLoading || !editData.rfc || !editData.razon_social || !editData.email
                        ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                        : "bg-emerald-600 text-white hover:bg-emerald-700"
                    }`}
                  >
                    {editLoading ? "Guardando..." : "Guardar cambios"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de factura</label>
            <select
              value={tipoComprobante}
              onChange={(e) => setTipoComprobante(e.target.value as "I" | "E")}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="I">Factura (Ingreso)</option>
              <option value="E">Nota de credito (Egreso)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Forma de pago</label>
              <select
                value={formaPago}
                onChange={(e) => setFormaPago(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {FORMAS_PAGO.map((f) => (
                  <option key={f.codigo} value={f.codigo}>
                    {f.codigo} - {f.descripcion}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Metodo de pago</label>
              <select
                value={metodoPago}
                onChange={(e) => setMetodoPago(e.target.value as "PUE" | "PPD")}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {METODOS_PAGO.map((m) => (
                  <option key={m.codigo} value={m.codigo}>
                    {m.codigo} - {m.descripcion}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Cita (opcional)</label>
            <select
              value={formData.cita_id}
              onChange={(e) => setFormData({ ...formData, cita_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Sin cita</option>
              {appointments?.map((a) => (
                <option key={a.id} value={a.id}>
                  #{a.id} - {a.patient} - {a.date}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Pago (opcional)</label>
            <select
              value={formData.pago_id}
              onChange={(e) => setFormData({ ...formData, pago_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Sin pago</option>
              {payments?.map((p) => (
                <option key={p.id} value={p.id}>
                  #{p.id} - {p.patient} - ${p.amount}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
            <input
              className="w-full px-3 py-2 border rounded-lg"
              value={formData.notas}
              onChange={(e) => setFormData({ ...formData, notas: e.target.value })}
              placeholder="Notas adicionales"
            />
          </div>
        </div>

        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <label className="block text-sm font-medium text-gray-700 mb-1">Seleccionar producto o servicio:</label>
          <div className="flex items-center gap-2">
            <select
              value={productoSel}
              onChange={(e) => {
                const id = e.target.value;
                setProductoSel(id);
                const p = productos.find((x) => x.id === id);
                if (p) addConceptFromProduct(p);
                setProductoSel("");
              }}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="">Selecciona un producto</option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} - {p.clave_prodserv}/{p.clave_unidad} - ${p.precio}
                </option>
              ))}
            </select>

            <button
              type="button"
              title="Nuevo producto"
              onClick={() => setShowProductoForm((s) => !s)}
              className="px-3 py-2 border rounded-lg hover:bg-white text-sky-500"
            >
              +
            </button>
          </div>

          {showProductoForm && (
            <div className="mt-3 bg-white border rounded-xl p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-semibold">Nuevo Producto</h4>
                <button
                  type="button"
                  onClick={() => setShowProductoForm(false)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cerrar ×
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Nombre Interno *</label>
                  <input
                    className="w-full px-3 py-2 border rounded-lg"
                    value={prodForm.nombre}
                    onChange={(e) => setProdForm({ ...prodForm, nombre: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Codigo Interno (Opcional)</label>
                  <input
                    className="w-full px-3 py-2 border rounded-lg"
                    value={prodForm.codigo_interno}
                    onChange={(e) => setProdForm({ ...prodForm, codigo_interno: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-gray-600 mb-1">Descripcion</label>
                  <input
                    className="w-full px-3 py-2 border rounded-lg"
                    value={prodForm.descripcion}
                    onChange={(e) => setProdForm({ ...prodForm, descripcion: e.target.value })}
                    placeholder="Texto que aparecera en el concepto"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Precio Unitario</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-full px-3 py-2 border rounded-lg"
                    value={prodForm.precio}
                    onChange={(e) => setProdForm({ ...prodForm, precio: Number(e.target.value) })}
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Clave Prod/Serv (SAT) *</label>
                  <div className="flex gap-2">
                    <input
                      className="w-full px-3 py-2 border rounded-lg font-mono"
                      value={prodForm.clave_prodserv}
                      onChange={(e) => setProdForm({ ...prodForm, clave_prodserv: e.target.value })}
                      placeholder="Ej. 85122000"
                      maxLength={8}
                      inputMode="numeric"
                      pattern="\d{8}"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSatHelper((s) => !s)}
                      className="px-3 py-2 border rounded-lg hover:bg-gray-50"
                      title="Ver catalogo dental SAT"
                    >
                      +
                    </button>
                  </div>

                  {showSatHelper && (
                    <div className="mt-2 border rounded-lg p-3 bg-white shadow-sm">
                      <div className="flex items-center gap-2">
                        <input
                          className="w-full px-3 py-2 border rounded-lg"
                          placeholder="Buscar por codigo o descripcion..."
                          value={satQuery}
                          onChange={(e) => setSatQuery(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSatHelper(false)}
                          className="px-3 py-2 border rounded-lg hover:bg-gray-50"
                        >
                          Cerrar ×
                        </button>
                      </div>

                      <div className="mt-3 max-h-64 overflow-auto divide-y">
                        {filteredSat.map((item) => (
                          <button
                            type="button"
                            key={item.code}
                            onClick={() => {
                              setProdForm({ ...prodForm, clave_prodserv: item.code });
                              setShowSatHelper(false);
                            }}
                            className="w-full text-left px-2 py-2 hover:bg-gray-50"
                          >
                            <div className="font-mono">{item.code}</div>
                            <div className="text-xs text-gray-600">{item.description}</div>
                          </button>
                        ))}
                        {filteredSat.length === 0 && (
                          <div className="text-sm text-gray-500 p-2">Sin resultados.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Unidad (SAT) *</label>
                  <select
                    className="w-full px-3 py-2 border rounded-lg"
                    value={prodForm.clave_unidad}
                    onChange={(e) => setProdForm({ ...prodForm, clave_unidad: e.target.value })}
                    required
                  >
                    {CLAVES_UNIDAD.map((u) => (
                      <option key={u.codigo} value={u.codigo}>
                        {u.codigo} - {u.descripcion}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-600 mb-1">Objeto Impuesto (CFDI 4.0) *</label>
                  <select
                    className="w-full px-3 py-2 border rounded-lg"
                    value={prodForm.objeto_imp}
                    onChange={(e) => setProdForm({ ...prodForm, objeto_imp: e.target.value as "01" | "02" | "03" })}
                    required
                  >
                    <option value="01">01 - No objeto de impuesto</option>
                    <option value="02">02 - Si objeto, Exento</option>
                    <option value="03">03 - Si objeto, gravado (IVA 16%)</option>
                  </select>
                </div>

                <div className="md:col-span-2 mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={guardarProducto}
                    className="px-5 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowProductoForm(false)}
                    className="px-5 py-2 rounded-lg border hover:bg-gray-50"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium">Conceptos</h4>
          </div>

          <div className="space-y-3">
            {conceptos.map((c) => (
              <div key={c.id} className="border rounded-lg p-4 bg-gray-50">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                  <div className="md:col-span-2">
                    <label className="block text-xs text-gray-600 mb-1">Descripcion</label>
                    <input
                      className="w-full px-2 py-1 border rounded text-sm"
                      value={c.descripcion}
                      onChange={(e) => actualizarConcepto(c.id, "descripcion", e.target.value)}
                      placeholder="Descripcion del servicio"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Cantidad</label>
                    <input
                      type="number"
                      className="w-full px-2 py-1 border rounded text-sm"
                      min="0.01"
                      step="0.01"
                      value={c.cantidad}
                      onChange={(e) => actualizarConcepto(c.id, "cantidad", Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Valor Unitario</label>
                    <input
                      type="number"
                      className="w-full px-2 py-1 border rounded text-sm"
                      min="0.01"
                      step="0.01"
                      value={c.valor_unitario}
                      onChange={(e) => actualizarConcepto(c.id, "valor_unitario", Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">Importe</label>
                    <input className="w-full px-2 py-1 border rounded text-sm bg-gray-100" readOnly value={c.importe} />
                  </div>
                  <div className="flex items-end">
                    {conceptos.length > 0 && (
                      <button
                        type="button"
                        onClick={() => eliminarConcepto(c.id)}
                        className="px-2 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        Eliminar
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-2">
                  <span className="mr-2">Clave ProdServ: {c.clave_prodserv}</span>
                  <span className="mr-2">Unidad: {c.clave_unidad}</span>
                  <span>Objeto Imp: {c.objeto_imp}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium mb-2">Totales</h4>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
            <div>
              <span className="text-gray-600">Subtotal:</span>
              <div className="font-semibold">${totales.subtotal.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-gray-600">IVA:</span>
              <div className="font-semibold">${totales.totalImpuestosTrasladados.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-gray-600">Retenciones:</span>
              <div className="font-semibold">${totales.totalImpuestosRetenidos.toLocaleString()}</div>
            </div>
            <div>
              <span className="text-gray-600">Metodo:</span>
              <div className="font-semibold">{metodoPago}</div>
            </div>
            <div>
              <span className="text-gray-600">Total:</span>
              <div className="font-bold text-lg text-blue-600">${totales.total.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading || !formData.receptor_id || conceptos.length === 0}
            className={`px-6 py-2 rounded-lg font-medium transition-colors ${
              loading || !formData.receptor_id || conceptos.length === 0
                ? "bg-gray-300 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 text-white hover:bg-blue-700"
            }`}
          >
            {loading ? "Creando..." : "Crear Factura"}
          </button>

          <button
            type="button"
            onClick={() => setShowPreview((p) => !p)}
            className="px-6 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {showPreview ? "Ocultar" : "Vista Previa"}
          </button>
        </div>
      </form>

      {showPreview && clienteSel && (
        <div className="bg-white border rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Vista Previa de la Factura</h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 text-sm">
            <div>
              <span className="font-medium">Tipo:</span>{" "}
              {tipoComprobante === "I" ? "Factura (Ingreso)" : "Nota de credito (Egreso)"}
            </div>
            <div>
              <span className="font-medium">Forma de pago:</span>{" "}
              {FORMAS_PAGO.find((f) => f.codigo === formaPago)?.descripcion} ({formaPago})
            </div>
            <div>
              <span className="font-medium">Metodo de pago:</span> {metodoPago}
            </div>
          </div>

          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="text-center mb-4">
              <h4 className="text-xl font-bold">COMPROBANTE</h4>
              <p className="text-sm text-gray-600">CFDI 4.0 - Previo a timbrar</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <h5 className="font-semibold mb-2">EMISOR</h5>
                <div className="text-sm space-y-1">
                  <div>Regimen Fiscal: 601</div>
                </div>
              </div>
              <div>
                <h5 className="font-semibold mb-2">RECEPTOR</h5>
                <div className="text-sm space-y-1">
                  <div>{clienteSel.razon_social}</div>
                  <div>RFC: {clienteSel.rfc}</div>
                  <div>Uso CFDI: {clienteSel.uso_cfdi}</div>
                </div>
              </div>
            </div>

            <div className="mb-6">
              <h5 className="font-semibold mb-2">CONCEPTOS</h5>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-200">
                    <tr>
                      <th className="p-2 text-left">Descripcion</th>
                      <th className="p-2 text-right">Cantidad</th>
                      <th className="p-2 text-right">P. Unitario</th>
                      <th className="p-2 text-right">Importe</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {conceptos.map((c) => (
                      <tr key={c.id}>
                        <td className="p-2">{c.descripcion}</td>
                        <td className="p-2 text-right">{c.cantidad}</td>
                        <td className="p-2 text-right">${c.valor_unitario.toFixed(2)}</td>
                        <td className="p-2 text-right">${c.importe.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t pt-4">
              <div className="flex justify-end">
                <div className="w-64 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-semibold">${totales.subtotal.toFixed(2)}</span>
                  </div>
                  {totales.totalImpuestosTrasladados > 0 && (
                    <div className="flex justify-between">
                      <span>IVA Trasladado:</span>
                      <span className="font-semibold">${totales.totalImpuestosTrasladados.toFixed(2)}</span>
                    </div>
                  )}
                  {totales.totalImpuestosRetenidos > 0 && (
                    <div className="flex justify-between">
                      <span>Retenciones:</span>
                      <span className="font-semibold">-${totales.totalImpuestosRetenidos.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-2">
                    <span className="font-bold">TOTAL:</span>
                    <span className="font-bold text-lg">${totales.total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FacturacionUI(props: { clientes: Cliente[]; appointments: any[]; payments: any[]; onFacturaCreated: (f: Factura) => void; }) {
  return <FacturaForm {...props} />;
}

export {
  ClienteForm,
  FacturaForm,
  FacturacionUI,
  REGIMENES_FISCALES,
  USOS_CFDI,
  fetchClientes,
  createCliente,
  updateCliente,
  fetchFacturas,
  createFactura,
  timbrarFactura,
  cancelarFactura,
  fetchConfiguracionSAT,
  updateConfiguracionSAT,
  facturamaTest,
  facturamaTimbrar,
  facturamaDescargarZip,
  FacturamaCredenciales,
  uploadCertificadosCSD,
  checkCertificadosStatus,
  uploadLogoFlexible,
};

// ✅ Bloque de estilo inline React (válido y sin error)
export default function OcultarCamposConfiguracionFiscal() {
  return (
    <style>
      {`
        /* Elimina frase de certificados opcionales */
        li:has(> :is(span, strong, em):contains("Los certificados CSD")) {
          display: none !important;
        }

        /* Ocultar campo Serie */
        label:has(+ input[name="serie_facturas"]),
        input[name="serie_facturas"] {
          display: none !important;
        }

        /* Ocultar campos URL Timbrado / Cancelacion */
        label:has(+ input[name="pac_url_timbrado"]),
        input[name="pac_url_timbrado"],
        label:has(+ input[name="pac_url_cancelacion"]),
        input[name="pac_url_cancelacion"] {
          display: none !important;
        }

        /* Ocultar campo de Logo */
        h4:contains("Logo para PDF"),
        h4:contains("Logo"),
        input[type="file"][accept*="image"] {
          display: none !important;
        }

        /* Ocultar bloque completo de Certificados CSD */
        h4:contains("Certificados CSD"),
        div:has(> h4:contains("Certificados CSD")),
        button:contains("Configurar"),
        div.bg-gray-50:has(input[type="file"][accept=".cer"]) {
          display: none !important;
        }
      `}
    </style>
  );
}
