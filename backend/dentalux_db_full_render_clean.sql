--
-- PostgreSQL database dump
--

\restrict OG0seKVXFRamNXgvIGqrJS2jf2YqPzK8sDEJccrnxdMfK5UXmcoawnbJlMSK1ZW

-- Dumped from database version 17.6 (Debian 17.6-2.pgdg12+1)
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'Scripts ejecutados para Dashboard Global - versi¢n mejorada sin errores NaN';


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: Role; Type: TYPE; Schema: public; Owner: dentalux_db_user
--

CREATE TYPE public."Role" AS ENUM (
    'ADMIN',
    'AGENDA'
);



--
-- Name: check_inventory_alerts(); Type: FUNCTION; Schema: public; Owner: dentalux_db_user
--

CREATE FUNCTION public.check_inventory_alerts() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Si el stock cambi¢, verificar alertas
  IF (OLD.stock IS DISTINCT FROM NEW.stock) THEN
    
    -- Eliminar alertas previas para este producto
    DELETE FROM alertas_inventario 
    WHERE producto_id = NEW.id AND tipo IN ('stock_bajo', 'agotado') AND resuelta = false;
    
    -- Crear nueva alerta si es necesario
    IF NEW.stock = 0 THEN
      INSERT INTO alertas_inventario (tipo, titulo, descripcion, producto_id, sucursal_id, prioridad)
      VALUES (
        'agotado',
        'Producto Agotado: ' || NEW.name,
        'El producto ' || NEW.name || ' est  completamente agotado',
        NEW.id,
        NEW.sucursal_id,
        'alta'
      );
    ELSIF NEW.stock <= NEW.min_stock THEN
      INSERT INTO alertas_inventario (tipo, titulo, descripcion, producto_id, sucursal_id, prioridad)
      VALUES (
        'stock_bajo',
        'Stock Bajo: ' || NEW.name,
        'El producto ' || NEW.name || ' tiene ' || NEW.stock || ' unidades (m¡nimo: ' || NEW.min_stock || ')',
        NEW.id,
        NEW.sucursal_id,
        CASE WHEN NEW.stock <= NEW.min_stock * 0.5 THEN 'alta' ELSE 'media' END
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;



--
-- Name: safe_percentage(numeric, numeric); Type: FUNCTION; Schema: public; Owner: dentalux_db_user
--

CREATE FUNCTION public.safe_percentage(numerator numeric, denominator numeric) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF denominator IS NULL OR denominator = 0 THEN
        RETURN 0;
    END IF;
    RETURN ROUND((COALESCE(numerator, 0) / denominator) * 100, 2);
END;
$$;



--
-- Name: safe_sum(numeric, numeric); Type: FUNCTION; Schema: public; Owner: dentalux_db_user
--

CREATE FUNCTION public.safe_sum(value1 numeric, value2 numeric) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN COALESCE(value1, 0) + COALESCE(value2, 0);
END;
$$;



--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: dentalux_db_user
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;



SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Doctor; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public."Doctor" (
    id text NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true NOT NULL
);



--
-- Name: Payment; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public."Payment" (
    id text NOT NULL,
    "doctorId" text NOT NULL,
    amount double precision NOT NULL,
    date timestamp(3) without time zone NOT NULL,
    patient text,
    service text,
    note text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);



--
-- Name: User; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public."User" (
    id text NOT NULL,
    email text NOT NULL,
    name text,
    "passwordHash" text NOT NULL,
    role public."Role" DEFAULT 'AGENDA'::public."Role" NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);



--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);



--
-- Name: alertas_inventario; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.alertas_inventario (
    id integer NOT NULL,
    tipo text NOT NULL,
    titulo text NOT NULL,
    descripcion text,
    prioridad text DEFAULT 'media'::text NOT NULL,
    producto_id integer,
    sucursal_id text NOT NULL,
    resuelta boolean DEFAULT false,
    resuelto_por text,
    resuelto_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT alertas_inventario_prioridad_check CHECK ((prioridad = ANY (ARRAY['alta'::text, 'media'::text, 'baja'::text]))),
    CONSTRAINT alertas_inventario_tipo_check CHECK ((tipo = ANY (ARRAY['stock_bajo'::text, 'agotado'::text, 'vencimiento'::text, 'mantenimiento'::text, 'calidad'::text])))
);



--
-- Name: alertas_inventario_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.alertas_inventario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: alertas_inventario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.alertas_inventario_id_seq OWNED BY public.alertas_inventario.id;


--
-- Name: app_state; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.app_state (
    id integer NOT NULL,
    user_id character varying(50) DEFAULT 'default'::character varying,
    state_data jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);



--
-- Name: app_state_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.app_state_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: app_state_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.app_state_id_seq OWNED BY public.app_state.id;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.appointments (
    id integer NOT NULL,
    patient character varying(255) NOT NULL,
    doctor_id integer,
    date date NOT NULL,
    start_time time without time zone NOT NULL,
    duration_hours numeric(3,1) DEFAULT 1.0,
    service_id integer,
    phone character varying(20),
    status character varying(20) DEFAULT 'Pendiente'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text
);



--
-- Name: appointments_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.appointments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: appointments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.appointments_id_seq OWNED BY public.appointments.id;


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.clientes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    rfc text NOT NULL,
    razon_social text NOT NULL,
    email text,
    telefono text,
    direccion text,
    codigo_postal text NOT NULL,
    regimen_fiscal text NOT NULL,
    uso_cfdi text NOT NULL,
    activo boolean DEFAULT true,
    sucursal_id text,
    createdat timestamp without time zone DEFAULT now()
);



--
-- Name: configuracion_sat; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.configuracion_sat (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    sucursal_id text,
    rfc text,
    razon_social text,
    regimen_fiscal text,
    codigo_postal text,
    cer_path text,
    key_path text,
    key_password text,
    pac_proveedor text,
    pac_usuario text,
    pac_password text,
    pac_url_timbrado text,
    pac_url_cancelacion text,
    serie_facturas text,
    ultimo_folio integer DEFAULT 1,
    ambiente text DEFAULT 'pruebas'::text,
    activo boolean DEFAULT false,
    createdat timestamp without time zone DEFAULT now()
);



--
-- Name: consentimientos_informados; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.consentimientos_informados (
    id integer NOT NULL,
    expediente_id integer,
    tipo_tratamiento text NOT NULL,
    descripcion_tratamiento text,
    riesgos_beneficios text,
    alternativas text,
    costo_estimado numeric(10,2),
    fecha_consentimiento date NOT NULL,
    firma_paciente boolean DEFAULT false,
    firma_doctor boolean DEFAULT false,
    testigo_nombre text,
    testigo_identificacion text,
    doctor_id text,
    sucursal_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: consentimientos_informados_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.consentimientos_informados_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: consentimientos_informados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.consentimientos_informados_id_seq OWNED BY public.consentimientos_informados.id;


--
-- Name: doctors; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.doctors (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    color character varying(7) DEFAULT '#3b82f6'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    comision numeric(5,4) DEFAULT 0.1500,
    especialidad character varying(100) DEFAULT 'General'::character varying,
    activo boolean DEFAULT true,
    telefono character varying(20),
    email character varying(255)
);



--
-- Name: doctors_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.doctors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: doctors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.doctors_id_seq OWNED BY public.doctors.id;


--
-- Name: documentos_radiografias; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.documentos_radiografias (
    id integer NOT NULL,
    expediente_id integer,
    tipo text NOT NULL,
    nombre text NOT NULL,
    descripcion text,
    fecha_toma date NOT NULL,
    datos_base64 text,
    url text,
    doctor_id text,
    sucursal_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT documentos_radiografias_tipo_check CHECK ((tipo = ANY (ARRAY['radiografia'::text, 'fotografia'::text, 'documento'::text, 'laboratorio'::text])))
);



--
-- Name: documentos_radiografias_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.documentos_radiografias_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: documentos_radiografias_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.documentos_radiografias_id_seq OWNED BY public.documentos_radiografias.id;


--
-- Name: expedientes_medicos; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.expedientes_medicos (
    id integer NOT NULL,
    paciente_id text NOT NULL,
    nombre_paciente text NOT NULL,
    telefono text,
    email text,
    fecha_nacimiento date,
    edad integer,
    genero text,
    direccion text,
    ocupacion text,
    estado_civil text,
    contacto_emergencia text,
    telefono_emergencia text,
    sucursal_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT expedientes_medicos_genero_check CHECK ((genero = ANY (ARRAY['masculino'::text, 'femenino'::text, 'otro'::text])))
);



--
-- Name: expedientes_medicos_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.expedientes_medicos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: expedientes_medicos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.expedientes_medicos_id_seq OWNED BY public.expedientes_medicos.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    concept character varying(255) NOT NULL,
    amount numeric(10,2) NOT NULL,
    date date NOT NULL,
    doctor_id integer,
    payment_method character varying(50) DEFAULT 'efectivo'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    description text DEFAULT 'Gasto general'::text,
    category text DEFAULT 'Varios'::text,
    CONSTRAINT expenses_amount_positive CHECK ((amount >= (0)::numeric))
);



--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: factura_conceptos; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.factura_conceptos (
    id integer NOT NULL,
    factura_id text,
    descripcion text NOT NULL,
    cantidad numeric NOT NULL,
    valor_unitario numeric NOT NULL,
    importe numeric NOT NULL,
    clave_prod_serv text,
    unidad text,
    objeto_imp text,
    sucursal_id text
);



--
-- Name: factura_conceptos_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.factura_conceptos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: factura_conceptos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.factura_conceptos_id_seq OWNED BY public.factura_conceptos.id;


--
-- Name: facturacion_clientes; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.facturacion_clientes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    rfc text NOT NULL,
    razon_social text NOT NULL,
    email text,
    telefono text,
    direccion text,
    uso_cfdi text,
    sucursal_id text,
    created_at timestamp without time zone DEFAULT now(),
    codigo_postal text,
    regimen_fiscal text
);



--
-- Name: facturacion_configuracion; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.facturacion_configuracion (
    sucursal_id text NOT NULL,
    rfc text NOT NULL,
    razon_social text NOT NULL,
    regimen_fiscal text NOT NULL,
    codigo_postal text NOT NULL,
    pac_proveedor text DEFAULT 'facturama'::text NOT NULL,
    pac_usuario text NOT NULL,
    pac_password text NOT NULL,
    pac_url_timbrado text,
    pac_url_cancelacion text,
    serie_facturas text DEFAULT ''::text,
    ultimo_folio integer DEFAULT 1,
    ambiente text NOT NULL,
    activo boolean DEFAULT true,
    logo_url text,
    logo_image bytea,
    logo_mime text,
    created_at timestamp without time zone DEFAULT now(),
    cer_file bytea,
    key_file bytea,
    key_password text,
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT facturacion_configuracion_ambiente_check CHECK ((ambiente = ANY (ARRAY['pruebas'::text, 'produccion'::text])))
);



--
-- Name: facturacion_productos; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.facturacion_productos (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    descripcion text NOT NULL,
    clave_prod_serv text,
    unidad text,
    objeto_imp text,
    precio numeric DEFAULT 0,
    sucursal_id text,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: facturas; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.facturas (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    folio integer,
    serie text,
    fecha timestamp without time zone DEFAULT now(),
    emisor_rfc text,
    emisor_nombre text,
    emisor_regimen text,
    receptor_id text,
    receptor_rfc text,
    receptor_nombre text,
    receptor_uso_cfdi text,
    receptor_regimen text,
    subtotal numeric DEFAULT 0,
    descuento numeric,
    total_impuestos_trasladados numeric,
    total_impuestos_retenidos numeric,
    total numeric DEFAULT 0,
    estado text DEFAULT 'borrador'::text,
    uuid text,
    fecha_timbrado timestamp without time zone,
    sello_cfd text,
    sello_sat text,
    cadena_original text,
    qr_code text,
    xml_path text,
    pdf_path text,
    cita_id integer,
    pago_id integer,
    notas text,
    sucursal_id text,
    createdat timestamp without time zone DEFAULT now(),
    updatedat timestamp without time zone DEFAULT now(),
    conceptos jsonb,
    cliente text,
    tipo text,
    forma_pago text,
    metodo_pago text,
    created_at timestamp without time zone DEFAULT now(),
    timbrada_at timestamp without time zone,
    status text,
    cancelada_at timestamp without time zone,
    motivo_cancelacion text,
    cfdi_id text,
    temp_uuid character varying(50)
);



--
-- Name: historia_clinica_dental; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.historia_clinica_dental (
    id integer NOT NULL,
    expediente_id integer,
    motivo_consulta text,
    enfermedad_actual text,
    antecedentes_personales text,
    antecedentes_familiares text,
    antecedentes_odontologicos text,
    habitos_nocivos text,
    alergias text,
    medicamentos_actuales text,
    examen_extraoral text,
    examen_intraoral text,
    diagnostico_presuntivo text,
    plan_tratamiento text,
    observaciones text,
    doctor_id text,
    fecha_registro date NOT NULL,
    sucursal_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);



--
-- Name: historia_clinica_dental_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.historia_clinica_dental_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: historia_clinica_dental_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.historia_clinica_dental_id_seq OWNED BY public.historia_clinica_dental.id;


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.inventory (
    id integer NOT NULL,
    sku character varying(50),
    name character varying(255) NOT NULL,
    category character varying(50) NOT NULL,
    type character varying(50) NOT NULL,
    quantity integer DEFAULT 0,
    min_stock integer DEFAULT 10,
    max_stock integer DEFAULT 100,
    price numeric(10,2) DEFAULT 0,
    supplier character varying(255),
    last_purchase date,
    usage_per_patient numeric(5,2) DEFAULT 1,
    expiration_date date,
    sucursal_id text,
    created_at timestamp without time zone DEFAULT now(),
    description text,
    stock integer DEFAULT 0,
    proveedor character varying(255) DEFAULT 'Sin Proveedor'::character varying,
    ubicacion character varying(100),
    lote character varying(50),
    fecha_vencimiento date,
    CONSTRAINT inventory_category_check CHECK (((category)::text = ANY (ARRAY[('instrumental'::character varying)::text, ('desechable'::character varying)::text, ('anestesia'::character varying)::text, ('resina'::character varying)::text, ('endodoncia'::character varying)::text, ('ortodoncia'::character varying)::text]))),
    CONSTRAINT inventory_check CHECK ((max_stock >= min_stock)),
    CONSTRAINT inventory_min_stock_check CHECK ((min_stock >= 0)),
    CONSTRAINT inventory_price_check CHECK ((price >= (0)::numeric)),
    CONSTRAINT inventory_quantity_check CHECK ((quantity >= 0)),
    CONSTRAINT inventory_type_check CHECK (((type)::text = ANY (ARRAY[('equipment'::character varying)::text, ('material'::character varying)::text]))),
    CONSTRAINT inventory_usage_per_patient_check CHECK ((usage_per_patient > (0)::numeric))
);



--
-- Name: inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.inventory_id_seq OWNED BY public.inventory.id;


--
-- Name: lab_abonos; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.lab_abonos (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    trabajo_id character varying(50),
    fecha date NOT NULL,
    monto numeric(10,2) NOT NULL,
    nota text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    metodo_pago character varying(50)
);



--
-- Name: lab_trabajos; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.lab_trabajos (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    paciente character varying(255) NOT NULL,
    laboratorio_id character varying(50),
    servicio_id character varying(50),
    presupuesto numeric(10,2) DEFAULT 0,
    fecha_inicio date NOT NULL,
    fecha_entrega_estimada date NOT NULL,
    etapa character varying(100) DEFAULT 'Toma de impresión'::character varying,
    notas text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    metodo_pago character varying(50)
);



--
-- Name: laboratorios; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.laboratorios (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    nombre character varying(255) NOT NULL,
    contacto text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    metodo_pago character varying(50)
);



--
-- Name: objetivos; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.objetivos (
    id integer NOT NULL,
    nombre character varying(255) NOT NULL,
    monto_meta numeric(10,2) DEFAULT 0 NOT NULL,
    monto_actual numeric(10,2) DEFAULT 0 NOT NULL,
    completado boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    doctor_id integer,
    meta numeric DEFAULT 0,
    sueldo_base numeric DEFAULT 0,
    periodo_inicio date,
    periodo_fin date
);



--
-- Name: objetivos_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.objetivos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: objetivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.objetivos_id_seq OWNED BY public.objetivos.id;


--
-- Name: odontograma; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.odontograma (
    id integer NOT NULL,
    expediente_id integer,
    diente_numero integer NOT NULL,
    estado text NOT NULL,
    superficie text,
    observaciones text,
    fecha_registro date NOT NULL,
    doctor_id text,
    sucursal_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT odontograma_diente_numero_check CHECK (((diente_numero >= 11) AND (diente_numero <= 48))),
    CONSTRAINT odontograma_estado_check CHECK ((estado = ANY (ARRAY['sano'::text, 'cariado'::text, 'obturado'::text, 'extraido'::text, 'endodoncia'::text, 'corona'::text, 'implante'::text, 'protesis'::text])))
);



--
-- Name: odontograma_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.odontograma_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: odontograma_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.odontograma_id_seq OWNED BY public.odontograma.id;


--
-- Name: pagos_laboratorio; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.pagos_laboratorio (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    trabajo_id text NOT NULL,
    monto numeric NOT NULL,
    fecha date DEFAULT CURRENT_DATE,
    sucursal_id text,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: payments; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    appointment_id integer,
    patient character varying(255) NOT NULL,
    service_id integer,
    amount numeric(10,2) NOT NULL,
    payment_method character varying(50) DEFAULT 'efectivo'::character varying,
    date date NOT NULL,
    doctor_id integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    CONSTRAINT payments_amount_positive CHECK ((amount >= (0)::numeric))
);



--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: productos_sat; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.productos_sat (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    nombre text NOT NULL,
    codigo_interno text,
    descripcion text,
    precio numeric DEFAULT 0,
    clave_prodserv text NOT NULL,
    clave_unidad text NOT NULL,
    objeto_imp text NOT NULL,
    sucursal_id text,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: satisfaccion_servicio; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.satisfaccion_servicio (
    id integer NOT NULL,
    appointment_id integer NOT NULL,
    service_id integer NOT NULL,
    patient_id text,
    doctor_id integer,
    rating numeric(2,1) NOT NULL,
    comentario text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    sucursal_id text,
    CONSTRAINT satisfaccion_servicio_rating_check CHECK (((rating >= (1)::numeric) AND (rating <= (5)::numeric)))
);



--
-- Name: satisfaccion_servicio_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.satisfaccion_servicio_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: satisfaccion_servicio_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.satisfaccion_servicio_id_seq OWNED BY public.satisfaccion_servicio.id;


--
-- Name: services; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.services (
    id integer NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    sucursal_id text,
    duration integer DEFAULT 60,
    margin numeric(3,2) DEFAULT 0.70,
    category text DEFAULT 'General'::text,
    active boolean DEFAULT true,
    price numeric(12,2) DEFAULT 0,
    description text,
    activo boolean DEFAULT true
);



--
-- Name: services_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: services_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.services_id_seq OWNED BY public.services.id;


--
-- Name: sucursales; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.sucursales (
    id character varying(50) NOT NULL,
    nombre character varying(255) NOT NULL,
    direccion text,
    telefono character varying(20),
    email character varying(255),
    meta_ingresos numeric(10,2) DEFAULT 50000.00,
    meta_citas integer DEFAULT 200,
    meta_conversion numeric(5,2) DEFAULT 85.00,
    meta_inventario numeric(5,2) DEFAULT 95.00,
    activa boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);



--
-- Name: tratamientos_dentales; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.tratamientos_dentales (
    id integer NOT NULL,
    expediente_id integer,
    fecha date NOT NULL,
    diente_numero integer,
    procedimiento text NOT NULL,
    descripcion text,
    materiales_usados text,
    duracion_minutos integer,
    costo numeric(10,2),
    estado text DEFAULT 'planificado'::text NOT NULL,
    observaciones text,
    doctor_id text,
    sucursal_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT tratamientos_dentales_diente_numero_check CHECK (((diente_numero >= 11) AND (diente_numero <= 48))),
    CONSTRAINT tratamientos_dentales_estado_check CHECK ((estado = ANY (ARRAY['planificado'::text, 'en_progreso'::text, 'completado'::text, 'cancelado'::text])))
);



--
-- Name: tratamientos_dentales_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.tratamientos_dentales_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: tratamientos_dentales_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.tratamientos_dentales_id_seq OWNED BY public.tratamientos_dentales.id;


--
-- Name: v_inventario_alertas; Type: VIEW; Schema: public; Owner: dentalux_db_user
--

CREATE VIEW public.v_inventario_alertas AS
 SELECT id,
    sku,
    name,
    category,
    type,
    quantity,
    min_stock,
    max_stock,
    price,
    supplier,
    last_purchase,
    usage_per_patient,
    expiration_date,
    sucursal_id,
    created_at,
    description,
    stock,
    proveedor,
    ubicacion,
    lote,
    fecha_vencimiento,
        CASE
            WHEN (COALESCE(stock, 0) = 0) THEN 'agotado'::text
            WHEN (COALESCE(stock, 0) <= COALESCE(min_stock, 5)) THEN 'stock_bajo'::text
            ELSE 'normal'::text
        END AS estado_stock,
    ((COALESCE(stock, 0))::numeric * COALESCE(price, (0)::numeric)) AS valor_stock
   FROM public.inventory;



--
-- Name: v_metricas_financieras; Type: VIEW; Schema: public; Owner: dentalux_db_user
--

CREATE VIEW public.v_metricas_financieras AS
 SELECT sucursal_id,
    date_trunc('month'::text, (date)::timestamp with time zone) AS mes,
    sum(COALESCE(amount, (0)::numeric)) AS ingresos_mes,
    count(*) AS total_pagos
   FROM public.payments
  GROUP BY sucursal_id, (date_trunc('month'::text, (date)::timestamp with time zone));



--
-- Name: v_metricas_operacionales; Type: VIEW; Schema: public; Owner: dentalux_db_user
--

CREATE VIEW public.v_metricas_operacionales AS
 SELECT sucursal_id,
    date_trunc('month'::text, (date)::timestamp with time zone) AS mes,
    count(*) AS total_citas,
    count(
        CASE
            WHEN ((status)::text = ANY (ARRAY[('Atendida'::character varying)::text, ('Completada'::character varying)::text, ('Finalizada'::character varying)::text])) THEN 1
            ELSE NULL::integer
        END) AS citas_atendidas,
    count(
        CASE
            WHEN ((status)::text = 'Cancelada'::text) THEN 1
            ELSE NULL::integer
        END) AS citas_canceladas,
    count(DISTINCT patient) AS pacientes_unicos
   FROM public.appointments
  GROUP BY sucursal_id, (date_trunc('month'::text, (date)::timestamp with time zone));



--
-- Name: wa_processed; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.wa_processed (
    wamid text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: whatsapp_faqs; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.whatsapp_faqs (
    id bigint NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    patterns text[] NOT NULL,
    answer_text text NOT NULL,
    price_text text,
    buttons jsonb DEFAULT '[]'::jsonb NOT NULL,
    media_link text,
    active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    sucursal_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);



--
-- Name: whatsapp_faqs_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.whatsapp_faqs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: whatsapp_faqs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.whatsapp_faqs_id_seq OWNED BY public.whatsapp_faqs.id;


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.whatsapp_messages (
    id bigint NOT NULL,
    wa_message_id text,
    direction text NOT NULL,
    phone text NOT NULL,
    message text,
    status text DEFAULT 'sent'::text,
    appointment_id bigint,
    sucursal_id text,
    manual boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    raw jsonb,
    CONSTRAINT whatsapp_messages_direction_check CHECK ((direction = ANY (ARRAY['outgoing'::text, 'incoming'::text])))
);



--
-- Name: whatsapp_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.whatsapp_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: whatsapp_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.whatsapp_messages_id_seq OWNED BY public.whatsapp_messages.id;


--
-- Name: whatsapp_rule_execs; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.whatsapp_rule_execs (
    id bigint NOT NULL,
    rule_id text,
    phone text NOT NULL,
    sucursal_id text,
    executed_at timestamp with time zone DEFAULT now()
);



--
-- Name: whatsapp_rule_execs_id_seq; Type: SEQUENCE; Schema: public; Owner: dentalux_db_user
--

CREATE SEQUENCE public.whatsapp_rule_execs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: whatsapp_rule_execs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: dentalux_db_user
--

ALTER SEQUENCE public.whatsapp_rule_execs_id_seq OWNED BY public.whatsapp_rule_execs.id;


--
-- Name: whatsapp_rules; Type: TABLE; Schema: public; Owner: dentalux_db_user
--

CREATE TABLE public.whatsapp_rules (
    id text DEFAULT SUBSTRING(md5(((random())::text || (clock_timestamp())::text)) FROM 1 FOR 24) NOT NULL,
    name text NOT NULL,
    active boolean DEFAULT true,
    priority integer DEFAULT 100,
    match jsonb NOT NULL,
    action jsonb NOT NULL,
    cooldown_secs integer DEFAULT 0,
    sucursal_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);



--
-- Name: alertas_inventario id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.alertas_inventario ALTER COLUMN id SET DEFAULT nextval('public.alertas_inventario_id_seq'::regclass);


--
-- Name: app_state id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.app_state ALTER COLUMN id SET DEFAULT nextval('public.app_state_id_seq'::regclass);


--
-- Name: appointments id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.appointments ALTER COLUMN id SET DEFAULT nextval('public.appointments_id_seq'::regclass);


--
-- Name: consentimientos_informados id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.consentimientos_informados ALTER COLUMN id SET DEFAULT nextval('public.consentimientos_informados_id_seq'::regclass);


--
-- Name: doctors id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.doctors ALTER COLUMN id SET DEFAULT nextval('public.doctors_id_seq'::regclass);


--
-- Name: documentos_radiografias id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.documentos_radiografias ALTER COLUMN id SET DEFAULT nextval('public.documentos_radiografias_id_seq'::regclass);


--
-- Name: expedientes_medicos id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.expedientes_medicos ALTER COLUMN id SET DEFAULT nextval('public.expedientes_medicos_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: factura_conceptos id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.factura_conceptos ALTER COLUMN id SET DEFAULT nextval('public.factura_conceptos_id_seq'::regclass);


--
-- Name: historia_clinica_dental id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.historia_clinica_dental ALTER COLUMN id SET DEFAULT nextval('public.historia_clinica_dental_id_seq'::regclass);


--
-- Name: inventory id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.inventory ALTER COLUMN id SET DEFAULT nextval('public.inventory_id_seq'::regclass);


--
-- Name: objetivos id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.objetivos ALTER COLUMN id SET DEFAULT nextval('public.objetivos_id_seq'::regclass);


--
-- Name: odontograma id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.odontograma ALTER COLUMN id SET DEFAULT nextval('public.odontograma_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: satisfaccion_servicio id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.satisfaccion_servicio ALTER COLUMN id SET DEFAULT nextval('public.satisfaccion_servicio_id_seq'::regclass);


--
-- Name: services id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.services ALTER COLUMN id SET DEFAULT nextval('public.services_id_seq'::regclass);


--
-- Name: tratamientos_dentales id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.tratamientos_dentales ALTER COLUMN id SET DEFAULT nextval('public.tratamientos_dentales_id_seq'::regclass);


--
-- Name: whatsapp_faqs id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_faqs ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_faqs_id_seq'::regclass);


--
-- Name: whatsapp_messages id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_messages ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_messages_id_seq'::regclass);


--
-- Name: whatsapp_rule_execs id; Type: DEFAULT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_rule_execs ALTER COLUMN id SET DEFAULT nextval('public.whatsapp_rule_execs_id_seq'::regclass);


--
-- Data for Name: Doctor; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public."Doctor" (id, name, active) FROM stdin;
\.


--
-- Data for Name: Payment; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public."Payment" (id, "doctorId", amount, date, patient, service, note, "createdAt") FROM stdin;
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public."User" (id, email, name, "passwordHash", role, "isActive", "createdAt", "updatedAt") FROM stdin;
cmg5rvs970000sb1x44e8szs0	agenda@dentalux.mx	Recepci�n	$2a$12$0DdKZJdM2LpL8RG3SvUo7.5LT31MHT6ztmozP.RGco8lhpiIy/d.u	AGENDA	t	2025-09-29 23:41:30.955	2025-09-29 23:41:30.955
cmg5vzbtb0000vl1zyiitnv0y	nhaelvaldez26@hotmail.com	Jonathan Valdez	$2a$12$YVlSdTRJI3899yHv24JsUe83VrQ1ROZmv0y129KtSZA4cfskosSHq	AGENDA	t	2025-09-30 01:36:14.736	2025-09-30 01:36:14.736
cmg5qno960000t93on1wajibo	admin@dentalux.mx	Admin	$2a$06$NizqW1BrtngpiYunW1mQUeSLTxkCVGMtyUvpkpz1Y4Sg3T1vXqVbK	ADMIN	t	2025-09-29 23:07:12.906	2025-09-29 23:07:12.906
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
780a3817-a558-4923-bdac-33ccbd3b906e	86fdbb7133b58910c4a977b0b4e16c17b94a390622888a1b697de77be86ae5b4	2025-08-26 06:21:25.275082+00	20250814230453_init	\N	\N	2025-08-26 06:21:25.246022+00	1
b219d305-0bd8-406f-8507-5729a691498d	8dbc38b448ff24a929241bdbbd63c1154a1ac03e45b21a0a4e5e7f2baa0529e5	\N	20250929155747_add_user_roles	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20250929155747_add_user_roles\n\nDatabase error code: 42601\n\nDatabase error:\nERROR: syntax error at or near "﻿"\n\nPosition:\n[1m  0[0m\n[1m  1[1;31m ﻿-- Create enum Role[0m\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42601), message: "syntax error at or near \\"\\u{feff}\\"", detail: None, hint: None, position: Some(Original(1)), where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("scan.l"), line: Some(1244), routine: Some("scanner_yyerror") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20250929155747_add_user_roles"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20250929155747_add_user_roles"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:236	2025-09-29 23:01:38.351266+00	2025-09-29 22:58:43.228171+00	0
be623712-5920-46e9-a952-85810b3fc420	64bfca8f7de574a53580269b94638f9bca47139cd0481fcb7618951eb2a846b1	2025-09-29 23:06:16.208579+00	20250929155747_add_user_roles	\N	\N	2025-09-29 23:06:16.111919+00	1
b987526d-b74b-4395-b672-957dfaaddbee	c01a1380cbeedcb6db60b7a3747eeed517f34746f94d4aa4cc373037c85aa7fe	\N	20251001000000_init	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20251001000000_init\n\nDatabase error code: 42P07\n\nDatabase error:\nERROR: relation "doctors" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42P07), message: "relation \\"doctors\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("heap.c"), line: Some(1160), routine: Some("heap_create_with_catalog") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20251001000000_init"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20251001000000_init"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:236	\N	2025-10-02 09:43:39.376001+00	0
\.


--
-- Data for Name: alertas_inventario; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.alertas_inventario (id, tipo, titulo, descripcion, prioridad, producto_id, sucursal_id, resuelta, resuelto_por, resuelto_at, created_at) FROM stdin;
\.


--
-- Data for Name: app_state; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.app_state (id, user_id, state_data, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: appointments; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.appointments (id, patient, doctor_id, date, start_time, duration_hours, service_id, phone, status, created_at, updated_at, sucursal_id) FROM stdin;
2	victor	10	2025-11-19	10:00:00	1.0	8		Pendiente	2025-11-19 02:35:23.422967	2025-11-19 02:35:23.422967	sucursal_1
8	roberto Muñoz	20	2025-11-20	13:00:00	1.0	2		Atendida	2025-11-20 06:19:31.526458	2025-11-20 06:19:31.526458	sucursal_1
1	JONATHAN	9	2025-11-19	09:00:00	1.0	1		Atendida	2025-11-19 01:47:51.957764	2025-11-19 01:47:51.957764	sucursal_1
9	yaneth	11	2025-11-20	08:00:00	1.0	5		Atendida	2025-11-20 06:35:34.628247	2025-11-20 06:35:34.628247	sucursal_1
10	azul	9	2025-11-20	09:00:00	1.0	5		Atendida	2025-11-20 06:37:59.747537	2025-11-20 06:37:59.747537	sucursal_1
11	Francisco Javier	11	2025-11-20	10:00:00	1.0	1		Pendiente	2025-11-20 09:08:58.587816	2025-11-20 09:08:58.587816	sucursal_1
4	pedro	22	2025-11-19	16:00:00	1.0	22		Atendida	2025-11-19 21:24:46.643409	2025-11-19 21:24:46.643409	sucursal_2
5	Antonio Rivera	12	2025-11-19	17:00:00	1.0	13		Atendida	2025-11-19 23:51:26.791826	2025-11-19 23:51:26.791826	sucursal_2
6	Jesus	18	2025-11-19	14:00:00	1.0	22		Atendida	2025-11-19 23:56:55.010159	2025-11-19 23:56:55.010159	sucursal_2
7	Adalberto Flores	13	2025-11-19	09:00:00	1.0	9	6867865454	Atendida	2025-11-20 00:00:19.89184	2025-11-20 00:00:19.89184	sucursal_2
3	ernesto	28	2025-11-19	12:00:00	1.0	5		Atendida	2025-11-19 04:50:33.043022	2025-11-19 04:50:33.043022	sucursal_1
12	Hector Navarrete	13	2025-11-20	13:00:00	1.0	13	8135518575	Atendida	2025-11-20 09:50:08.648095	2025-11-20 09:50:08.648095	sucursal_2
13	Mario Versache	9	2025-11-20	11:00:00	1.0	1	6867865454	Atendida	2025-11-20 17:41:57.102992	2025-11-20 17:41:57.102992	sucursal_1
\.


--
-- Data for Name: clientes; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.clientes (id, rfc, razon_social, email, telefono, direccion, codigo_postal, regimen_fiscal, uso_cfdi, activo, sucursal_id, createdat) FROM stdin;
13a0d016-29f8-44cf-a168-cc9d86331915	VARJ901226VCA	Jonathan Valdez Rojas	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	21395	605	D01	t	sucursal_2	2025-09-09 02:17:41.897953
\.


--
-- Data for Name: configuracion_sat; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.configuracion_sat (id, sucursal_id, rfc, razon_social, regimen_fiscal, codigo_postal, cer_path, key_path, key_password, pac_proveedor, pac_usuario, pac_password, pac_url_timbrado, pac_url_cancelacion, serie_facturas, ultimo_folio, ambiente, activo, createdat) FROM stdin;
\.


--
-- Data for Name: consentimientos_informados; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.consentimientos_informados (id, expediente_id, tipo_tratamiento, descripcion_tratamiento, riesgos_beneficios, alternativas, costo_estimado, fecha_consentimiento, firma_paciente, firma_doctor, testigo_nombre, testigo_identificacion, doctor_id, sucursal_id, created_at) FROM stdin;
1	2	tallado y cementado	tallado y cementado diente numero 32	\N	\N	550.00	2025-11-10	f	f	sin testigo	na	9	sucursal_1	2025-11-10 22:07:24.986463+00
\.


--
-- Data for Name: doctors; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.doctors (id, name, color, created_at, updated_at, sucursal_id, comision, especialidad, activo, telefono, email) FROM stdin;
10	Yaneth Caballero Ruelas	#0161fd	2025-08-28 00:38:08.56424	2025-08-28 00:38:08.56424	sucursal_1	0.1500	General	t	\N	\N
17	Dr. Melissa Ortodoncia	#551029	2025-08-29 19:03:49.832215	2025-08-29 19:03:49.832215	sucursal_1	0.1500	General	t	\N	\N
11	Dr. Francisco Endodoncista	#93e3fd	2025-08-28 00:43:08.484528	2025-08-28 00:43:08.484528	sucursal_1	0.1500	General	t	\N	\N
16	Dr villa	#c0c0c0	2025-08-28 02:16:04.951089	2025-08-28 02:16:04.951089	sucursal_2	0.1500	General	t	\N	\N
13	Angela	#f401c7	2025-08-28 00:45:55.753487	2025-08-28 00:45:55.753487	sucursal_2	0.1500	General	t	\N	\N
9	Yara Caballero	#ff80d0	2025-08-28 00:34:58.104868	2025-08-28 00:34:58.104868	sucursal_1	0.1500	General	t	\N	\N
20	Dra. Perla Osuna	#3b82f6	2025-09-15 19:27:15.685684	2025-09-15 19:27:15.685684	sucursal_1	0.1500	General	t	\N	\N
22	Estefany	#3b82f6	2025-09-25 02:36:58.303044	2025-09-25 02:36:58.303044	sucursal_2	0.1500	General	t	\N	\N
24	Villa	#ffcc01	2025-10-04 20:56:03.786882	2025-10-04 20:56:03.786882	sucursal_1	0.1500	General	t	\N	\N
26	Dra. Janet	#3b82f6	2025-10-07 22:38:32.705193	2025-10-07 22:38:32.705193	sucursal_2	0.1500	General	t	\N	\N
12	Paoly	#ff6600	2025-08-28 00:45:50.46845	2025-08-28 00:45:50.46845	sucursal_2	0.1500	General	t	\N	\N
28	Dra Janet Romero	#b92d5d	2025-10-07 22:43:12.48093	2025-10-07 22:43:12.48093	sucursal_1	0.1500	General	t	\N	\N
29	Dra Irene Meza Ortodoncia	#6600ff	2025-10-16 17:08:30.050604	2025-10-16 17:08:30.050604	sucursal_1	0.1500	General	t	\N	\N
37	Dr. Garc¡a	#8884d8	2025-10-23 02:50:58.632021	2025-10-23 02:50:58.632021	sucursal_1	0.1500	General	t	\N	\N
38	Dra. L¢pez	#82ca9d	2025-10-23 02:50:58.632021	2025-10-23 02:50:58.632021	sucursal_1	0.1500	General	t	\N	\N
18	Melissa	#800040	2025-08-29 23:12:38.858082	2025-08-29 23:12:38.858082	sucursal_2	0.1500	General	t	\N	\N
19	Dani	#f7e73b	2025-09-01 21:05:48.987062	2025-09-01 21:05:48.987062	sucursal_2	0.1500	General	t	\N	\N
23	Cesar Lopez	#999999	2025-09-27 21:35:51.037058	2025-09-27 21:35:51.037058	sucursal_1	0.1500	General	t	\N	\N
33	Dr. Antonio Norte	#8884d8	2025-10-22 22:57:03.372709	2025-10-22 22:57:03.372709	sucursal_2	0.1500	General	t	\N	\N
34	Dra. Mar¡a Gonz lez	#82ca9d	2025-10-22 22:57:03.525903	2025-10-22 22:57:03.525903	sucursal_2	0.1500	General	t	\N	\N
35	Dr. Garc¡a	#8884d8	2025-10-23 00:33:33.044253	2025-10-23 00:33:33.044253	sucursal_1	0.1500	General	t	\N	\N
36	Dra. L¢pez	#82ca9d	2025-10-23 00:33:33.044253	2025-10-23 00:33:33.044253	sucursal_1	0.1500	General	t	\N	\N
14	Atenea	#1a00db	2025-08-28 00:46:01.659759	2025-08-28 00:46:01.659759	sucursal_2	0.1500	General	t	\N	\N
\.


--
-- Data for Name: documentos_radiografias; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.documentos_radiografias (id, expediente_id, tipo, nombre, descripcion, fecha_toma, datos_base64, url, doctor_id, sucursal_id, created_at) FROM stdin;
\.


--
-- Data for Name: expedientes_medicos; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.expedientes_medicos (id, paciente_id, nombre_paciente, telefono, email, fecha_nacimiento, edad, genero, direccion, ocupacion, estado_civil, contacto_emergencia, telefono_emergencia, sucursal_id, created_at, updated_at) FROM stdin;
1	paciente_1762811413376_kn1mmn1fh	Melissa Nuñes		\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-11-10 21:50:13.705057+00	2025-11-10 21:50:13.705057+00
2	paciente_1762811450628_qpt4cu3l5	Jonathan valdez	6867865454	NHAELVALDEZ26@HOTMAIL.COM	1990-12-26	35	masculino	eliseda 1094 la condesa mexicali baja california	empleado	soltero	yaneth caballero	6863112623	sucursal_1	2025-11-10 21:50:51.184541+00	2025-11-10 21:54:34.70381+00
3	paciente_1762926183760_cp88glsr0	Ajustes del día		\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-11-12 05:43:04.0827+00	2025-11-12 05:43:04.0827+00
4	paciente_1763533259646_h7rub6eu2	ernesto	6867865454	NHAELVALDEZ26@HOTMAIL.COM	1990-12-26	35	masculino	eliseda 1094 condesa seccion gante	empleado	casado	yaneth caballero	6863112623	sucursal_1	2025-11-19 06:20:58.218748+00	2025-11-19 06:22:10.158431+00
\.


--
-- Data for Name: expenses; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.expenses (id, concept, amount, date, doctor_id, payment_method, created_at, updated_at, sucursal_id, description, category) FROM stdin;
84	brackets	2000.00	2025-11-19	22	efectivo	2025-11-19 21:25:33.270955	2025-11-19 21:25:33.270955	sucursal_2	Gasto general	Varios
\.


--
-- Data for Name: factura_conceptos; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.factura_conceptos (id, factura_id, descripcion, cantidad, valor_unitario, importe, clave_prod_serv, unidad, objeto_imp, sucursal_id) FROM stdin;
1	92bee1af-5b7f-4d3a-97ed-9561da290914	EXTRACCION PZ	1	500	500	85122000	E48	01	sucursal_1
2	6081c24a-aa90-4177-8494-09f37267a92b	EXTRACCION PZ	1	500	500	85122000	E48	01	sucursal_1
3	26d7656d-22d1-4549-9ca2-70f6d94d14d2	EXTRACCION PZ	1	500	500	85122000	E48	01	sucursal_1
4	480fd33a-7727-45e1-9095-ade1e815d7cd	EXTRACCION PZ	1	500	500	85122000	E48	01	sucursal_1
5	5f297be2-dd52-4bf5-866c-57936ef324ba	EXTRACCION PZ	1	500	500	85122000	E48	01	sucursal_1
6	f91081a5-c48a-4a92-a17b-8067cd06684f	LIMPIEZA DENTAL	1	500	500	85121800	E48	01	sucursal_1
7	468052a8-77fd-4bae-9bae-d81314445299	PROBAND	1	200	200	85122000	E48	02	sucursal_1
8	79f60f33-398e-4a1d-bca0-8ae426587452	EXTRACCION PZ	1	500	500	85122000	E48	01	sucursal_1
9	8947eee6-ad9d-41f8-a613-b6156ddef214	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_1
10	c8bb83c8-15f8-43f7-9efa-818b547a3c1d	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_1
11	97f69353-b98a-4277-94f8-b21134492f8e	Prueb	1	1000	1000	85122000	E48	01	sucursal_2
12	81e74f9b-d44e-43c4-8eb3-04e270ba8c3a	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
13	4ab6a5c1-c05a-48cd-89e5-1bdda89d8ffe	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
14	2853b19d-f8ec-48cc-98c3-d70a348aab41	LIMPIEZA DENTAL	1	500	500	85121800	E48	01	sucursal_2
15	664a321d-4403-44b6-bdb1-ddf6bac7d2dd	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
16	16bbbd11-6d8d-4a58-972e-4cdb22181689	PROBAND	1	200	200	85122000	E48	02	sucursal_2
17	c5d795ec-6637-4c19-b441-699684ca461e	BLANQUEAMIENTO DENTAL	1	1400	1400	85122000	E48	02	sucursal_2
18	9b7aa23e-0bb6-422e-9bc2-e97f4f016e70	PROBAND	1	200	200	85122000	E48	02	sucursal_2
19	ba59776c-9693-41f2-a887-86a1ad72a709	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
20	6850a9eb-8968-4f5c-98f7-e8108a77b8a4	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
21	ca778244-7d1a-4890-b8fe-bfb1c68bbf74	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
22	7fc8cb4f-d292-426e-b252-eda4d71d4865	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
23	0be6d5ed-fda1-47f2-a5d5-86c35cdd1769	BLANQUEAMIENTO DENTAL	1	2000	2000	85122000	E48	02	sucursal_2
24	056efe0d-3e15-48f1-be9b-ccc50905bcad	PROBAND	1	200	200	85122000	E48	02	sucursal_2
25	4c8b168d-3bbc-448c-bfa7-3a3dbb5abaaf	EXTRACCION PZ	1	500	500	85122000	E48	01	sucursal_2
26	b1299d3e-9509-4bca-97ff-429b87b4d450	PROBAND	1	200	200	85122000	E48	02	sucursal_2
27	d471f32a-be72-4666-8773-9d8f817ee47a	Limpieza dental	1	500	500	85122000	E48	02	sucursal_1
28	592a326b-2d4c-44d1-9764-3d69844d3c1b	Limpieza dental	1	500	500	85122000	E48	02	sucursal_2
29	e11d69ab-c175-4b76-936a-1c88a15b68d9	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
30	f4b972cd-4bc9-4986-a639-1ecc9c215993	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
31	4a5a212a-2f22-4385-a633-ab02598ce905	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
32	b1ecf887-62ef-4d4e-92f2-cb7c177f074b	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
33	a752a861-1489-4041-9cb2-6d86e9b4dba0	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
34	5dbba035-8da0-4fbc-9ea4-802920529b51	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
35	f12b5e6b-fc23-4bfd-bed3-0d24c7ecd44f	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
36	b87ae6e0-6b92-4a35-b20c-e8ba7f94feac	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
37	8005fb99-f1a8-471a-be2b-61f7869afeed	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
38	d18c73e1-ebfd-4eac-9ff5-7929008a3e0e	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
39	e68c3598-c934-42e5-b2cb-613170bb879c	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
40	ab346986-7603-48f8-9137-179f7c63c84f	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
41	eb895a7a-70e2-4fa1-9c0e-840caecef3de	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
42	1bcc83e9-feca-4328-bc3c-e9f787687a8e	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
43	9f6aed83-908c-41b2-b295-e9d03f1c0621	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
44	c4e4c1ee-a3d2-4b67-a374-3795c0574558	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
45	5a4ac0ca-32f2-4260-aac0-5337935a7de6	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
46	cb99ad0b-6b72-4329-913b-296148f37335	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
47	603788ff-1963-4092-9831-8f55aee13483	LIMPIEZA DENTAK	1	10	10	85122000	E48	02	sucursal_1
48	209065bd-94a1-447b-98e5-16ef2972512a	RETENEDORES INFERIORES Y POSTERIORES	1	5	5	85122000	E48	02	sucursal_1
49	209065bd-94a1-447b-98e5-16ef2972512a	RESINAS ESTETICAS	1	5	5	85122000	E48	02	sucursal_1
50	b97425a9-e1c0-428e-bafd-275d5aadbf62	RESINAS ESTETICAS	1	10	10	85122000	E48	02	sucursal_1
51	02b79f07-c1e0-4207-9ed9-15414ce0f3c6	RESINAS ESTETICAS	1	10	10	85122000	E48	02	sucursal_1
52	43b0b508-ce07-4a8b-a49e-6baccfd1c85c	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
53	e38c5e12-8768-4fd7-b123-39946ae9da19	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
54	638a81ec-bdc1-42d6-987b-0a8cfebac099	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
55	8978a7a3-8a14-47f9-8c1b-29447a6e325e	RETENEDORES INFERIORES Y POSTERIORES	1	100	100	85122000	E48	02	sucursal_1
56	52fd9de9-002f-4a85-91c8-4288b9e57e0a	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
57	181ca75d-1c92-4f2d-9e80-6226d6c9159a	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
58	dda35b78-114a-4a0d-9497-bac56ca83b85	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
59	7d6c5f29-b02f-4edc-96c3-d63acfba187b	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
60	6d53925c-4e77-4896-b8ee-6a53c70e8418	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
61	d5d43e13-8a66-42d2-963a-3f5f9c73c08f	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
62	7f9cb140-0c8d-48a2-967f-cdc26805d820	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
63	972ae861-fee3-499d-b42b-d031551cfd80	RETENEDORES INFERIORES Y POSTERIORES	1	1000	1000	85122000	E48	02	sucursal_1
64	280eaab2-9557-4b02-89c9-ee5e021b54f2	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
65	913214a7-2654-49c8-b8cf-ce1f16cab1bb	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
66	f30372a4-cc19-43e9-af4c-a46a154cf183	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
67	849705e5-9f77-4d3f-a47b-c098d4530ec0	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
68	70651a76-d904-401d-8cdb-432b5ecc1c13	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
69	4bc4ac36-f897-4084-a5fd-1e9889eb7b43	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
70	a896de14-a495-47ba-adab-08e6995f4c66	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
71	01afc91c-586b-4349-ba56-420c7135f580	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
72	60f9061f-5ce5-4167-a3f3-6532fae8ffbd	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
73	335426e6-1581-40cd-af4b-8b54b0a8a7ec	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
74	3ab5d2bd-f306-40f1-b1b8-aeff5237efc3	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
75	a59688f4-19bc-4a30-b2b9-408049478c39	RETENEDORES INFERIORES Y POSTERIORES	1	1000	1000	85122000	E48	02	sucursal_1
76	56bea11b-62f7-4cac-ad72-9da0ec0e46ca	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
77	213a4ed2-453b-4714-8e42-d7037fbc3d73	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
78	e730855c-c83d-45bf-a2cf-7eabc0bb4932	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
79	ddc27447-8afb-4ef6-8698-789d201d951b	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
80	bdb3c337-0740-495c-bf35-00653d3fe8eb	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
81	11721e94-aafc-44ca-8532-815a55ab82b4	RESINAS ESTETICAS	1	1000	1000	85122000	E48	02	sucursal_1
82	35ee6e35-5069-4d19-adeb-f26893dc8c8b	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
83	64925b29-51be-48db-958e-99dad5f2b236	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
84	78ef263b-b669-431d-abcc-9b8efbaab13c	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
85	7ecf3c27-ff81-440f-a7a4-67dc08b12c28	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
86	66c2f33b-bd59-4b7e-b81e-558cd671b1bc	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
87	d8b0a4fb-22f8-4831-8bbb-128d08f81edd	RESINAS ESTETICAS	1	150	150	85122000	E48	02	sucursal_1
88	94846c1f-f143-4538-85bf-2050a315fec8	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_1
89	a30e9b27-f645-43a1-832a-fa9521c536fd	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_1
122	d7bde188-adf4-4072-86da-201c80ccfc5a	LIMPIEZA DENTAK	1	50	50	85122000	E48	02	sucursal_2
123	18760356-e4da-4d38-a26f-8aefde0676d9	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_2
124	3ba1d772-7663-4caa-954f-3bfdf41aefa5	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_2
125	6f01257e-189a-4352-9227-90086f258099	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_2
126	0b912e4f-06e1-43a6-8213-5180c1df7a19	RESINAS ESTETICAS	1	100	100	85122000	E48	02	sucursal_2
127	1d1d342b-ce01-4d72-9824-0b194bebee8a	LIMPIEZA DENTAK	1	50	50	85122000	E48	02	sucursal_2
128	281fcab9-d97c-4fd2-aa71-3ff51df34e86	LIMPIEZA DENTAK	1	550	550	85122000	E48	02	sucursal_2
129	0de654ce-272d-4ae9-8a9f-062e29c14fe1	Extracción	1	500	500	85122000	E48	02	sucursal_1
130	0436946c-e29b-4c7e-bb28-19affe01db24	exodoncia	1	550	550	85122000	E48	02	sucursal_2
131	47a19633-eecf-430c-9304-c6de5d8e5e24	exodoncia	1	1	1	85122000	E48	02	sucursal_2
132	be4e46cb-774b-42e7-af69-3045ec2a3a7f	exodoncia	1	1	1	85122000	E48	02	sucursal_1
\.


--
-- Data for Name: facturacion_clientes; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.facturacion_clientes (id, rfc, razon_social, email, telefono, direccion, uso_cfdi, sucursal_id, created_at, codigo_postal, regimen_fiscal) FROM stdin;
261bdf14-aaed-4dad-a134-a655f8504f66	VARJ901226VCA	Jonathan valdez	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_2	2025-09-09 06:49:46.207529	\N	\N
0a40ef3f-54a6-4371-bac9-72bdfca98d4d	Z	Jonathan valdez	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_2	2025-09-09 06:50:51.005461	\N	\N
2682db78-60fb-428e-b114-60873ed7c363	VARJ901226VCA	Jonathan valdez	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_2	2025-09-09 06:59:33.436371	\N	\N
906bdb6a-a273-4be1-a319-fc1f488a0c57	VARJ901226VCA	JONATHAN VALDEZ ROJAS	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_2	2025-09-09 19:15:35.689104	\N	\N
765896e8-7e9a-4b8f-a866-93b08aa4d863	VARJ901226VCA	JONATHAN VALDEZ ROJAS	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_1	2025-09-09 19:50:26.913942	\N	\N
a9a47a3a-c315-483e-814e-cf6a8f6b7158	YARA886HFHDCV	YARA RUTH CABALLERO	jayprint2025@gmail.com	6642659203	ELISEDA 1094	D01	sucursal_1	2025-09-09 19:53:06.407379	21396	612
2ebbe9fa-c83d-49ce-ab90-7d0ca78a57ba	VARJ901226VCA	JONATHAN VALDEZ ROJAS	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_1	2025-09-09 23:26:48.850049	21395	605
95d59e1b-e869-4d6e-b7c5-100b69ac4779	VARJ901225VCA	JONATHAN VALDEZ ROJAS	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_1	2025-09-10 01:37:23.204662	21395	605
6169410c-ec43-48ce-b4a7-59f0ff4cb7c9	VARJ901226VCA	JONATHAN VALDEZ ROJAS	nhaelvaldez26@hotmail.com	6867865454	ELISEDA 1094	D01	sucursal_1	2025-09-10 04:13:43.623715	21395	605
7875d8ae-faee-46e2-a14c-fdaa47b4a375	XAXX010101000	PUBLICO EN GENERAL	prueba@test.com	6867865454	Eliseda 1094 condesa	S01	sucursal_1	2025-10-10 00:32:06.407015	21395	616
75d346fe-6df0-4c62-8ea4-6a64d37a9259	XEXX010101000	CLIENTE DE PRUEBA	nhaelvaldez26hotmail.com	6867865454	\N	S01	sucursal_1	2025-10-14 21:21:55.982058	21395	616
64d067fa-911b-48f3-a7d2-67bba4ff08dc	BECY840903FI1	YURIDIA BENITEZ CASTILLO	nhaelvaldez26@hotmail.com	6867865454	BERNARDO REYES 2499 ADUANA GARITA 2 MEXICALI BAJA CALIFORNIA	D01	sucursal_1	2025-10-14 02:08:44.007887	21229	605
902f5399-a353-4f85-9968-eb0800b1fa25	BECY840903FI1	YURIDIA BENITEZ CASTILLO	nhaelvaldez26@hotmail.com	6867865454	BERNARDO REYES 2499 ADUANA GARITA 2 MEXICALI BAJA CALIFORNIA	D01	sucursal_2	2025-10-17 06:23:12.916557	21229	612
\.


--
-- Data for Name: facturacion_configuracion; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.facturacion_configuracion (sucursal_id, rfc, razon_social, regimen_fiscal, codigo_postal, pac_proveedor, pac_usuario, pac_password, pac_url_timbrado, pac_url_cancelacion, serie_facturas, ultimo_folio, ambiente, activo, logo_url, logo_image, logo_mime, created_at, cer_file, key_file, key_password, updated_at) FROM stdin;
victoria	CARY931205D64	YANETH CABALLERO RUELAS	612	21395	PAC_PROVEEDOR	nhaelvaldez26	1234567jhon	\N	\N		1	pruebas	t	\N	\N	\N	2025-10-08 08:54:43.307576	\N	\N	\N	2025-10-14 20:40:01.90279
sucursal_2	CARY931205D64	YANETH CABALLERO RUELAS	612	21395	facturama	Jonathan902612	Jhon909319				9	produccion	t	\N	\N	\N	2025-09-11 17:40:03.72173	\N	\N	\N	2025-10-14 20:40:01.90279
sucursal_1	CARY931205D64	YANETH CABALLERO RUELAS	612	21395	facturama	Jonathan902612	05939018				7	produccion	t	\N	\N	\N	2025-10-15 01:23:15.010447	\\x308205de308203c6a00302010202143030303031303030303030353131393931323032300d06092a864886f70d01010b0500308201843120301e06035504030c174155544f524944414420434552544946494341444f5241312e302c060355040a0c25534552564943494f2044452041444d494e495354524143494f4e2054524942555441524941311a3018060355040b0c115341542d49455320417574686f72697479312a302806092a864886f70d010901161b636f6e746163746f2e7465636e69636f407361742e676f622e6d783126302406035504090c1d41562e20484944414c474f2037372c20434f4c2e20475545525245524f310e300c06035504110c053036333030310b3009060355040613024d583119301706035504080c10434955444144204445204d455849434f3113301106035504070c0a435541554854454d4f4331153013060355042d130c5341543937303730314e4e33315c305a06092a864886f70d010902134d726573706f6e7361626c653a2041444d494e495354524143494f4e2043454e5452414c20444520534552564943494f53205452494255544152494f5320414c20434f4e545249425559454e5445301e170d3232303331383232303530345a170d3236303331383232303530345a3081ac3120301e0603550403131759414e45544820434142414c4c45524f205255454c41533120301e0603550429131759414e45544820434142414c4c45524f205255454c41533120301e060355040a131759414e45544820434142414c4c45524f205255454c415331163014060355042d130d43415259393331323035443634311b301906035504051312434152593933313230354d534c424c4e3034310f300d060355040b1306756e6964616430820122300d06092a864886f70d01010105000382010f003082010a0282010100b0adc517264c3a9c04f9d170406810119ca93922c617ae88f78bca4feac124acec56ff7f2e6aeb5c96d50bf26ba8743ad30e56aeffcabbb2bd37f5e225852155f5591e13af9dbd51053eaa2df862794c71f6edbc7faca8c1d49561c04d560e2571f6436a115fdfffbfc527ab5d4b86b05940e11113cb13dd71a099cf895646d77dced19e0a45a6d3395d6c3f290ee2eca8300492aa5b6c442c448704d740b7ad3ad3b0f17331d3cf921ce2f0d3c7de72dd18ccf66b1666aef605609897f6d45cb814e8adac1ef75f6f27fb4dc9472441a58659b881e3da7dacd24cc9f376037a32a39428421f56a86421427c991eaf0e4affdb21929c12dc8fc4707eab50dd790203010001a31d301b300c0603551d130101ff04023000300b0603551d0f0404030206c0300d06092a864886f70d01010b050003820201005d4ad86922a6d620f22d2a4d6bc991f732e4f6bacfb010fac255446d3ef2c3be1e60834b5b399ced1756e820a88cdb0ab79ca81e075a0531e69b1122d23429f91b2bb25fb7121f2ecedf4ec46f566cac4a7b4dacf48ccb541bcc3d84b2ca4ee7cfb04b720ecf37a2709617d0fe440fd7d6cb1b0d931f875d4376845d7597323c021e7246fb0a2af3d7ab8396c2df20066a610a27e469b80e3358a1f09a45ae79cf8820ba23048da1d32710b8d9a396de58ac8a35fb844c0e81d17d2c13a4230c999ee1f0ba99ae57be87df0e5b429039bcbb36ddbd1465d34f8b60bb389dbb5a549e8949628b83c52924deb7eb6cbc6954ab0161df4f0bdc8fb09ddc526c2af12b56b00a833bfa2295bf032a5624ec01a4770c5dfbfb15e1bd766088901a94ae921b9d38a382a24b1bbd4c0c5a900329575d2bc7bcf81081b3f402290dd1f9cfecccf9c134fdbc53e53e613fc0b36b49a0778d229d08ea318e81cadcdd0ecee12e8e1dbe27ce5dcb0689a24668d5b4dc85431af8ab58dd79d69fa1d3df245e0163ea0dc0a902ae368d8ef3c705c53a4fa4272e7e506657a6a03ab3690e5ced22063a2bad625cdf8094badee955021e7d28186030f60771447ea83c3ed920b02a616a83bac36b52bb0c18958ab2ed3ba26dbd358d43ef1f59a702f491d1b5bf7fd3427548cc90a0c46750112f30a3089aaba6f4ced10cae782d350057d921bda0	\\x3082050e304006092a864886f70d01050d3033301b06092a864886f70d01050c300e0408020100028201010002020800301406082a864886f70d03070408308204bc02010030048204c89230ec0325215185336125668cbbff804410f6a3d3520244a8b0cb16eb99bef3d99780c0630262c5bae8c09b132f7cdf02038f1fd4e142ff0423cf92c9cea869995a1945641c878134b3e703846d4e954c0a4de14d692714ccf74ac4289bf447f83b1cfb214fdfcfffdd00119d0c441ffffc48da9d2324a84b7fbd9d66a696bef46e223a8075ab000d81d330b90c7b4261bd5bbe9a12660b421dff6a4d3ca3c46822438c1b89aeb7b34b457071674862b962c0bb0b94ddb3f56c240d7e04f5fd2796053d6784898926e3d274c166bab7227e7c520abb8ef49e38f3cf53692fed7bbbad6c13959734577f9245df8c06d7bcb12eb7b3d7c660ac623f097ca5b0d06fd2e4405f92431c95b462683a7f8b2d4867f91b2ed82e448241052304b31a2fd7e30852b46e8e9fa83e6a546529d3595e63718ef98cce1c0bff74bee1a67d37b0dec96e24d4f06cc67f486bae18cc18ab00bc290c9dbf6c90dcc1a90cd60e00fc7155f42f4ff9fc123cc688de297a9ea0103ca8280cb742216aade4e914d834903eabe212e6c8a8f79d4cd910c418cd7326ef388f6324dbf807186a632cfeb07f18f60cedb1d4018739b566101283f9a212e4de5e7b7b06b53bded1c537c3575287546b552dbcd2f9bf2f0edbbeb3621dc2fd628f9c215d256c079b5713c9eec7483c58c1bdca7fa7d22e6af0a9d15da1cb7efdec3ee48bc5331d2dc5061b3dc06f3323c3897532f06ee15a59a73df3f1b8cfbb5e39e71eb91b0a2e34c7b27afb1b2442a9a544d9e1fe44ecd4dd36178141e60c4f1247c7793ae20bf61b24346fac35f7105a63253b0ee7ac59426d7dbb73bcd135b40aaca05bc70d486ebbfc2e39b5603bc64264c22091041800a13ba99470e4346164017eb6875d8ae50a7f89b0f986e8fc25e27b4977868653a35b01b2d5fa39adea38219f7dbbd25215a28f84c6fe123a601df1b5192f853c388b11995816cab88710fcbcd0d48aeda4ce049594054deb1cc3cab5476f322f7f3984fbaff9706a27e47f1b3ed31f368e741a637bf4c692aed09145715677933d67e2bb8f2019d5f4f71dc7794374f04487385b423c941a4447c587a628629db28628aa68b9d5cf2793a94347a627f86b63a8f03a224478d34d8b8b8d50fa745a663902158dcba1c5649b36a3e4ae498699133afa91a7b3027469697eaf50c5e8837b4cd2a173c266032a5fa3462f63388623cb3b0a02f5216583bedc885dee6ab0bfa1b4cb7b7f1e2f2531432bf7e20b9bd609734037ec711260c3de13343c340c5ded345c07d7d127e73b3fb0bed8b14443a113ba1bdea8851d33412e6d2df3b0ba535db9849a51598f2a35701e27908095d65bad7aafff0ce2d951667188addcf513441f9424efe72b1372de2874e825f345df7e5521d26163bb23f124f8077cad65c9d8783dd3801cf6a0b0a3b2a97a27846d8002c8d21e2bbfedbfccbecc7439a821c774ead7d97a8ab615963ca8d645f26b0b46d2e47e27c826c6ace45b686f7a310d05df2b2c4f08bc2f33ac113bab4eb5af3be076a61b8f29b6958eb0a1ef29fc722416193bc72f907785f29595f5720572a4b04b7f436782569ff68e602c941e1d992b3e6f9f77f9848900ad32cb5e27e1bd62f0302e6ee1fb4d31c7d844603b5a0c39986adc5d6236aaba96f917462e4fe22fa44038ad4d42309871aee12f53965957f80bee03f9ad0a6746ee69dd661f72d2d987	05939018	2025-10-15 01:23:15.010447
\.


--
-- Data for Name: facturacion_productos; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.facturacion_productos (id, descripcion, clave_prod_serv, unidad, objeto_imp, precio, sucursal_id, created_at) FROM stdin;
\.


--
-- Data for Name: facturas; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.facturas (id, folio, serie, fecha, emisor_rfc, emisor_nombre, emisor_regimen, receptor_id, receptor_rfc, receptor_nombre, receptor_uso_cfdi, receptor_regimen, subtotal, descuento, total_impuestos_trasladados, total_impuestos_retenidos, total, estado, uuid, fecha_timbrado, sello_cfd, sello_sat, cadena_original, qr_code, xml_path, pdf_path, cita_id, pago_id, notas, sucursal_id, createdat, updatedat, conceptos, cliente, tipo, forma_pago, metodo_pago, created_at, timbrada_at, status, cancelada_at, motivo_cancelacion, cfdi_id, temp_uuid) FROM stdin;
47a19633-eecf-430c-9304-c6de5d8e5e24	9	\N	2025-11-20 18:07:56.549331	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1	timbrada	1e076baa-1582-436c-a277-6390f8e95837	2025-11-20 18:08:04.604463	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-11-20 18:07:56.549331	2025-11-20 18:07:56.549331	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-11-20 18:07:56.549331	2025-11-20 18:08:04.604463	Timbrada	\N	\N	4MMLNxEiEMFwkEPnNBLSWg2	\N
0436946c-e29b-4c7e-bb28-19affe01db24	8	\N	2025-11-20 18:03:11.901801	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	b278d5f8-cc45-465a-91c0-1e6fae1e780e	2025-11-20 18:03:19.807058	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-11-20 18:03:11.901801	2025-11-20 18:03:11.901801	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-11-20 18:03:11.901801	2025-11-20 18:03:19.807058	Timbrada	\N	\N	aAwEakJwINXC8outkvB2jg2	\N
a30e9b27-f645-43a1-832a-fa9521c536fd	\N	\N	2025-10-16 01:30:35.262443	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-16 01:30:35.262443	2025-10-16 01:30:35.262443	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-16 01:30:35.262443	\N	\N	\N	\N	\N	\N
6081c24a-aa90-4177-8494-09f37267a92b	\N	\N	2025-09-10 00:18:13.0226	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 00:18:13.0226	2025-09-10 00:18:13.0226	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-10 00:18:13.0226	\N	\N	\N	\N	\N	\N
0be6d5ed-fda1-47f2-a5d5-86c35cdd1769	35	\N	2025-09-12 07:49:37.321308	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	57956a49-660f-4186-86a4-7458964dd2ae	2025-09-12 07:49:46.511941	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 07:49:37.321308	2025-09-12 07:49:37.321308	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 07:49:37.321308	2025-09-12 07:49:46.511941	Timbrada	\N	\N	cE-6NwKTHYfj3m22AxTErg2	\N
4a5a212a-2f22-4385-a633-ab02598ce905	50	\N	2025-10-08 08:50:50.203715	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	6cf6f0f4-9ad1-41bb-ab49-85268492e4cf	2025-10-08 08:50:58.811638	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-08 08:50:50.203715	2025-10-08 08:50:50.203715	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-10-08 08:50:50.203715	2025-10-08 08:50:58.811638	Timbrada	\N	\N	ku2R-c27nvwTzaUxhMQYrg2	\N
603788ff-1963-4092-9831-8f55aee13483	\N	\N	2025-10-10 02:31:02.623225	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	10	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 02:31:02.623225	2025-10-10 02:31:02.623225	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 02:31:02.623225	\N	\N	\N	\N	\N	\N
7f9cb140-0c8d-48a2-967f-cdc26805d820	\N	\N	2025-10-14 07:13:57.75746	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 07:13:57.75746	2025-10-14 07:13:57.75746	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 07:13:57.75746	\N	\N	\N	\N	\N	\N
eb895a7a-70e2-4fa1-9c0e-840caecef3de	\N	\N	2025-10-10 00:46:21.666638	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:46:21.666638	2025-10-10 00:46:21.666638	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 00:46:21.666638	\N	\N	\N	\N	\N	\N
60f9061f-5ce5-4167-a3f3-6532fae8ffbd	\N	\N	2025-10-14 21:58:15.534348	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 21:58:15.534348	2025-10-14 21:58:15.534348	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-14 21:58:15.534348	\N	\N	\N	\N	\N	\N
a896de14-a495-47ba-adab-08e6995f4c66	\N	\N	2025-10-14 21:22:06.128318	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 21:22:06.128318	2025-10-14 21:22:06.128318	\N	CLIENTE DE PRUEBA	ingreso	28	PUE	2025-10-14 21:22:06.128318	\N	\N	\N	\N	\N	\N
be4e46cb-774b-42e7-af69-3045ec2a3a7f	7	\N	2025-11-20 18:08:41.549034	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1	timbrada	a0232779-8ff6-403f-a680-8bd6f94b7d96	2025-11-20 18:08:47.402182	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-11-20 18:08:41.549034	2025-11-20 18:08:41.549034	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-11-20 18:08:41.549034	2025-11-20 18:08:47.402182	Timbrada	\N	\N	EaS15ZZNNFcwPNLAIeSA-Q2	\N
913214a7-2654-49c8-b8cf-ce1f16cab1bb	\N	\N	2025-10-14 15:43:31.922798	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 15:43:31.922798	2025-10-14 15:43:31.922798	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 15:43:31.922798	\N	\N	\N	\N	\N	\N
ab346986-7603-48f8-9137-179f7c63c84f	\N	\N	2025-10-10 00:41:04.406133	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:41:04.406133	2025-10-10 00:41:04.406133	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 00:41:04.406133	\N	\N	\N	\N	\N	\N
35ee6e35-5069-4d19-adeb-f26893dc8c8b	\N	\N	2025-10-15 22:19:36.205802	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	\N	2025-10-15 22:19:44.205524	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 22:19:36.205802	2025-10-15 22:19:36.205802	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 22:19:36.205802	2025-10-15 22:19:44.205524	Timbrada	\N	\N	vkubp_EGhqoOsmOVueGBiA2	\N
d7bde188-adf4-4072-86da-201c80ccfc5a	2	\N	2025-10-17 06:23:31.291601	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	50	timbrada	c9f51a6d-6bf9-4fd1-bd82-5718f71b6290	2025-10-17 06:42:59.380911	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-10-17 06:23:31.291601	2025-10-17 06:23:31.291601	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-17 06:23:31.291601	2025-10-17 06:42:59.380911	Timbrada	\N	\N	IF-gL_dKUlxRSlGoT6aD-A2	\N
d8b0a4fb-22f8-4831-8bbb-128d08f81edd	4	\N	2025-10-16 00:09:56.501708	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	150	timbrada	2ef97e08-577f-4e1c-860e-e2e2d55661b0	2025-10-16 00:10:01.409658	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-16 00:09:56.501708	2025-10-16 00:09:56.501708	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-16 00:09:56.501708	2025-10-16 00:10:01.409658	Timbrada	\N	\N	6axEngukCaUehndChYd53w2	\N
b87ae6e0-6b92-4a35-b20c-e8ba7f94feac	\N	\N	2025-10-10 00:34:54.758323	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:34:54.758323	2025-10-10 00:34:54.758323	\N	MADAI PAOLA CHAVEZ RODRIGUEZ	ingreso	28	PUE	2025-10-10 00:34:54.758323	\N	\N	\N	\N	\N	\N
56bea11b-62f7-4cac-ad72-9da0ec0e46ca	4	\N	2025-10-15 02:23:52.492963	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	4db69143-57de-4224-a4f4-1a4a73435a8d	2025-10-15 02:23:57.905059	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 02:23:52.492963	2025-10-15 02:23:52.492963	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 02:23:52.492963	2025-10-15 02:23:57.905059	Timbrada	\N	\N	3A0Y3G-1jw5uXM9coYMzig2	\N
e11d69ab-c175-4b76-936a-1c88a15b68d9	48	\N	2025-10-08 07:46:12.600904	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	269d2f9e-1221-442d-80d8-f43186236844	2025-10-08 07:46:30.909968	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-08 07:46:12.600904	2025-10-08 07:46:12.600904	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-10-08 07:46:12.600904	2025-10-08 07:46:30.909968	Timbrada	\N	\N	wABX66nHHuAhUgISqmYYOw2	\N
bdb3c337-0740-495c-bf35-00653d3fe8eb	\N	\N	2025-10-15 22:06:04.351908	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 22:06:04.351908	2025-10-15 22:06:04.351908	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 22:06:04.351908	\N	\N	\N	\N	\N	\N
849705e5-9f77-4d3f-a47b-c098d4530ec0	\N	\N	2025-10-14 17:25:15.770075	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 17:25:15.770075	2025-10-14 17:25:15.770075	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 17:25:15.770075	\N	\N	\N	\N	\N	\N
1bcc83e9-feca-4328-bc3c-e9f787687a8e	57	\N	2025-10-10 00:57:25.60937	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	b14bec69-dca8-4783-998f-18e05aada3e5	2025-10-10 00:57:31.311771	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:57:25.60937	2025-10-10 00:57:25.60937	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 00:57:25.60937	2025-10-10 00:57:31.311771	Timbrada	\N	\N	On6T3msYeg4QboiA2-KQAQ2	\N
e38c5e12-8768-4fd7-b123-39946ae9da19	\N	\N	2025-10-14 04:26:35.405827	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 04:26:35.405827	2025-10-14 04:26:35.405827	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 04:26:35.405827	\N	\N	\N	\N	\N	\N
e730855c-c83d-45bf-a2cf-7eabc0bb4932	\N	\N	2025-10-15 21:53:29.131101	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 21:53:29.131101	2025-10-15 21:53:29.131101	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 21:53:29.131101	\N	\N	\N	\N	\N	\N
5a4ac0ca-32f2-4260-aac0-5337935a7de6	60	\N	2025-10-10 01:28:15.182617	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	e77b8bdc-8a9d-4cfb-b426-788fa5faaa37	2025-10-10 01:28:22.10498	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 01:28:15.182617	2025-10-10 01:28:15.182617	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 01:28:15.182617	2025-10-10 01:28:22.10498	Timbrada	\N	\N	0czzarJR0zF0Z7wx9aPwUQ2	\N
e68c3598-c934-42e5-b2cb-613170bb879c	\N	\N	2025-10-10 00:39:37.226249	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:39:37.226249	2025-10-10 00:39:37.226249	\N	MADAI PAOLA CHAVEZ RODRIGUEZ	ingreso	28	PUE	2025-10-10 00:39:37.226249	\N	\N	\N	\N	\N	\N
01afc91c-586b-4349-ba56-420c7135f580	\N	\N	2025-10-14 21:24:22.687561	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 21:24:22.687561	2025-10-14 21:24:22.687561	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-14 21:24:22.687561	\N	\N	\N	\N	\N	\N
66c2f33b-bd59-4b7e-b81e-558cd671b1bc	3	\N	2025-10-15 23:48:46.703792	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	91575e22-27f9-44d0-b682-9f7a069e6eab	2025-10-15 23:48:52.709003	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 23:48:46.703792	2025-10-15 23:48:46.703792	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 23:48:46.703792	2025-10-15 23:48:52.709003	Timbrada	\N	\N	SCXAH921tURFsEL1pBST6A2	\N
4c8b168d-3bbc-448c-bfa7-3a3dbb5abaaf	37	\N	2025-09-12 07:57:48.768478	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	timbrada	4d381033-f7a1-4e3d-85fd-48abeb6dc242	2025-09-12 07:57:56.005984	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 07:57:48.768478	2025-09-12 07:57:48.768478	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 07:57:48.768478	2025-09-12 07:57:56.005984	Timbrada	\N	\N	ZRfxO5z-TF5EJP3euvopJA2	\N
d471f32a-be72-4666-8773-9d8f817ee47a	45	\N	2025-09-13 00:50:22.23088	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	timbrada	94220831-7f1e-4077-b7fc-f3fd3a1dd236	2025-09-13 00:55:17.811683	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-13 00:50:22.23088	2025-09-13 00:50:22.23088	\N	JONATHAN VALDEZ ROJAS	ingreso	01	PUE	2025-09-13 00:50:22.23088	2025-09-13 00:55:17.811683	Timbrada	\N	\N	x9jKNiduf-c2aacVIDHBVQ2	\N
c4e4c1ee-a3d2-4b67-a374-3795c0574558	59	\N	2025-10-10 01:14:35.25018	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	082173a9-3a3b-4f96-806e-557d827c0758	2025-10-10 01:14:42.011557	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 01:14:35.25018	2025-10-10 01:14:35.25018	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 01:14:35.25018	2025-10-10 01:14:42.011557	Timbrada	\N	\N	YL312_Y6Ing8NcM8Siw-bA2	\N
056efe0d-3e15-48f1-be9b-ccc50905bcad	36	\N	2025-09-12 07:53:49.196342	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	200	timbrada	3307e3f7-1b4b-4ff8-9103-4e0f6087beba	2025-09-12 07:53:57.702986	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 07:53:49.196342	2025-09-12 07:53:49.196342	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 07:53:49.196342	2025-09-12 07:53:57.702986	Timbrada	\N	\N	P5No7ZB1cWtmKmnG4qhzCg2	\N
f4b972cd-4bc9-4986-a639-1ecc9c215993	49	\N	2025-10-08 08:09:16.731246	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	9a947c27-5556-460b-b68f-a1af51c60aec	2025-10-08 08:09:31.707306	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-08 08:09:16.731246	2025-10-08 08:09:16.731246	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-10-08 08:09:16.731246	2025-10-08 08:09:31.707306	Timbrada	\N	\N	MCqUxDnNfygSSS14UMg2Bw2	\N
281fcab9-d97c-4fd2-aa71-3ff51df34e86	7	\N	2025-10-21 07:50:24.986313	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	cancelada	0400383a-77fc-4b60-bc75-05518fe783c8	2025-10-21 07:50:30.484811	\N	\N	\N	\N	\N	\N	593	\N	nota de prueba	sucursal_2	2025-10-21 07:50:24.986313	2025-10-21 07:50:24.986313	\N	YURIDIA BENITEZ CASTILLO	ingreso	01	PUE	2025-10-21 07:50:24.986313	2025-10-21 07:50:30.484811	Timbrada	2025-10-21 07:51:11.607486	no aplica	tkMvefZ5GwgNV7qesTpKfA2	\N
70651a76-d904-401d-8cdb-432b5ecc1c13	\N	\N	2025-10-14 21:04:17.605896	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 21:04:17.605896	2025-10-14 21:04:17.605896	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 21:04:17.605896	\N	\N	\N	\N	\N	\N
ba59776c-9693-41f2-a887-86a1ad72a709	30	\N	2025-09-12 02:15:02.189946	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	0a719560-e910-4de4-be89-31a8130cafd7	2025-09-12 02:15:08.215479	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 02:15:02.189946	2025-09-12 02:15:02.189946	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 02:15:02.189946	2025-09-12 02:15:08.215479	Timbrada	\N	\N	rVA_ZXiX3oBBK7rImlFcEg2	\N
79f60f33-398e-4a1d-bca0-8ae426587452	41	\N	2025-09-10 02:12:25.352133	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	timbrada	41fff69e-ba34-481e-88d2-21d9b60363de	2025-09-12 21:54:03.605651	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 02:12:25.352133	2025-09-10 02:12:25.352133	\N	JONATHAN VALDEZ ROJAS	ingreso	01	PUE	2025-09-10 02:12:25.352133	2025-09-12 21:54:03.605651	Timbrada	\N	\N	PSTNjSue1R2ltFXKqYP5PQ2	\N
9f6aed83-908c-41b2-b295-e9d03f1c0621	58	\N	2025-10-10 01:07:47.167386	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	66efc927-3b69-4309-bd2c-fbf9c0a22cbc	2025-10-10 01:07:54.109295	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 01:07:47.167386	2025-10-10 01:07:47.167386	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 01:07:47.167386	2025-10-10 01:07:54.109295	Timbrada	\N	\N	YbRQpqe_U-_VsX0qzBrczQ2	\N
d18c73e1-ebfd-4eac-9ff5-7929008a3e0e	\N	\N	2025-10-10 00:38:37.999294	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:38:37.999294	2025-10-10 00:38:37.999294	\N	MADAI PAOLA CHAVEZ RODRIGUEZ	ingreso	28	PUE	2025-10-10 00:38:37.999294	\N	\N	\N	\N	\N	\N
8947eee6-ad9d-41f8-a613-b6156ddef214	40	\N	2025-09-10 04:15:24.339918	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	ee4997d9-467b-41c3-abc5-2e5274267c97	2025-09-12 21:53:52.402551	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 04:15:24.339918	2025-09-10 04:15:24.339918	\N	JONATHAN VALDEZ ROJAS	ingreso	01	PUE	2025-09-10 04:15:24.339918	2025-09-12 21:53:52.402551	Timbrada	\N	\N	zfwhoYUgJBVafcalPI12RQ2	\N
ca778244-7d1a-4890-b8fe-bfb1c68bbf74	33	\N	2025-09-12 06:35:38.751663	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	278a6206-dc34-4cc6-85f8-8932cf1c5d96	2025-09-12 06:35:47.508809	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 06:35:38.751663	2025-09-12 06:35:38.751663	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 06:35:38.751663	2025-09-12 06:35:47.508809	Timbrada	\N	\N	QZPammlpyFx2N_x1XSy6XQ2	\N
0de654ce-272d-4ae9-8a9f-062e29c14fe1	6	\N	2025-10-26 01:25:24.991291	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	timbrada	bf7125b3-6ac0-4069-932b-d04f6aadbdbf	2025-10-26 01:25:36.076631	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-26 01:25:24.991291	2025-10-26 01:25:24.991291	\N	YURIDIA BENITEZ CASTILLO	ingreso	01	PUE	2025-10-26 01:25:24.991291	2025-10-26 01:25:36.076631	Timbrada	\N	\N	ju70xPrdMt8m8O4kqKKHhQ2	\N
02b79f07-c1e0-4207-9ed9-15414ce0f3c6	3	\N	2025-10-14 02:33:47.488301	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	10	timbrada	00d2e843-ad32-42fb-98a0-ae788a61267c	2025-10-14 02:33:54.509874	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 02:33:47.488301	2025-10-14 02:33:47.488301	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 02:33:47.488301	2025-10-14 02:33:54.509874	Timbrada	\N	\N	DZ59kFsWAIzyBE9favF14A2	\N
c8bb83c8-15f8-43f7-9efa-818b547a3c1d	32	\N	2025-09-10 04:24:11.866716	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	4d4f1d68-6b51-4bc1-91a8-61d01f81859b	2025-09-12 05:33:09.709225	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 04:24:11.866716	2025-09-10 04:24:11.866716	\N	JONATHAN VALDEZ ROJAS	ingreso	01	PUE	2025-09-10 04:24:11.866716	2025-09-12 05:33:09.709225	Timbrada	\N	\N	PiwZL86IqTBXuFYgAesZSQ2	\N
480fd33a-7727-45e1-9095-ade1e815d7cd	\N	\N	2025-09-10 00:40:26.471007	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 00:40:26.471007	2025-09-10 00:40:26.471007	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-10 00:40:26.471007	\N	\N	\N	\N	\N	\N
b1299d3e-9509-4bca-97ff-429b87b4d450	38	\N	2025-09-12 08:39:32.028381	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	200	timbrada	8f25f87c-402f-42bf-932c-6af7b8a06d49	2025-09-12 08:39:39.415031	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 08:39:32.028381	2025-09-12 08:39:32.028381	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 08:39:32.028381	2025-09-12 08:39:39.415031	Timbrada	\N	\N	8JTOzDjvpRKQ2-M3OohbkA2	\N
f30372a4-cc19-43e9-af4c-a46a154cf183	\N	\N	2025-10-14 15:53:50.063034	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 15:53:50.063034	2025-10-14 15:53:50.063034	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 15:53:50.063034	\N	\N	\N	\N	\N	\N
dda35b78-114a-4a0d-9497-bac56ca83b85	\N	\N	2025-10-14 05:44:49.769581	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 05:44:49.769581	2025-10-14 05:44:49.769581	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 05:44:49.769581	\N	\N	\N	\N	\N	\N
972ae861-fee3-499d-b42b-d031551cfd80	\N	\N	2025-10-14 07:20:29.433662	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 07:20:29.433662	2025-10-14 07:20:29.433662	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 07:20:29.433662	\N	\N	\N	\N	\N	\N
f12b5e6b-fc23-4bfd-bed3-0d24c7ecd44f	\N	\N	2025-10-10 00:32:30.457295	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:32:30.457295	2025-10-10 00:32:30.457295	\N	MADAI PAOLA CHAVEZ RODRIGUEZ	ingreso	28	PUE	2025-10-10 00:32:30.457295	\N	\N	\N	\N	\N	\N
638a81ec-bdc1-42d6-987b-0a8cfebac099	\N	\N	2025-10-14 04:29:31.363587	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 04:29:31.363587	2025-10-14 04:29:31.363587	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 04:29:31.363587	\N	\N	\N	\N	\N	\N
c5d795ec-6637-4c19-b441-699684ca461e	28	\N	2025-09-11 21:42:46.310226	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1400	timbrada	a53cc040-52fb-4f44-afca-a53a63b52b94	2025-09-12 01:52:16.605531	\N	\N	\N	\N	\N	\N	182	\N	\N	sucursal_2	2025-09-11 21:42:46.310226	2025-09-11 21:42:46.310226	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-11 21:42:46.310226	2025-09-12 01:52:16.605531	Timbrada	\N	\N	U-mGVqJe6r3_nlj44-YnJw2	\N
11721e94-aafc-44ca-8532-815a55ab82b4	\N	\N	2025-10-15 22:18:08.962298	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	timbrada	\N	2025-10-15 22:18:14.004303	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 22:18:08.962298	2025-10-15 22:18:08.962298	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 22:18:08.962298	2025-10-15 22:18:14.004303	Timbrada	\N	\N	i-hdywytWepTxmkomc0hng2	\N
181ca75d-1c92-4f2d-9e80-6226d6c9159a	\N	\N	2025-10-14 05:28:44.004088	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 05:28:44.004088	2025-10-14 05:28:44.004088	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 05:28:44.004088	\N	\N	\N	\N	\N	\N
43b0b508-ce07-4a8b-a49e-6baccfd1c85c	1	\N	2025-10-14 02:44:37.964411	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	67ae4ccc-cdbc-45f8-b8e5-e6ab7d782f6c	2025-10-14 02:44:47.70992	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 02:44:37.964411	2025-10-14 02:44:37.964411	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 02:44:37.964411	2025-10-14 02:44:47.70992	Timbrada	\N	\N	yjTSRSAtoFJNiqm1M_hf1g2	\N
16bbbd11-6d8d-4a58-972e-4cdb22181689	27	\N	2025-09-11 19:27:52.108458	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	200	cancelada	d1db12d7-4c46-4780-b680-467fa089cb63	2025-09-11 19:37:50.242965	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-11 19:27:52.108458	2025-09-11 19:27:52.108458	\N	JONATHAN VALDEZ ROJAS	ingreso	01	PUE	2025-09-11 19:27:52.108458	2025-09-11 19:37:50.242965	Timbrada	2025-09-11 20:02:26.691321	sdsddsdsd	\N	\N
18760356-e4da-4d38-a26f-8aefde0676d9	3	\N	2025-10-17 07:21:38.555285	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	b8882eed-b167-4539-8838-5d7674682d1d	2025-10-17 07:21:45.474688	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-10-17 07:21:38.555285	2025-10-17 07:21:38.555285	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-17 07:21:38.555285	2025-10-17 07:21:45.474688	Timbrada	\N	\N	QR1zxgwI0F5d8s9NMLIjFA2	\N
6d53925c-4e77-4896-b8ee-6a53c70e8418	\N	\N	2025-10-14 06:10:49.260288	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 06:10:49.260288	2025-10-14 06:10:49.260288	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 06:10:49.260288	\N	\N	\N	\N	\N	\N
8005fb99-f1a8-471a-be2b-61f7869afeed	\N	\N	2025-10-10 00:37:54.164003	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:37:54.164003	2025-10-10 00:37:54.164003	\N	MADAI PAOLA CHAVEZ RODRIGUEZ	ingreso	28	PUE	2025-10-10 00:37:54.164003	\N	\N	\N	\N	\N	\N
335426e6-1581-40cd-af4b-8b54b0a8a7ec	\N	\N	2025-10-15 00:16:43.372446	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 00:16:43.372446	2025-10-15 00:16:43.372446	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 00:16:43.372446	\N	\N	\N	\N	\N	\N
5f297be2-dd52-4bf5-866c-57936ef324ba	\N	\N	2025-09-10 01:11:03.610349	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 01:11:03.610349	2025-09-10 01:11:03.610349	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-10 01:11:03.610349	\N	\N	\N	\N	\N	\N
4bc4ac36-f897-4084-a5fd-1e9889eb7b43	\N	\N	2025-10-14 21:19:28.216562	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 21:19:28.216562	2025-10-14 21:19:28.216562	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 21:19:28.216562	\N	\N	\N	\N	\N	\N
81e74f9b-d44e-43c4-8eb3-04e270ba8c3a	25	\N	2025-09-11 15:42:20.486188	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	39b23eb5-007c-48ec-9fbf-4ddee884747b	2025-09-11 18:27:10.804227	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-11 15:42:20.486188	2025-09-11 15:42:20.486188	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-11 15:42:20.486188	2025-09-11 18:27:10.804227	Timbrada	\N	\N	\N	\N
3ab5d2bd-f306-40f1-b1b8-aeff5237efc3	2	\N	2025-10-15 01:57:31.86795	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	timbrada	973aa5db-a5bf-4c0b-925f-780d0a731234	2025-10-15 01:57:37.904443	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 01:57:31.86795	2025-10-15 01:57:31.86795	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 01:57:31.86795	2025-10-15 01:57:37.904443	Timbrada	\N	\N	-jKZqvnOo1O_MRbsRohEMQ2	\N
9b7aa23e-0bb6-422e-9bc2-e97f4f016e70	29	\N	2025-09-12 02:06:22.875387	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	200	timbrada	38814c29-6af8-4ae7-ab29-30c927364729	2025-09-12 02:06:30.210807	\N	\N	\N	\N	\N	\N	207	\N	\N	sucursal_2	2025-09-12 02:06:22.875387	2025-09-12 02:06:22.875387	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 02:06:22.875387	2025-09-12 02:06:30.210807	Timbrada	\N	\N	U6LErko7SKtRdgaJawHoLw2	\N
468052a8-77fd-4bae-9bae-d81314445299	\N	\N	2025-09-10 01:49:50.854072	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	200	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 01:49:50.854072	2025-09-10 01:49:50.854072	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-10 01:49:50.854072	\N	\N	\N	\N	\N	\N
a59688f4-19bc-4a30-b2b9-408049478c39	3	\N	2025-10-15 02:08:34.919208	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	timbrada	f0520e27-da55-4517-b057-6ba143b167a9	2025-10-15 02:08:40.80541	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 02:08:34.919208	2025-10-15 02:08:34.919208	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 02:08:34.919208	2025-10-15 02:08:40.80541	Timbrada	\N	\N	JvxXByN1J3KKIJuSN2bNSw2	\N
664a321d-4403-44b6-bdb1-ddf6bac7d2dd	26	\N	2025-09-11 19:25:54.310378	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	60d53531-875a-4044-8290-1508277aa813	2025-09-11 19:37:42.603532	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-11 19:25:54.310378	2025-09-11 19:25:54.310378	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-11 19:25:54.310378	2025-09-11 19:37:42.603532	Timbrada	\N	\N	\N	\N
3ba1d772-7663-4caa-954f-3bfdf41aefa5	4	\N	2025-10-17 19:32:12.02285	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	ef7ddd64-5f10-4d25-9090-895324229fc7	2025-10-17 19:32:18.777324	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-10-17 19:32:12.02285	2025-10-17 19:32:12.02285	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-17 19:32:12.02285	2025-10-17 19:32:18.777324	Timbrada	\N	\N	gwhW48rPDyZn9NtUo3t_yw2	\N
97f69353-b98a-4277-94f8-b21134492f8e	23	\N	2025-09-10 05:51:50.915272	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	timbrada	972888d3-7d53-4b0a-8483-abe26a607536	2025-09-11 17:25:59.904903	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-10 05:51:50.915272	2025-09-10 05:51:50.915272	\N	JONATHAN VALDEZ ROJAS	ingreso	01	PUE	2025-09-10 05:51:50.915272	\N	\N	\N	\N	\N	\N
52fd9de9-002f-4a85-91c8-4288b9e57e0a	\N	\N	2025-10-14 04:59:47.547494	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 04:59:47.547494	2025-10-14 04:59:47.547494	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 04:59:47.547494	\N	\N	\N	\N	\N	\N
6f01257e-189a-4352-9227-90086f258099	\N	\N	2025-10-20 01:45:04.754283	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-10-20 01:45:04.754283	2025-10-20 01:45:04.754283	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-20 01:45:04.754283	\N	\N	\N	\N	\N	\N
6850a9eb-8968-4f5c-98f7-e8108a77b8a4	31	\N	2025-09-12 04:04:15.525841	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	0ef85757-030f-42c8-b92b-07d3d5cb14f1	2025-09-12 04:04:22.404787	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 04:04:15.525841	2025-09-12 04:04:15.525841	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 04:04:15.525841	2025-09-12 04:04:22.404787	Timbrada	\N	\N	QBVXOAHKNsrc3IBovnnARQ2	\N
b97425a9-e1c0-428e-bafd-275d5aadbf62	\N	\N	2025-10-14 02:18:19.562244	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	10	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 02:18:19.562244	2025-10-14 02:18:19.562244	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 02:18:19.562244	\N	\N	\N	\N	\N	\N
26d7656d-22d1-4549-9ca2-70f6d94d14d2	\N	\N	2025-09-10 00:19:09.61745	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 00:19:09.61745	2025-09-10 00:19:09.61745	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-10 00:19:09.61745	\N	\N	\N	\N	\N	\N
213a4ed2-453b-4714-8e42-d7037fbc3d73	\N	\N	2025-10-15 21:27:32.193374	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 21:27:32.193374	2025-10-15 21:27:32.193374	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 21:27:32.193374	\N	\N	\N	\N	\N	\N
f91081a5-c48a-4a92-a17b-8067cd06684f	\N	\N	2025-09-10 01:37:53.454048	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-10 01:37:53.454048	2025-09-10 01:37:53.454048	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-10 01:37:53.454048	\N	\N	\N	\N	\N	\N
b1ecf887-62ef-4d4e-92f2-cb7c177f074b	51	\N	2025-10-08 08:58:50.67348	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	3852c85a-f33d-48d4-a5fd-9eaab53a35db	2025-10-08 08:58:59.005018	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-08 08:58:50.67348	2025-10-08 08:58:50.67348	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-10-08 08:58:50.67348	2025-10-08 08:58:59.005018	Timbrada	\N	\N	62Xfq_Hc3IAbmnJC7ITkYA2	\N
280eaab2-9557-4b02-89c9-ee5e021b54f2	\N	\N	2025-10-14 07:37:58.11707	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 07:37:58.11707	2025-10-14 07:37:58.11707	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 07:37:58.11707	\N	\N	\N	\N	\N	\N
0b912e4f-06e1-43a6-8213-5180c1df7a19	5	\N	2025-10-20 02:15:08.709426	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	d28fa97d-d5e7-4e4f-897d-e3539eee86d5	2025-10-20 02:15:14.081487	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-10-20 02:15:08.709426	2025-10-20 02:15:08.709426	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-20 02:15:08.709426	2025-10-20 02:15:14.081487	Timbrada	\N	\N	6xDImAp-qEr0IkhlwDKdSQ2	\N
d5d43e13-8a66-42d2-963a-3f5f9c73c08f	\N	\N	2025-10-14 06:45:57.727439	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 06:45:57.727439	2025-10-14 06:45:57.727439	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 06:45:57.727439	\N	\N	\N	\N	\N	\N
4ab6a5c1-c05a-48cd-89e5-1bdda89d8ffe	22	\N	2025-09-11 17:02:43.184864	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	3595f36a-3be6-4581-84aa-d7e7ab8cbebb	2025-09-11 17:25:50.904327	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-11 17:02:43.184864	2025-09-11 17:02:43.184864	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-11 17:02:43.184864	\N	\N	\N	\N	\N	\N
7ecf3c27-ff81-440f-a7a4-67dc08b12c28	2	\N	2025-10-15 23:36:18.656285	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	73abbacc-87e4-42da-8022-979acfc7b033	2025-10-15 23:36:23.903776	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 23:36:18.656285	2025-10-15 23:36:18.656285	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 23:36:18.656285	2025-10-15 23:36:23.903776	Timbrada	\N	\N	L461zIF3Eqae8T5vtbM5Zg2	\N
a752a861-1489-4041-9cb2-6d86e9b4dba0	52	\N	2025-10-08 09:11:50.304836	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	47b8250a-3a75-491c-895a-21dcc0a19fe9	2025-10-08 09:11:57.309269	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-08 09:11:50.304836	2025-10-08 09:11:50.304836	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-10-08 09:11:50.304836	2025-10-08 09:11:57.309269	Timbrada	\N	\N	4ZutwGj9TWLljmuhmU3FCw2	\N
1d1d342b-ce01-4d72-9824-0b194bebee8a	6	\N	2025-10-21 02:53:17.431573	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	50	timbrada	bdd25cb3-2a57-49a9-8caa-773995ef69b9	2025-10-21 02:53:25.37737	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-10-21 02:53:17.431573	2025-10-21 02:53:17.431573	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-21 02:53:17.431573	2025-10-21 02:53:25.37737	Timbrada	\N	\N	Mrt41Im992C4rU4QFY9FGg2	\N
592a326b-2d4c-44d1-9764-3d69844d3c1b	47	\N	2025-09-13 01:30:42.39003	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	timbrada	0e8cb9d5-cfa8-4ce1-9917-bf9c6256eee6	2025-09-13 01:30:50.506882	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-13 01:30:42.39003	2025-09-13 01:30:42.39003	\N	JONATHAN VALDEZ ROJAS	ingreso	01	PUE	2025-09-13 01:30:42.39003	2025-09-13 01:30:50.506882	Timbrada	\N	\N	lvPfIXAdbjI2FcaH9qHxrQ2	\N
78ef263b-b669-431d-abcc-9b8efbaab13c	\N	\N	2025-10-15 23:27:34.453715	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	\N	2025-10-15 23:27:41.303633	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 23:27:34.453715	2025-10-15 23:27:34.453715	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 23:27:34.453715	2025-10-15 23:27:41.303633	Timbrada	\N	\N	f4bSa7xInoDOrfOGY5u8-g2	\N
64925b29-51be-48db-958e-99dad5f2b236	\N	\N	2025-10-15 23:14:49.982061	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 23:14:49.982061	2025-10-15 23:14:49.982061	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 23:14:49.982061	\N	\N	\N	\N	\N	\N
8978a7a3-8a14-47f9-8c1b-29447a6e325e	\N	\N	2025-10-14 04:52:42.456531	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 04:52:42.456531	2025-10-14 04:52:42.456531	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 04:52:42.456531	\N	\N	\N	\N	\N	\N
cb99ad0b-6b72-4329-913b-296148f37335	61	\N	2025-10-10 01:42:04.132546	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	timbrada	8b495f88-aea7-4efc-a8e7-dbdfab40d65a	2025-10-10 01:42:14.209389	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 01:42:04.132546	2025-10-10 01:42:04.132546	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-10 01:42:04.132546	2025-10-10 01:42:14.209389	Timbrada	\N	\N	wkc92IzawLVmMwhXJaZgLQ2	\N
ddc27447-8afb-4ef6-8698-789d201d951b	\N	\N	2025-10-15 22:01:20.544022	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-15 22:01:20.544022	2025-10-15 22:01:20.544022	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-15 22:01:20.544022	\N	\N	\N	\N	\N	\N
209065bd-94a1-447b-98e5-16ef2972512a	\N	\N	2025-10-14 02:08:55.015842	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	10	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 02:08:55.015842	2025-10-14 02:08:55.015842	\N	YURIDIA BENITES CASTILLO	ingreso	28	PUE	2025-10-14 02:08:55.015842	\N	\N	\N	\N	\N	\N
5dbba035-8da0-4fbc-9ea4-802920529b51	\N	\N	2025-10-10 00:28:52.397057	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	550	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-10 00:28:52.397057	2025-10-10 00:28:52.397057	\N	YARA RUTH CABALLERO	ingreso	28	PUE	2025-10-10 00:28:52.397057	\N	\N	\N	\N	\N	\N
7d6c5f29-b02f-4edc-96c3-d63acfba187b	\N	\N	2025-10-14 05:55:53.29574	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	1000	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-14 05:55:53.29574	2025-10-14 05:55:53.29574	\N	PUBLICO EN GENERAL	ingreso	28	PUE	2025-10-14 05:55:53.29574	\N	\N	\N	\N	\N	\N
94846c1f-f143-4538-85bf-2050a315fec8	5	\N	2025-10-16 00:43:22.323822	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	100	timbrada	0dff3623-ade2-48ea-b4e5-d11c06b5389b	2025-10-16 00:43:27.807753	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-10-16 00:43:22.323822	2025-10-16 00:43:22.323822	\N	YURIDIA BENITEZ CASTILLO	ingreso	28	PUE	2025-10-16 00:43:22.323822	2025-10-16 00:43:27.807753	Timbrada	\N	\N	iXaQay9i17_cyINFFr9q2Q2	\N
92bee1af-5b7f-4d3a-97ed-9561da290914	\N	\N	2025-09-09 23:55:44.197087	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	borrador	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_1	2025-09-09 23:55:44.197087	2025-09-09 23:55:44.197087	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-09 23:55:44.197087	\N	\N	\N	\N	\N	\N
7fc8cb4f-d292-426e-b252-eda4d71d4865	34	\N	2025-09-12 06:45:52.788113	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	2000	timbrada	f433dd8f-e9f1-4a9c-a62a-7d33d6aa5630	2025-09-12 06:46:05.904386	\N	\N	\N	\N	\N	\N	\N	\N	\N	sucursal_2	2025-09-12 06:45:52.788113	2025-09-12 06:45:52.788113	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-12 06:45:52.788113	2025-09-12 06:46:05.904386	Timbrada	\N	\N	2Bq4hmFjrT087C-p8hqp7g2	\N
2853b19d-f8ec-48cc-98c3-d70a348aab41	24	\N	2025-09-11 18:26:48.367442	\N	\N	\N	\N	\N	\N	\N	\N	0	\N	\N	\N	500	timbrada	ea8c6044-99fa-4fb5-816f-a8ee38b4fd0b	2025-09-11 18:27:01.80652	\N	\N	\N	\N	\N	\N	196	\N	\N	sucursal_2	2025-09-11 18:26:48.367442	2025-09-11 18:26:48.367442	\N	JONATHAN VALDEZ ROJAS	ingreso	28	PUE	2025-09-11 18:26:48.367442	2025-09-11 18:27:01.80652	Timbrada	\N	\N	\N	\N
\.


--
-- Data for Name: historia_clinica_dental; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.historia_clinica_dental (id, expediente_id, motivo_consulta, enfermedad_actual, antecedentes_personales, antecedentes_familiares, antecedentes_odontologicos, habitos_nocivos, alergias, medicamentos_actuales, examen_extraoral, examen_intraoral, diagnostico_presuntivo, plan_tratamiento, observaciones, doctor_id, fecha_registro, sucursal_id, created_at) FROM stdin;
1	2	dolor de muela	ninguna	cirjugia de resconstruccion en dedo anular	diavetes	ninguni	ninguno	ninguno	ninguno	ok	diente con fisura numero 32	diente numero 32 con fisura requiere tallado y cementacion	tallado y cementacion 	paciente muestra dolor 	9	2025-11-10	sucursal_1	2025-11-10 21:57:51.483044+00
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.inventory (id, sku, name, category, type, quantity, min_stock, max_stock, price, supplier, last_purchase, usage_per_patient, expiration_date, sucursal_id, created_at, description, stock, proveedor, ubicacion, lote, fecha_vencimiento) FROM stdin;
4	\N	Gasas Esteriles	desechable	material	300	100	300	0.30	\N	\N	1.00	\N	sucursal_1	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
11	\N	Gasas Esteriles	desechable	material	300	100	300	0.30	\N	\N	1.00	\N	sucursal_2	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
5	\N	Lidocaina 2%	anestesia	material	80	20	100	35.00	\N	\N	1.00	\N	sucursal_1	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
12	\N	Lidocaina 2%	anestesia	material	80	20	100	35.00	\N	\N	1.00	\N	sucursal_2	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
6	\N	Resina A2	resina	material	20	5	50	150.00	\N	\N	1.00	\N	sucursal_1	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
13	\N	Resina A2	resina	material	20	5	50	150.00	\N	\N	1.00	\N	sucursal_2	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
7	\N	Acido Grabador	resina	material	15	5	50	100.00	\N	\N	1.00	\N	sucursal_1	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
14	\N	Acido Grabador	resina	material	15	5	50	100.00	\N	\N	1.00	\N	sucursal_2	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
8	\N	Limas K	endodoncia	material	30	5	50	10.00	\N	\N	1.00	\N	sucursal_1	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
15	\N	Limas K	endodoncia	material	30	5	50	10.00	\N	\N	1.00	\N	sucursal_2	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
9	\N	Guantes de Latex	desechable	material	198	50	100	0.50	\N	\N	1.00	\N	sucursal_2	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
10	\N	Cubrebocas Tricapa	desechable	material	149	30	100	0.40	\N	\N	1.00	\N	sucursal_2	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
2	\N	Guantes de Latex	desechable	material	190	50	100	0.50	\N	\N	1.00	\N	sucursal_1	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
3	\N	Cubrebocas Tricapa	desechable	material	145	30	100	0.40	\N	\N	1.00	\N	sucursal_1	2025-11-20 03:10:02.049627	\N	0	Sin Proveedor	\N	\N	\N
\.


--
-- Data for Name: lab_abonos; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.lab_abonos (id, trabajo_id, fecha, monto, nota, created_at, sucursal_id, metodo_pago) FROM stdin;
4ed14ed3-75f2-40bf-af53-93ca71ea0dc4	f6b75c6d-9a7d-4afa-92e1-3e2ced6e0f84	2025-11-19	500.00	transferencia	2025-11-19 21:26:23.684806	sucursal_2	\N
\.


--
-- Data for Name: lab_trabajos; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.lab_trabajos (id, paciente, laboratorio_id, servicio_id, presupuesto, fecha_inicio, fecha_entrega_estimada, etapa, notas, created_at, updated_at, sucursal_id, metodo_pago) FROM stdin;
f6b75c6d-9a7d-4afa-92e1-3e2ced6e0f84	Juan Peralta	246ecae7-5751-438d-9793-476fb3d5a73b	16	4000.00	2025-11-19	2025-11-26	Toma de impresión	\N	2025-11-19 21:26:04.237652	2025-11-19 21:26:04.237652	sucursal_2	\N
\.


--
-- Data for Name: laboratorios; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.laboratorios (id, nombre, contacto, created_at, updated_at, sucursal_id, metodo_pago) FROM stdin;
9eb1c5e3-89eb-43ef-8001-f457a40cee16	Mario lab removibles	6865102997	2025-08-28 01:59:57.862834	2025-08-28 01:59:57.862834	sucursal_2	\N
246ecae7-5751-438d-9793-476fb3d5a73b	Guillermo lab dona	6866953964	2025-08-28 02:00:41.399565	2025-08-28 02:00:41.399565	sucursal_2	\N
76148d8d-e3a3-4ce7-852c-b95a72c321a3	Manuel lab fija	6861065290	2025-08-28 02:04:05.847915	2025-08-28 02:04:05.847915	sucursal_2	\N
2a7ffd7b-a2db-4d3d-ad67-48e63fa9e825	Laboratorio Dental Mario	6865102997	2025-08-29 18:58:15.572147	2025-08-29 18:58:15.572147	sucursal_1	\N
f5294ce0-3beb-4792-8f45-1222c90e46c0	Ulises Gastelum	+1 760 296 2323	2025-09-12 22:41:26.171332	2025-09-12 22:41:26.171332	sucursal_1	\N
df10a429-f45c-471f-b400-6afbbc6ee88a	Dentalux	6673434222	2025-09-13 01:00:47.569985	2025-09-13 01:00:47.569985	sucursal_2	\N
16603765-33c4-47ba-8e5a-e3a81f69ed73	Labotario Manuel	\N	2025-10-04 20:46:40.580471	2025-10-04 20:46:40.580471	sucursal_1	\N
\.


--
-- Data for Name: objetivos; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.objetivos (id, nombre, monto_meta, monto_actual, completado, created_at, updated_at, sucursal_id, doctor_id, meta, sueldo_base, periodo_inicio, periodo_fin) FROM stdin;
\.


--
-- Data for Name: odontograma; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.odontograma (id, expediente_id, diente_numero, estado, superficie, observaciones, fecha_registro, doctor_id, sucursal_id, created_at) FROM stdin;
1	2	32	obturado	\N	\N	2025-11-10	9	sucursal_1	2025-11-10 21:58:21.629933+00
2	2	28	extraido	\N	\N	2025-11-10	9	sucursal_1	2025-11-10 21:58:52.656166+00
3	2	15	endodoncia	\N	\N	2025-11-10	9	sucursal_1	2025-11-10 21:59:07.131825+00
\.


--
-- Data for Name: pagos_laboratorio; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.pagos_laboratorio (id, trabajo_id, monto, fecha, sucursal_id, created_at) FROM stdin;
20b38243-f014-4ae9-9ad2-d4698aa6c656	fcea57a7-ab34-4cd7-a050-1dfe14e83b59	850	2025-08-30	sucursal_1	2025-08-30 01:51:11.735675
4a9bb8c0-dc10-41c6-a375-82c7c1e07af4	32959e85-55b2-49fa-aec5-5f258ef0b87b	1700	2025-09-13	sucursal_2	2025-09-13 01:13:31.973875
f2238a6a-ad4e-4dd8-916f-00dc45d10790	4b074c4b-00ec-4d10-b4d4-cdea373fa05d	1295	2025-09-16	sucursal_2	2025-09-16 22:15:03.272518
b10fce13-3d00-4607-ba71-924c0db36d4c	52d4191b-50f6-4420-b6dc-b362250b145c	1480	2025-09-16	sucursal_2	2025-09-16 22:15:21.822612
be89d01a-6764-4e2a-9ef3-d46db3500baa	7585824e-81e6-47d5-bd40-8fd8ab8f4e53	1480	2025-09-16	sucursal_2	2025-09-16 22:15:31.947106
7abd78a4-e0b0-41d3-bebc-869f39e47e7c	5d9bc3d6-cd01-4edb-b667-b454ceb88329	1300	2025-10-01	sucursal_2	2025-10-01 22:12:37.936832
2fe46c2a-5b69-4c6d-a14b-cb1907334ac4	75585c25-2c53-4460-9af5-286676d7bc2d	1500	2025-10-26	sucursal_1	2025-10-26 01:21:58.072856
3c939f3d-2ac5-4d16-8210-17be1e90a835	59f772af-9b37-421c-ba58-ba3d70c1c01a	5400	2025-11-01	sucursal_1	2025-11-01 00:11:17.93284
ff67688b-a368-4fa0-9501-6ed03921c03f	e9075b81-aa4d-4c14-9efb-03f5fd912386	900	2025-11-01	sucursal_1	2025-11-01 00:12:09.060158
e556348a-c0d3-424c-bb56-6a80a5807857	1fd8f801-683a-4e97-b0b3-f9a06796551a	1000	2025-11-08	sucursal_2	2025-11-08 19:09:10.322717
6dd0dd98-e4a9-4947-8454-7541f1c87f37	f6b75c6d-9a7d-4afa-92e1-3e2ced6e0f84	700	2025-11-19	sucursal_2	2025-11-19 21:26:43.863587
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.payments (id, appointment_id, patient, service_id, amount, payment_method, date, doctor_id, created_at, updated_at, sucursal_id) FROM stdin;
1	1	JONATHAN	1	500.00	efectivo	2025-11-19	9	2025-11-19 21:24:28.644927	2025-11-19 21:24:28.644927	sucursal_1
2	4	pedro	22	2500.00	tarjeta_credito	2025-11-19	22	2025-11-19 21:25:03.021795	2025-11-19 21:25:03.021795	sucursal_2
3	3	ernesto	5	2000.00	efectivo	2025-11-20	28	2025-11-20 06:34:30.794445	2025-11-20 06:34:30.794445	sucursal_1
4	9	yaneth	5	2000.00	tarjeta_debito	2025-11-20	11	2025-11-20 06:36:46.85576	2025-11-20 06:36:46.85576	sucursal_1
5	10	azul	5	2000.00	efectivo	2025-11-20	9	2025-11-20 06:39:12.345101	2025-11-20 06:39:12.345101	sucursal_1
6	12	Hector Navarrete	13	500.00	efectivo	2025-11-20	13	2025-11-20 19:14:27.300754	2025-11-20 19:14:27.300754	sucursal_2
\.


--
-- Data for Name: productos_sat; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.productos_sat (id, nombre, codigo_interno, descripcion, precio, clave_prodserv, clave_unidad, objeto_imp, sucursal_id, created_at) FROM stdin;
\.


--
-- Data for Name: satisfaccion_servicio; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.satisfaccion_servicio (id, appointment_id, service_id, patient_id, doctor_id, rating, comentario, created_at, updated_at, sucursal_id) FROM stdin;
8	6	22	\N	\N	5.0	\N	2025-11-19 23:57:28.785081	2025-11-19 23:57:28.785081	sucursal_2
9	7	9	\N	\N	5.0	\N	2025-11-20 00:00:41.202347	2025-11-20 00:00:41.202347	sucursal_2
10	8	2	\N	\N	5.0	\N	2025-11-20 06:21:54.007336	2025-11-20 06:21:54.007336	sucursal_1
11	9	5	\N	\N	5.0	\N	2025-11-20 06:36:35.700662	2025-11-20 06:36:35.700662	sucursal_1
12	10	5	\N	\N	2.0	\N	2025-11-20 06:38:38.486504	2025-11-20 06:38:38.486504	sucursal_1
13	13	1	\N	\N	4.0	\N	2025-11-20 19:15:25.900439	2025-11-20 19:15:25.900439	sucursal_1
\.


--
-- Data for Name: services; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.services (id, name, created_at, updated_at, sucursal_id, duration, margin, category, active, price, description, activo) FROM stdin;
1	Primera consulta	2025-08-26 06:30:14.87214	2025-08-26 06:30:14.87214	sucursal_1	60	0.70	General	t	200.00	\N	t
3	Resinas	2025-08-26 06:30:14.874131	2025-08-26 06:30:14.874131	sucursal_1	60	0.70	General	t	550.00	\N	t
4	Extracción	2025-08-26 06:30:14.875002	2025-08-26 06:30:14.875002	sucursal_1	60	0.70	General	t	300.00	\N	t
5	Blanqueamiento	2025-08-26 06:30:14.875938	2025-08-26 06:30:14.875938	sucursal_1	60	0.70	General	t	2000.00	\N	t
6	Brackets	2025-08-26 06:30:14.876912	2025-08-26 06:30:14.876912	sucursal_1	60	0.70	General	t	150.00	\N	t
10	Cambio de ligas 	2025-08-28 00:40:05.17391	2025-08-28 00:40:05.17391	sucursal_1	60	0.70	General	t	350.00	\N	t
24	Poste de Fibra de vidrio 	2025-08-29 18:15:18.547793	2025-08-29 18:15:18.547793	sucursal_1	60	0.70	General	t	1000.00	\N	t
25	Placa removible con ganchos wiplas 	2025-08-29 19:00:18.04259	2025-08-29 19:00:18.04259	sucursal_1	60	0.70	General	t	4000.00	\N	t
26	Mensualidad de orto 	2025-08-29 19:04:00.257605	2025-08-29 19:04:00.257605	sucursal_1	60	0.70	General	t	500.00	\N	t
30	Cementar puente 	2025-09-05 16:10:48.404306	2025-09-05 16:10:48.404306	sucursal_1	60	0.70	General	t	400.00	\N	t
31	Extirpación de absceso 	2025-09-10 16:40:46.501193	2025-09-10 16:40:46.501193	sucursal_1	60	0.70	General	t	300.00	\N	t
32	Prótesis Fija con acrílico cosido	2025-09-12 22:43:03.078488	2025-09-12 22:43:03.078488	sucursal_1	60	0.70	General	t	300.00	\N	t
33	Pulpotomia 	2025-09-17 19:29:43.034051	2025-09-17 19:29:43.034051	sucursal_1	60	0.70	General	t	1200.00	\N	t
35	Estudio Ortodontico 	2025-09-24 20:09:05.503639	2025-09-24 20:09:05.503639	sucursal_1	60	0.70	General	t	700.00	\N	t
37	Tallados 	2025-10-01 02:09:36.139888	2025-10-01 02:09:36.139888	sucursal_1	60	0.70	General	t	300.00	\N	t
40	Puente de metal porcelana 	2025-10-04 20:47:04.991839	2025-10-04 20:47:04.991839	sucursal_1	60	0.70	General	t	3000.00	\N	t
41	Cirugia	2025-10-04 20:56:35.003663	2025-10-04 20:56:35.003663	sucursal_1	60	0.70	General	t	2500.00	\N	t
42	ortodoncia	2025-10-16 16:59:56.270141	2025-10-16 16:59:56.270141	sucursal_1	60	0.70	General	t	500.00	\N	t
43	Retiro de brackets	2025-10-20 17:06:24.339098	2025-10-20 17:06:24.339098	sucursal_1	60	0.70	General	t	150.00	\N	t
44	Toma de impresión para placa totales 	2025-10-21 00:16:47.252478	2025-10-21 00:16:47.252478	sucursal_1	60	0.70	General	t	300.00	\N	t
2	Limpieza dental	2025-08-26 06:30:14.873308	2025-08-26 06:30:14.873308	sucursal_1	60	0.70	General	t	500.00	\N	t
8	Endodoncia	2025-08-26 06:30:14.878655	2025-08-26 06:30:14.878655	sucursal_1	60	0.70	General	t	2500.00	\N	t
28	Endodoncia terminar 	2025-08-30 01:12:22.9065	2025-08-30 01:12:22.9065	sucursal_1	60	0.70	General	t	2500.00	\N	t
7	Corona	2025-08-26 06:30:14.877756	2025-08-26 06:30:14.877756	sucursal_1	60	0.70	General	t	2500.00	\N	t
45	Limpieza Dental	2025-10-23 00:33:32.861671	2025-10-23 00:33:32.861671	sucursal_1	60	0.70	General	t	500.00	\N	t
9	primera consulta	2025-08-26 20:20:32.5335	2025-08-26 20:20:32.5335	sucursal_2	60	0.70	General	t	200.00	\N	t
11	Resina	2025-08-28 00:46:09.460406	2025-08-28 00:46:09.460406	sucursal_2	60	0.70	General	t	550.00	\N	t
12	Rx	2025-08-28 00:46:16.045445	2025-08-28 00:46:16.045445	sucursal_2	60	0.70	General	t	300.00	\N	t
13	Extraccion	2025-08-28 00:46:21.237293	2025-08-28 00:46:21.237293	sucursal_2	60	0.70	General	t	500.00	\N	t
16	Placa removible	2025-08-28 02:01:41.371176	2025-08-28 02:01:41.371176	sucursal_2	60	0.70	General	t	4000.00	\N	t
18	Cirugia	2025-08-28 02:16:20.462128	2025-08-28 02:16:20.462128	sucursal_2	60	0.70	General	t	2500.00	\N	t
19	Retenedores	2025-08-28 02:19:51.955654	2025-08-28 02:19:51.955654	sucursal_2	60	0.70	General	t	300.00	\N	t
20	Puente 3 unidades	2025-08-28 02:26:53.651623	2025-08-28 02:26:53.651623	sucursal_2	60	0.70	General	t	300.00	\N	t
21	Estudios Rx 	2025-08-28 02:28:39.002518	2025-08-28 02:28:39.002518	sucursal_2	60	0.70	General	t	300.00	\N	t
22	Retiro brackets	2025-08-28 02:30:40.681155	2025-08-28 02:30:40.681155	sucursal_2	60	0.70	General	t	150.00	\N	t
27	Ajustes	2025-08-29 23:12:52.954254	2025-08-29 23:12:52.954254	sucursal_2	60	0.70	General	t	300.00	\N	t
29	Pulpectomia 	2025-09-01 21:06:17.392031	2025-09-01 21:06:17.392031	sucursal_2	60	0.70	General	t	300.00	\N	t
34	Retenedores 	2025-09-19 21:41:17.281567	2025-09-19 21:41:17.281567	sucursal_2	60	0.70	General	t	300.00	\N	t
36	Cementación 	2025-09-29 22:59:43.310875	2025-09-29 22:59:43.310875	sucursal_2	60	0.70	General	t	300.00	\N	t
38	Blanqueamiento 	2025-10-01 21:40:49.199076	2025-10-01 21:40:49.199076	sucursal_2	60	0.70	General	t	2000.00	\N	t
39	Guarda 	2025-10-03 21:20:12.985083	2025-10-03 21:20:12.985083	sucursal_2	60	0.70	General	t	300.00	\N	t
23	Limpieza 	2025-08-28 21:55:53.841008	2025-08-28 21:55:53.841008	sucursal_2	60	0.70	General	t	500.00	\N	t
14	Endodoncia 	2025-08-28 01:13:08.207494	2025-08-28 01:13:08.207494	sucursal_2	60	0.70	General	t	2500.00	\N	t
17	Corona zirconia 	2025-08-28 02:10:29.595621	2025-08-28 02:10:29.595621	sucursal_2	60	0.70	General	t	2500.00	\N	t
47	Radiografia	2025-10-25 20:42:58.519828	2025-10-25 20:42:58.519828	sucursal_1	60	0.70	General	t	0.00	\N	t
48	Placa total inferior 	2025-10-31 19:50:28.283059	2025-10-31 19:50:28.283059	sucursal_1	60	0.70	General	t	0.00	\N	t
49	Corona metal porcelana 	2025-11-04 21:24:49.632217	2025-11-04 21:24:49.632217	sucursal_2	60	0.70	General	t	0.00	\N	t
\.


--
-- Data for Name: sucursales; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.sucursales (id, nombre, direccion, telefono, email, meta_ingresos, meta_citas, meta_conversion, meta_inventario, activa, created_at, updated_at) FROM stdin;
sucursal_1	Dentalux Centro	\N	\N	\N	60000.00	300	85.00	95.00	t	2025-10-23 00:51:06.815469	2025-10-23 00:51:06.815469
sucursal_2	Dentalux Plaza	\N	\N	\N	45000.00	250	80.00	90.00	t	2025-10-23 00:51:06.815469	2025-10-23 00:51:06.815469
\.


--
-- Data for Name: tratamientos_dentales; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.tratamientos_dentales (id, expediente_id, fecha, diente_numero, procedimiento, descripcion, materiales_usados, duracion_minutos, costo, estado, observaciones, doctor_id, sucursal_id, created_at) FROM stdin;
1	2	2025-11-10	32	tallado y cementado	tallado y cementado al diente nuemro 32 por fisura exterior	resina y fresa diamante	\N	550.00	en_progreso	\N	9	sucursal_1	2025-11-10 22:01:09.050306+00
\.


--
-- Data for Name: wa_processed; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.wa_processed (wamid, created_at) FROM stdin;
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNDY3QjAyNkYxRjNBRkI5MDEA	2025-09-08 21:13:35.853736
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzZBMEZGN0IyOEFGQjU2MjIyAA==	2025-09-09 19:56:27.902328
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBREIxM0E4MDA5OUEzQjdCMzVCAA==	2025-09-09 19:57:36.691338
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzU1RkM3N0ZDOUQzQ0REMDRGAA==	2025-09-09 20:01:59.440188
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTZEMjFEMDIyQzYwMDBDQTVCAA==	2025-09-09 21:27:41.312732
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQUExNDY5ODMwNDI2MjAwQ0VBAA==	2025-09-09 21:28:47.15052
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkNCNEEyNjM1QkZFNzUyQzdGAA==	2025-09-13 01:23:35.905738
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNjFBNjlBNzQ5NkIzMTJCMjQ2AA==	2025-09-13 01:24:42.361927
ABGGFlA5Fpa	2025-09-17 20:55:00.409506
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRERFNjZCNTVERDU0RUFBMUFCAA==	2025-09-17 23:38:21.021232
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMDdGQjg1NDJGQUM5RTdGQkIwOTcxQTIzM0MyRjgzAA==	2025-09-17 23:42:04.209674
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDOTJEMkYzNEQyMzZBOTYyMzQ1Nzk2MzBCMkQ0RDY2AA==	2025-09-17 23:42:18.670944
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMDNDMjIyOEFCNjQ0RTY4MEQ0Q0E4NTM1RTEyMzNCAA==	2025-09-17 23:42:42.895391
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRTVDMzA0RkExRUYzQjE1RkQ2MTA4NkFERDVGQjlGAA==	2025-09-17 23:42:51.667829
wamid.HBgNNTIxNjg2MTEwNTcxOBUCABIYIEFDQ0FCRTQ2RDdFNzlEMEVERjYxQzkwRTA4MzJERUY0AA==	2025-09-18 00:47:29.106092
wamid.HBgNNTIxNjg2MTEwNTcxOBUCABIYIEFDMkEzRkE1QTAzNzg5RUQ0QTJDRUM0ODQ1NjE3MURFAA==	2025-09-18 00:47:44.272939
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDgyQ0YxQ0Q1REUwRjZBMzk0AA==	2025-09-18 01:18:58.478281
wamid.HBgNNTIxNjg2NDY5MzE5MRUCABIYIEFDQzdBNDkwNURFQTE4RDVGRkVCNDFFMzIzQTI1ODYzAA==	2025-09-18 01:30:48.329978
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDNGMjAzQTVGN0VDNzQxN0Q5AA==	2025-09-18 01:48:15.900197
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQ0QwMzQwQTU2NDRGNzEyNzIwAA==	2025-09-18 01:48:43.987578
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDEyQ0Q5RTkzMzdERUIwQUY3AA==	2025-09-18 03:02:49.792007
wamid.HBgNNTIxNzk3MTIyMzAzNhUCABIYIEFDNEFCNjcxREZCRDNEMkZFMDJFNEZDRTNBNkEzMDQ4AA==	2025-09-18 03:45:11.812347
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3MkZGODhCRjgyRkFCQTQ5MjAA	2025-09-18 04:06:44.51604
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RUU3REQ1Q0U3RUQ5QkY1NDYA	2025-09-18 04:08:23.419477
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzMDlDM0Q2Q0IzQzgyQTAyRjIA	2025-09-18 04:08:52.016549
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDcxOUI2NkI5MDY0OEMzNkU3AA==	2025-09-18 07:22:36.541033
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzBENkYxNDI4Nzc4MjQzNkMyAA==	2025-09-18 07:26:42.233423
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNUU5NkUzNkU2QkRFMDc0NEIyAA==	2025-09-18 07:26:48.46398
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRUFCRDcwMjNGOTBEMzBCQTU4AA==	2025-09-18 07:28:57.975104
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTg4QUJDQUVFMUUyREFBNTRDAA==	2025-09-18 07:30:03.441605
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRTEyNUUxODQ4OTdGMUQ3RTQ1AA==	2025-09-18 07:40:56.548471
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzY1RjQ4MjVFMzY4QUZBMEYxAA==	2025-09-18 07:41:26.706006
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOUNDOTREREMxNUMxNUU3OEQ5AA==	2025-09-18 07:55:39.242618
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTNFMzJBOTE0RjREMjkzN0E5AA==	2025-09-18 08:24:02.685988
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkQzRTBFMTA3NzFCNkJFNUExAA==	2025-09-18 08:35:32.109749
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMzMzMTIyMTQxMDA1N0RGNDdEAA==	2025-09-18 08:36:01.386525
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjYxRDM3NzY2MEEzREE3MTREAA==	2025-09-18 08:36:11.607215
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNjdERDRENkI3OUQwN0Y1OUVCAA==	2025-09-18 09:09:37.078212
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMzk2REYxNTAzQzU4Nzg5MDIyAA==	2025-09-18 09:09:46.922976
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDJDRjA3NkExRDQ1RjlBMEFGAA==	2025-09-18 09:10:55.269662
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMThBRTdDQjVFQjUxQkJGMkYyAA==	2025-09-18 09:12:41.808998
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzQ0NDI5ODhFQjVFQkI2M0I3AA==	2025-09-18 09:12:56.536949
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTMzMkRDNkRGMkZCN0I4NTIwAA==	2025-09-18 09:13:04.264869
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzkxOTBENzY1RkNFMkM4ODY5AA==	2025-09-18 09:13:53.565754
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBODc4MjIwNjg1Qzk0RTBDQkNFAA==	2025-09-18 09:13:57.600187
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDIyQjJGQkUzNzEyRjJDQjQwAA==	2025-09-18 09:16:22.855891
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzE1QTc5MERCQkZFRDIyMkI5AA==	2025-09-18 09:19:49.489284
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBRkVCREJCMjEzQzU0REU0MEEA	2025-09-18 09:21:11.380048
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOTAxRjQ3QjJDMUNGRjgxMUIzAA==	2025-09-18 09:29:59.854557
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjM0QTY0M0RBNTNCM0JBQUIwAA==	2025-09-18 09:30:07.883896
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNjdFOURBQTkwOUZBOUJCMUMwAA==	2025-09-18 09:30:22.175752
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTAxOUM1NjBCNDg5QUJFNzdDAA==	2025-09-18 09:30:33.10585
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkIzRDQ4NjZFOTlENDU1OEI4AA==	2025-09-18 10:18:11.875385
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNENCQzYyRkE1Njg2RjU5MTVGAA==	2025-09-18 10:18:20.264668
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMUUzOUEyNzZFMzU1RjA4QUYwAA==	2025-09-18 10:18:45.795361
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQUJDMDJGMTk1QjU2QkY5RTQ3AA==	2025-09-18 10:34:10.227344
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRTIyQ0Y0QTkzOEE1OUUxQjc1AA==	2025-09-18 10:34:14.162674
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDZDOEQ0RkZFNUYzOEY3Rjc2AA==	2025-09-18 10:35:03.833097
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkNEQUVDQUJERTA3QkQyQTkwAA==	2025-09-18 10:35:28.509462
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzE2OEUwRDlCRTRGMjEyNzQ0AA==	2025-09-18 10:35:43.492819
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBODk2RkFDNERFODgzQzQwOTFGAA==	2025-09-18 10:46:12.470851
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzQwNDU5OUIzNTQ3NzNDRjc4AA==	2025-09-18 10:46:16.852311
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNUNGNjc3QTBCNzAwNjBBRUFGAA==	2025-09-18 10:46:43.199549
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNUU1REIxNDU3RTU4QkIwRjczAA==	2025-09-18 10:46:52.810283
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOUEwODg3QTQ5RURCREJDNDg3AA==	2025-09-18 10:47:52.474415
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjg1QkZFQUI3ODdCRjQ4ODUzAA==	2025-09-18 10:47:57.246045
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMzQxOTA0RDFEMjcyRjdBOEZCAA==	2025-09-18 10:57:50.269415
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjMwMjY5NkYwMEQ0MkIxRkQxAA==	2025-09-18 10:58:02.862507
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjIxRUE2QzE4QTFCRjUyMjA1AA==	2025-09-18 10:58:19.390379
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzA2RkYwMDYzQzg4OThDRkY5AA==	2025-09-18 11:20:43.1625
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQ0FCMzc5N0FCOTg4MEU1NUE0AA==	2025-09-18 11:21:41.705923
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjg2M0IyREM4QTdEOTI1NjkxAA==	2025-09-18 11:21:46.762346
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjYzMUYyNUY1OTNGRDI0Q0I5AA==	2025-09-18 11:22:00.786465
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkQ4QkVGRjg0RDA5OTgyMTczAA==	2025-09-18 11:32:52.006552
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkJGMUUxMTRGQUVDQ0Y5NTBGAA==	2025-09-18 11:32:57.034808
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjlGQkY0NTYwN0JFMDNCN0RDAA==	2025-09-18 11:33:09.993543
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTdDQjEwNjNBQ0RCQzk2NzQzAA==	2025-09-18 11:34:59.465575
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjcwNDhFNjhDRTYwRDU2MkNCAA==	2025-09-18 11:35:06.472952
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBODI0MUUwOTUzQTQ1RTZCMEE4AA==	2025-09-18 11:35:14.457207
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjgxMkExNDgxMTIxRDY2NEE3AA==	2025-09-18 17:11:31.76266
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMzRCMDU2QzA1ODdGMEMzQTFDAA==	2025-09-18 17:11:48.592209
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzgzNDM1MjkyRDVBOERCQTgzAA==	2025-09-18 17:51:25.083443
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQ0NDRkJGNUEwMTM2QTQ2ODY4AA==	2025-09-18 17:51:31.448166
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTBBNTk3RTA2QjMxN0MxQjZGAA==	2025-09-18 17:51:35.316818
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQ0ExMEMxQjg5RjIyOEU3RDIyAA==	2025-09-18 17:51:46.821052
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyQkI4RjRCMjkxQkMzRDAyMUYA	2025-09-18 18:08:35.964625
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4NjBDMUI0MDc5MjI4NDc4NTAA	2025-09-18 18:21:45.87751
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEOTExQkM4REFEM0U4QUI2NzcA	2025-09-18 18:21:50.3037
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNzMzREZGN0I0MTZCRDBFNjYA	2025-09-18 18:22:09.318509
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyQzYzQUY5NUQ2OTdBOUVBNEMA	2025-09-18 18:22:39.283768
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MUQ3NUFFQjFBNDFDNjg3ODEA	2025-09-18 18:24:09.572338
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MjIxNTk0MkU0Qjg3OEM0OUMA	2025-09-18 19:14:57.70012
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEN0JCRjExMUUwQUY2OTcwNEMA	2025-09-18 19:15:39.525188
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzOEM1MkIxNkRBNjMzQ0QyRTAA	2025-09-18 19:16:10.113336
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDN0Y5MUE1QTdGOTk2NzI2NDUA	2025-09-18 19:16:14.585918
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5RDA0ODY0NTQwQjMyNDU4MjYA	2025-09-18 19:16:42.599818
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDOThDOEIzN0YyMERBREM4NjgA	2025-09-18 19:17:40.309669
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyQjI4QjgwMzhDNzdGQkJCRUQA	2025-09-18 19:19:37.892036
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBODA0OUZFMUZFREE1NUE3MDIA	2025-09-18 19:20:03.391322
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MTM4QTNERjMxMDk5NzYxRjMA	2025-09-18 19:24:28.067144
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4OTJDNTE4MkMzNTk5QzkyNEMA	2025-09-18 19:24:34.772475
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RkVEQzg5OTI2OTA2NkM2NDQA	2025-09-18 19:24:47.181452
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzQTI0M0EyQkQ5RUI0Q0I5MzEA	2025-09-18 19:25:11.307119
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQTFFQTMxRTJFNUUzRDg0ODIA	2025-09-18 19:25:52.209206
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5RDdBQUNEQ0VENzhBRjVDRkEA	2025-09-18 19:25:56.40362
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1M0I3NDkxN0FBMDUxMjE3QkEA	2025-09-18 19:26:07.704947
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNjcyREI5Q0NBQzA5MDY0MTkA	2025-09-18 19:27:13.575401
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2MUQ0QzZENDFGRkI4NzdBNkYA	2025-09-18 19:27:17.702619
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCRDhFRDdGNjA4Qjg5RTNEMTEA	2025-09-18 19:27:33.97778
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDMEJEQUM2Q0UzOUQ3RDE5ODMA	2025-09-18 19:27:48.50256
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMkE3NjFGNzYyNEM5NzQ4MUUA	2025-09-18 19:27:51.966528
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwN0IxMERCQjMwQzFCNDRBQkMA	2025-09-18 19:28:08.588071
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1NjA0RjZEOTQyQkFDNDhGQ0UA	2025-09-18 19:28:24.688902
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRDhDNzAyRTA0Qzg1ODA1NzkA	2025-09-18 19:28:58.549246
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMDQ5Qzk1RENBNEE1MjhEMTYA	2025-09-18 19:29:03.355779
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQUNCRTc4RDRFRkNFQzEzN0UA	2025-09-18 19:29:19.961405
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOEVBQUJFMkFGQjgyQTVCRTVFAA==	2025-09-18 20:26:18.822419
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjVCQjhBQTkyODg3NzVDNTIzAA==	2025-09-18 20:26:28.735048
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjRCQTEwRjQ5Q0E5OUNCRjg5AA==	2025-09-18 20:27:06.158164
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMUZCMzlCNTRGQTQ2OUM3QkU1AA==	2025-09-18 20:27:21.302323
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMDIzMzY0NTcyODVDMjhEQzkwAA==	2025-09-18 20:27:36.304211
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTU1MjJEQUEyRjI2QkY2ODJDAA==	2025-09-18 20:27:45.77798
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRUM1NkUwQTU3RkNEMUZFNkQ0AA==	2025-09-18 20:27:54.026426
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOEI3NkMwMDM4MDhGRTM3NjFFAA==	2025-09-18 20:28:12.308547
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDRDNTc3RENBOTUxNDIyMTIwAA==	2025-09-18 20:28:21.795369
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzMzMzQyNEZEOUJDRUM1OEE4AA==	2025-09-18 21:02:54.734838
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRTBCMDQzRjhBN0MwRDZBNzE5M0UzRUVGRUJFQTVCAA==	2025-09-18 22:20:19.552663
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMERCNTIzRkI5NTBBQzM2NDg2MzA2NTZBNUVEMUE1AA==	2025-09-18 22:20:27.213912
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRkQzNTIxMUYyQ0YzNTZBRDhGMjQ4MjMxMjg5NjIyAA==	2025-09-18 22:20:36.486178
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNjdEMTI3QkRDMEM4NUI0QURCRkQzRTA2MkRENDQ5AA==	2025-09-18 22:20:43.495315
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNkQyOTc0MDVFOTEyRUMwRDgyMDREREY2Q0EyNUM3AA==	2025-09-18 22:20:53.176448
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDODZGMDk1ODRDNjU0MEUwQjY4ODEzREU0NzA1MEIzAA==	2025-09-18 22:21:10.915182
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDOERFNkRDQzIyOEEwMkQ3Rjk0QjUyQkY3NzMzRUJEAA==	2025-09-18 22:21:31.063545
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQTVDOUE1RkIyNzg1NjIxOENERUZDM0NCQkU0MkY4AA==	2025-09-18 22:21:35.920734
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDOUFFRDNFOEFCRTJCNkE0N0VENUIyNDAzQUVCMEYwAA==	2025-09-18 22:22:08.004403
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNjRERTlGOEY5QUVGRTU0OTNFRDBFMTI0MTdGOUM3AA==	2025-09-18 22:22:15.594042
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRUM0Q0IyNzkyMjQ3Q0I2Qjg0QkEzQTkwQTE1QTk3AA==	2025-09-18 22:23:17.026102
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMzlBNzU2RkI3RTFEQjlERjlGMEE0MjIxNkFDOTRFAA==	2025-09-18 22:23:24.473994
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQzZDRDhGNjVEOTlDRUMzNjAxQzU4NTBGNUM4RUE0AA==	2025-09-18 22:23:42.213187
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRjNGMDVBRDZFMTUwQUQ0RTk2QjM4REJCMTM5NzhFAA==	2025-09-18 22:23:54.30358
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMjg1MEJCNEY2RkQ0RjdCMzg4OEZGQzA2NUVEQjY5AA==	2025-09-18 22:26:22.9888
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMjdFRkUyMjRGNUI5M0FCNDY1OUU1ODU0QTJGMzk4AA==	2025-09-18 22:26:49.39095
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRUI5ODRERjVEODZDRUQ2RTEyAA==	2025-09-18 23:21:23.534648
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMDQ2NEQ4MjFDOTkzQzdDMjExAA==	2025-09-18 23:22:06.401678
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMUUwMTc2OTM4OUNGNjAyNTI2AA==	2025-09-18 23:28:51.748768
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjFFNDk4QTQxNTBBMzg5RTI4AA==	2025-09-18 23:29:38.78782
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjEyODBBMkYxNzRDODY5MEJFAA==	2025-09-18 23:43:17.067007
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMUIwRjAwMzM3Nzg1OTZDOTc5AA==	2025-09-18 23:54:40.136667
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjJCMDFCQTM4QzdFMUNDRUI0AA==	2025-09-18 23:58:27.541984
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOTg1NTU0QzczMTAxMkE4NjAyAA==	2025-09-18 23:59:12.177383
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjVCNjUxMUFFMUM4NEQ2NzJCAA==	2025-09-19 00:04:27.839324
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNEUzQzdGRUMzNTFBQkNEQUE4AA==	2025-09-19 00:20:09.72349
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMThDRThGNzlEQzU5RUQyQzhGAA==	2025-09-19 00:37:42.985809
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTQ2MENCRTQ0MkFENDM5MDFBAA==	2025-09-19 01:04:14.849325
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMEEwRjBGODI2MDQ5OUMzOTgzAA==	2025-09-19 01:04:30.997829
wamid.HBgNNTIxNjg2MjQzNjA1MxUCABIYFDNBNzc4MUEzQTk5QjJCMDBDQUQ2AA==	2025-09-19 21:47:16.847872
wamid.HBgNNTIxNjg2MjQzNjA1MxUCABIYFDNBREUyQTEyMjlBQkI5RkU4QkExAA==	2025-09-19 21:47:46.887637
wamid.ps.fallback.001	2025-09-22 06:29:24.87176
wamid.ps.faq.001	2025-09-22 06:29:55.224652
wamid.ps.agendar.001	2025-09-22 06:30:08.999725
wamid.ps.agendar.002	2025-09-22 06:30:20.436204
wamid.ps.asesor.001	2025-09-22 06:30:30.77824
wamid.ps.confirmar.id.001	2025-09-22 06:32:13.371827
wamid.ps.cancelar.id.001	2025-09-22 06:32:45.182487
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjZBN0U5MzdFQjIzN0RFREUzAA==	2025-09-22 06:38:47.617242
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzczNUE5QUVFQzI4OEREMTI2AA==	2025-09-22 06:39:00.91556
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRTFGRURCNDQ2RjU0RTcyMEM1AA==	2025-09-22 06:39:34.903533
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMEI1QTU0NEMzNDEwMTAxRjk1AA==	2025-09-22 06:39:55.40551
wamid.ps.confirmar.btn.001	2025-09-22 06:46:13.922879
wamid.ps.cancelar.sinid.002	2025-09-22 06:48:33.77384
wamid.ps.confirmar.btn.002	2025-09-22 06:49:13.760965
wamid.ps.faq.002	2025-09-22 06:49:41.729897
wamid.ps.fallback.003	2025-09-22 06:50:24.516358
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkYzQ0U2ODAxNDUxODk1QkU1AA==	2025-09-22 07:04:22.888896
wamid.ps.fallback.004	2025-09-22 07:05:39.177532
wamid.ps.fallback.999	2025-09-22 07:08:28.082168
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2QjREMzAxOTgwNzZCOENFMkEA	2025-09-22 07:31:55.877437
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RDFGNUI1RTc3RkFCRjFBRkQA	2025-09-22 07:32:43.615952
wamid.ps.fallback.1001	2025-09-22 07:47:42.693088
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2Mzg3RDZGNTNCNkJERjUwNEUA	2025-09-22 07:55:09.374376
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNjYzQ0RCRjUyNUZCNjkxNDYA	2025-09-22 07:55:39.306159
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3QkVERjA2Qjg0OTM5MTI1OUQA	2025-09-22 07:57:18.861477
wamid.ai.horario.1	2025-09-22 08:28:46.372373
wamid.ai.ubi.1	2025-09-22 08:29:09.557288
wamid.ai.pago.1	2025-09-22 08:30:22.264984
wamid.ai.tx.1	2025-09-22 08:31:20.245025
wamid.ai.dolor.1	2025-09-22 08:55:18.455051
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyODM3M0U4REIyNDU5NERGRDgA	2025-09-22 09:07:41.626869
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQjg4MkFEREU5QTlBQ0E5MDQA	2025-09-22 09:08:12.208797
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNzgwQjAwM0QyMUI1NDA0QkIA	2025-09-22 09:08:24.057412
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxRDA0QjAyODUwQjU0MTE5QkIA	2025-09-22 09:08:46.46273
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4REVCMDA3RDdFMEUzMTVGRTAA	2025-09-22 09:09:00.192458
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyNEI0QjdCOTkzNkU3OEY1NTkA	2025-09-22 09:09:24.964118
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDRUU1MDkzQ0Y0QzdCMTZENzEA	2025-09-22 09:10:22.21058
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRTQ5MjlCQzhBRDQ0M0M1MjcA	2025-09-22 09:11:08.809838
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RkI0NjE5NkQ4NzhDN0RFMTQA	2025-09-22 09:12:01.996673
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQjQ1NkJGOEE1MEUxOENGMjQA	2025-09-22 09:21:21.020041
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RDZDQjdBQTdCNUVGODNBNkYA	2025-09-22 09:22:12.008913
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNENGMjRCQzRDQkQxRDU3MDIA	2025-09-22 09:23:02.625121
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNDY0OTgzRDkyNzBBRDQ3QzMA	2025-09-22 16:57:19.677292
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzODE2MTkzMTg5MUFEOEQxNzkA	2025-09-22 16:58:49.040029
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMDk5NURCNTdFMTIwQjJGMTAA	2025-09-22 17:15:08.226111
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNzBBRjY0Mjk2MThGQjY4NEEA	2025-09-22 17:15:24.060412
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMDVCQkE2QzFCMEE0QUVDMkQA	2025-09-22 17:20:45.202066
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3RTM2RjcxMEYzN0ZGQkFDNjYA	2025-09-22 17:49:51.630359
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQzU2RDY4QkZDQkQ3Q0Y1MDkA	2025-09-22 17:50:27.621687
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDRERFQTgyODhFQTYwQ0MzNjkA	2025-09-22 17:51:50.884893
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNTA4QzQxNTkyRjcxQzQ4NzAA	2025-09-22 18:16:06.969975
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzOTlEOTFEQzcwQzE2QjdCNDcA	2025-09-22 18:16:21.157593
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3NDRCQUMxNkY5OTVGQjVCN0QA	2025-09-22 18:16:49.233564
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQTU4MjdENjFGMTYzRUU4Q0MA	2025-09-22 18:17:16.204204
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMjdBN0JENTIzRUFGRDk1OEUA	2025-09-22 18:17:27.602096
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MEEzMkY0MEVGQkFEM0I1MkQA	2025-09-22 19:15:25.038847
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDRkQwM0EzMjlDNkZDRTI4QThGNDI5OTFDRkU5ODRFAA==	2025-09-22 19:16:44.387721
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDQ0ZEQTkzRTZEQjE5OUY5NERBODZCOTAzRUVENEM0AA==	2025-09-22 19:17:59.122355
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDNUE2RDEzOEQwRjVCODIxRENGM0FFRDAzQjFDRkEyAA==	2025-09-22 19:19:06.336853
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxMjk0OTIyREIwNDg0NjA4OUMA	2025-09-22 19:20:18.678519
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NTcyQzZERkZBQjgwMzdFQTgA	2025-09-22 19:21:25.343566
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQTc0MDlBMjhCN0U3OTJBQzUA	2025-09-22 19:21:39.907106
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MDdBRkE5QTdFQjcxQ0U2NTYA	2025-09-22 19:22:19.386785
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBQ0Q2NjkwNDI5QkMwMTk5NjdEAA==	2025-09-22 19:23:33.745226
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBMDNCNTREODUyODM4ODFDREI2AA==	2025-09-22 19:24:36.022549
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBQTY1RjJBNkVDNTc4OTlGQjk0AA==	2025-09-22 19:24:53.928064
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBRTQ3QzBDMEYzOEEzNEJFMzI4AA==	2025-09-22 19:25:22.047765
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBNEVFOTg2QzI3OUY5NTIyMjhBAA==	2025-09-22 19:27:27.212756
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBNTU3N0NEQkUzRjRCRUE4M0FEAA==	2025-09-22 19:28:06.480708
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBODY2ODhEQUVERTE3Q0I5MjQ5AA==	2025-09-22 19:28:13.766301
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUJDNzdGMEZDQTBEMTkzM0YxMgA=	2025-09-22 19:55:48.893111
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQjk5OTYzMUI4NDk1NEY3QjIA	2025-09-22 21:14:38.122057
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MjE0M0E4QzAyQUMzMzE2NDIA	2025-09-22 21:15:00.972668
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRjJDRTUyNDU5QURDODY2QTkA	2025-09-22 21:15:18.670096
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBQTA0RDI1QzJGQkNFNDQ4MEVCAA==	2025-09-22 21:34:24.263347
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2QTRCNDJDRENDQzhDRjczOUIA	2025-09-22 21:36:36.238364
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBNkE2MDQ2QjhDQjFCMzFFOTcA	2025-09-22 21:54:24.793597
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwNEFBQkM2QkNBNkU4MzlCRUIA	2025-09-22 21:54:49.901064
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBERTM2MjY1NkFDNTVEMDRGQTgA	2025-09-22 21:55:38.923215
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBNUVBNEUxM0E3MDQzMzk2NUEwAA==	2025-09-22 22:09:09.726411
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQ0E3QjY0QkFENDZDODI0RDAA	2025-09-22 22:20:03.52077
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzREUxQkZCM0RCNjg5MTEzRUEA	2025-09-22 22:20:38.166811
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0M0U3MDM4NTlCQ0M0MUY1NzgA	2025-09-22 22:20:49.123776
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4OEU0MDkwREU1MTQ4NUE4OUUA	2025-09-22 22:21:03.231225
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFRTBEOTY1MjJBRjVGN0Q0NkYA	2025-09-22 22:21:19.872471
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NjI5NTUyRDY3MzRBQUU3NzgA	2025-09-22 22:21:49.343924
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3NTc5MzU4QkZFNjk3REI5OTkA	2025-09-22 22:22:12.75956
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQzI5OEM4MTU1RjUxQzk2RjEA	2025-09-22 22:22:34.543414
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMEQxN0Y4QkNENzhGRDc0QTgA	2025-09-22 22:22:47.952562
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RjJGRkZDRUJCRTc1M0REOTEA	2025-09-22 22:23:07.913131
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRDQwOUM1QTcxQzIwNEU1RDAA	2025-09-22 22:23:15.135471
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQjRBNTYwQTI2NTU5MUNCMkYA	2025-09-22 22:23:41.317843
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBRjE4OTc4MDQ4ODQzOTIyQ0ZBAA==	2025-09-22 22:25:28.672858
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBNTM1NDg3NkMyMjYyOTFBRTFDAA==	2025-09-22 22:26:01.345527
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBMkYzQTM0QkMxNEE4RUQyMzQwAA==	2025-09-22 22:26:11.144669
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBQjAxN0NDRDlEQzBEQjA3QzRCAA==	2025-09-22 22:27:12.459604
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBMTA4NzFGMUE4QUY5QzkzOEFFAA==	2025-09-22 22:27:34.419332
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBRTU1QUJGNUIwM0IzOTdGMjYyAA==	2025-09-22 22:27:40.338097
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBNTYzRUM3NzVDRUZDODM2NzE2AA==	2025-09-22 22:34:32.951966
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzBGRkQ5MjFBQ0VCNEQ5QUMyAA==	2025-09-22 22:38:50.975925
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTQ5NTQwMkRCMkVCMzI4MjA2AA==	2025-09-22 22:39:06.340458
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDRFQzBFQzQ4RkMxQTMxRjRDAA==	2025-09-22 22:39:35.200971
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMkM5MzE4M0MxNDgwREVCREFDAA==	2025-09-22 22:39:40.178744
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBMEVFRkU2RjNEQUZBODM5NjFGAA==	2025-09-22 23:04:25.863798
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBQ0Y5RDlBN0U2QjhBMUYzODdBAA==	2025-09-22 23:04:44.097542
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBODBCOTY1RjRCMTNDMTgyN0QzAA==	2025-09-22 23:05:04.777729
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTQyNUMyREU2REJDMUM0NzFGAA==	2025-09-22 23:05:39.716293
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1QjY0MjNGMEI0QjgwNTMyQ0EA	2025-09-22 23:14:17.66557
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMUQzQ0MwQTQ1OTg5NkU1QzgA	2025-09-22 23:14:46.137384
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4MDQyRTVBQjc5NzJGRDIwOEMA	2025-09-22 23:21:38.676767
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1Nzk1QTJCMTQyRTEzOEQ0N0QA	2025-09-22 23:28:32.815981
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RTgzNDMyRjhENDg4RUE0MTQA	2025-09-22 23:29:01.085526
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMDQ5OTlDQTZGRDA4MjI4REEA	2025-09-22 23:29:22.280871
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyNUNGRkYxQTc5NjJDNkY5QzUA	2025-09-22 23:35:55.44181
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyOTczNUFBMzMxNDY2RDk2NzcA	2025-09-22 23:36:17.196781
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQkI3RUQ4OTcyNEJFODE5MzkA	2025-09-22 23:43:11.269585
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0QkRCNTBEQzdFMzUxQUU1MkYA	2025-09-22 23:43:26.094915
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1OTIxOTZGRjY2MkM1N0VCMUIA	2025-09-22 23:52:07.325218
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5RjMzNUJBNkJFRUFCRTQwQTMA	2025-09-22 23:57:04.08899
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRDMyQTBDNjc1NzQzOEEzNzQA	2025-09-22 23:57:16.791632
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBNTY5NzczNENFOEQ0QzlDNTQA	2025-09-22 23:58:25.440023
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCRUU1MzdCMjlEOEU2MEU2MDkA	2025-09-23 00:02:29.920959
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDRTE2NDIwQzY0M0ZFOTkzNzYA	2025-09-23 00:04:21.97132
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3QzE5NjgxRDQxMjc5NUNDNjUA	2025-09-23 00:04:38.857148
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzMTM3QzJENzU4QjM1RjVGQkYA	2025-09-23 00:04:58.343976
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1OTMxMTM3RDFCRDZEODE0RjkA	2025-09-23 00:06:44.580349
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3OTk2MkJDRjMwQjdCNEFDNTAA	2025-09-23 00:06:56.146307
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NzAwMUE3QzkxMEQzRDBBNDAA	2025-09-23 00:18:26.011859
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNjQwMDhFN0UzNTRERDY0NkMA	2025-09-23 00:18:48.177875
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBNDEzQjY5M0NERjA3RjcwRkIA	2025-09-23 00:37:44.253575
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCODRFNzExQjI2Q0Y3NTIzNDcA	2025-09-23 01:02:35.53383
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQzMxNTc0QjFBMjA5MUIwNzMA	2025-09-23 01:03:22.152616
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1QkQ0MTcxNDhCQkNDMDNFODcA	2025-09-23 01:05:23.189463
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDNkUxOUEyNEFEODFCQzU4REUA	2025-09-23 01:05:46.773552
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2ODk0OTMwNTg1MjA1MTE2NjYA	2025-09-23 01:05:50.431654
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBQjE0MEQwM0U0QTIzMjY4MjAA	2025-09-23 02:13:25.068765
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBERENCM0MzNDJCN0RBOUNFNzYA	2025-09-23 02:13:56.424952
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4QjI1QjMyNjAyMUIxODhBNDQA	2025-09-23 02:41:06.649114
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4MENFOUYyNUUwRjQ3M0NEQTIA	2025-09-23 02:41:44.38566
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMjU2Q0E3Qzk0NUYxRkFCNTgA	2025-09-23 02:42:48.494995
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5MjM2QUM4MkNFMEE3QTRERUYA	2025-09-23 02:43:05.103095
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxOTRGNzEwQ0RFNDREMEU5MEMA	2025-09-23 02:43:16.768212
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNUYyRUY4NDRBNzE0RDY3NDcA	2025-09-23 03:11:54.467507
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNTVCRTY2NzBBM0U0M0U4NDEA	2025-09-23 03:12:11.944729
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2OTRGMERCM0I1NUE3Mzg3RjAA	2025-09-23 03:12:44.795692
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzRTgxNTMzOUZGMzkzNkQ0NEYA	2025-09-23 04:14:03.520831
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxODY4NkJDMDQzRkExQURBQkYA	2025-09-23 04:14:32.247036
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NkM4MDA3RjZDMUQ0M0NEMjgA	2025-09-23 04:40:27.920714
wamid.HBgLMTkyODI0ODk1NDIVAgASGCBBQzY5RDIzQkNGNDQwOTBEMDk0MzRFMUJGOEYyOTUyNgA=	2025-09-23 04:42:50.010726
wamid.HBgLMTkyODI0ODk1NDIVAgASGCBBQ0VBQkQwQTkyMzQ3RDNERUY1RUFDNTI0RkQ2NUVFMQA=	2025-09-23 04:43:25.720186
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUY4NTJGOUI2MTY5QTZEMTA1MAA=	2025-09-23 05:07:14.62683
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUNDMkYyMTdDOTYxNjU1RTk5MQA=	2025-09-23 05:08:34.615182
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUZBNUFBNTJCQ0JDMzBGQkFENwA=	2025-09-23 05:08:56.167169
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUNCRTcwRTgzMkFENEE4OEJEMAA=	2025-09-23 05:10:50.360964
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUUxNDZERjAwQjQ4RjYyNDk1MgA=	2025-09-23 05:13:33.544055
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQTY3MTBFM0NBQkEwMjU1NDA4QwA=	2025-09-23 05:14:12.400025
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUIwNkI3MUQ2QUY0N0QwOTBGOAA=	2025-09-23 05:14:48.178129
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMjRFRDBBOUQyMkJFNkFCQ0YA	2025-09-23 15:59:49.368512
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3RjdBQTczOTIxQjRFNTc1MkUA	2025-09-23 16:01:27.387096
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNEIzNTM1REIxOTJBRjc1RUEA	2025-09-23 16:02:45.202465
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMzI1MEVERDVEQkNGNTcyN0UA	2025-09-23 16:29:36.793452
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MDI3NTEyMTg0OUNBODNEOTQA	2025-09-23 16:30:16.693795
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMEJDNzk2QzQ5M0I0NzZGNzUA	2025-09-23 16:30:31.985972
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RjdDMEZDQzNDQzk5OEJGMEQA	2025-09-23 16:31:56.201666
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQjk4Q0UzM0U2N0U1QkYwODAA	2025-09-23 16:32:16.533993
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MDJFRDI5NTk2ODA5MEU5QjUA	2025-09-23 16:33:59.978226
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCRThFMUJEODNEOTFBNTM5RkMA	2025-09-23 16:34:29.001735
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRjMwMEZENThBNDQ1MDIzMjkA	2025-09-23 16:35:04.774301
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1OEQ2RTlEMEE4NkM4RkUzMDQA	2025-09-23 16:35:31.930563
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxOEU0OTVBNEM5RDRGQTI5OEQA	2025-09-23 16:47:44.198637
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5NjQ0QUJCRjY0QkZCRjY5QUQA	2025-09-23 16:48:00.440203
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NEJEQkVBQUYyOEY5NzExQTkA	2025-09-23 16:49:03.371449
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxMzlBRDI0N0VFMkY1NTk0MzYA	2025-09-23 16:54:58.702408
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzQjcwQTZGNTY0MDMyMDIzNEUA	2025-09-23 17:01:25.061139
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMUM5Njk1NDNDMEJDMjM5RTMA	2025-09-23 17:35:03.046155
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2Mzk4MDE0N0M4NDQ3N0YxMEQA	2025-09-23 17:36:57.4966
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBRUMxMzQ0M0VBM0ZBMkI3MzQA	2025-09-23 17:46:20.598392
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxRTdBNjNCNDI2MDJCQzFBRTUA	2025-09-23 17:46:34.429952
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQ0FEMDcwREVFQTAwQTRFQzcA	2025-09-23 17:46:42.791328
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMDlENjFCQzFBRUJFMUM1QzEA	2025-09-23 17:46:51.752739
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwNENGMENCOTkwQTFCOEVEMEEA	2025-09-23 17:53:46.144475
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzODY3OTI3MTMyRDRCQjkxODgA	2025-09-23 17:53:56.9844
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBQzQ0MDU1MjM3NERDRkUyRkMA	2025-09-23 17:54:11.653154
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQTk1MTYxQTkyRERFNkZFRjQA	2025-09-23 18:45:35.417935
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3NjA1NjRFQzlGMUE3NTFFNjYA	2025-09-23 18:52:46.393399
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyODZCMkIzOTlEMzQyRTlCQUMA	2025-09-23 18:52:53.387779
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4OUY0Njc3M0NDN0QwNDA2NDYA	2025-09-23 18:52:56.997448
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4RTA3RTBDNjcwODIzQ0FBNEIA	2025-09-23 18:53:26.541101
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFNzFEQTY4NTY0QzU5MUY4RkQA	2025-09-23 18:58:50.136324
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDNjQ5RUMzNDUwREZCRDQzRDEA	2025-09-23 18:59:14.573129
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4OTVGQkNFNzJEOTcxMTg4QTAA	2025-09-23 18:59:24.250616
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBENEYwMDUyRjM0NEREM0MyNEUA	2025-09-23 19:08:20.870763
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RUJCNzA1MUY2QzY1MkQyQjgA	2025-09-23 19:08:27.187805
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3Qjc2MzAwMjdCQjREOTUxMUIA	2025-09-23 19:08:40.636928
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4RjZBQzVBNTIzNEMyRDBERjQA	2025-09-23 19:08:52.22055
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4M0Y3RTFBRTAzNzYzMjY2NTcA	2025-09-23 19:13:18.725372
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMTQyMzI4OTczNjU0NDU0QjUA	2025-09-23 19:13:28.295357
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBENzRENUYxM0JFMUYzQTI4MjcA	2025-09-23 19:13:43.587803
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NDU1REE1NkRERTYxODI3REEA	2025-09-23 19:13:53.495426
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3RDdGRUFCNDY2RkY0Nzc5QkIA	2025-09-23 19:19:38.664486
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyODhBRjVEQTdEQkE2MEEwNUEA	2025-09-23 19:19:53.536271
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RkZBMTE5ODcxNEQ0QzhCNzgA	2025-09-23 19:21:02.5014
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMjMxNUQ0QkZDOUFDQjUxOEIA	2025-09-23 19:21:19.690587
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3MTEwQzNDQkVGRUU2RDc1NTEA	2025-09-23 19:21:31.949738
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQzJFODkyRTQyNjQ3MDhFQjIA	2025-09-23 19:23:31.961619
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMTY4RTFEM0FCREFFNzdFNTMA	2025-09-23 19:23:42.812469
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyNEQ2Q0Q2Q0YwQzYyQTBGMEUA	2025-09-23 19:23:56.059492
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNjY4QTJCRDkyNkU2NDUwQzAA	2025-09-23 19:30:37.799649
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQjY1Q0M2MkMzNjVENDczMkYA	2025-09-23 20:50:45.998833
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzMDJDNEVGRTIxOUE3NzM4NkUA	2025-09-23 20:51:00.941989
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQjMyRTgyMjM3NDE0Mjc4QTEA	2025-09-23 20:51:08.309815
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2OEI2REJCMTI5MDY0RTg3MjAA	2025-09-23 20:51:27.165445
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2OTUxNTgyMDk5OTc1MjI3NUYA	2025-09-23 20:51:32.911336
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4ODMzREUzODcyN0NEQTU5NTEA	2025-09-23 22:16:57.483681
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQUE2OEQ0RkZCOTNCNTU1MDkA	2025-09-23 22:17:06.306864
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5Rjc4MDc3N0NGMDREQjA3NzYA	2025-09-23 22:17:26.118064
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCOEI1NDY1MkJCMTY0RkFDM0UA	2025-09-23 22:17:32.575581
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBM0FDMUQyNjk4NjhFOTM1ODYA	2025-09-23 22:18:18.994017
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4NjMxQkZBNTBDNDY1MDAzRUEA	2025-09-23 22:34:52.380131
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMDk4NzY1QjM5NUYwRTdFOTEA	2025-09-23 22:35:10.679232
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBERjVDN0QyRUEwRERBNEQzOEMA	2025-09-23 22:35:18.748236
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBREIxRTlDNEJGRjA5NEFEOEYA	2025-09-23 22:35:38.587095
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2QURGRjUwNUExNTUxMUQwNkEA	2025-09-23 22:35:48.546448
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3NDgyN0E3NjQ5OURCOUE0MkEA	2025-09-23 22:36:17.592289
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGN0RDOEUzMEUwOTA0NjY0RTEA	2025-09-23 23:04:58.960596
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBRTZBMTM5RTUwNDBDNENCRERBAA==	2025-09-23 23:05:35.725881
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBRjNCQ0NCNUEwRDk1QzYxMDhCAA==	2025-09-23 23:05:49.250541
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBNjA4MjcyQTlGNjU5MzA5ODg5AA==	2025-09-23 23:06:48.188601
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBQTJBMkQzQTNBRTYzMjEwMEYxAA==	2025-09-23 23:07:11.720031
wamid.HBgNNTIxNjczMTA3MzMxNRUCABIYFDNBNTU0OUFCNkYwNzQ1Q0U2MDlDAA==	2025-09-23 23:07:25.520294
wamid.HBgLMTkyODI0ODk1NDIVAgASGCBBQzIyN0FBNjk4REM1NkJFQ0U4RjRDRENCRDlDREE2NwA=	2025-09-23 23:09:59.345534
wamid.HBgLMTkyODI0ODk1NDIVAgASGCBBQ0U2REE3M0JEMkJGNjk1RDNBODdFMjk5Q0NGNTQyOAA=	2025-09-23 23:10:10.660286
wamid.HBgLMTkyODI0ODk1NDIVAgASGCBBQzkxNTA4QjhBNDc4RjIwRjdCRDRDRjE2QkFCQ0M2MQA=	2025-09-23 23:10:42.71679
wamid.HBgLMTkyODI0ODk1NDIVAgASGCBBQzU5RUUyNjc3ODk4RjA1MEMzMTVDRENCNURGRDExMAA=	2025-09-23 23:11:07.691214
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTZGRjhCQjJERThEOUY5RTVDAA==	2025-09-23 23:53:28.523189
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBN0UxMTBFODgwQUVEQ0MxRTA2AA==	2025-09-23 23:53:42.946427
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5NzcxNERDNDA2Njg2QUIzNEIA	2025-09-23 23:57:32.035236
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NTk5NDExRUUwODMzQUREQ0YA	2025-09-23 23:57:44.043428
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQTY2MUY4MkRBREM1OUQyMzA5MwA=	2025-09-24 00:21:08.8567
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQTgwNTIxMUI0MTExODA1RTM2OQA=	2025-09-24 00:21:28.502469
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQUQ2MTYzRjdENEE5RjJFMzU2OQA=	2025-09-24 00:21:49.699931
wamid.HBgLMTkyODcyMzcwNDUVAgASGBQzQTY5Mjg4MjE5NUVDNjU0QTY0RQA=	2025-09-24 00:22:12.352189
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2OTE5ODdDNTVCODMzRDAzOEEA	2025-09-24 01:09:26.301163
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxREU1QjFBMDAxNzgwMTQ2RDUA	2025-09-24 01:18:41.072135
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNjdEQTBDOEFFNDA0RTQ3MUIA	2025-09-24 01:21:59.233541
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMzgxMzUxRUU3NUI2Q0I1RUUA	2025-09-24 01:31:57.865818
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4N0ZCN0NEM0U3RTUyREU4RTAA	2025-09-24 01:34:28.157155
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzRTY4MzBCNjE0QjA3MTlFNEIA	2025-09-24 01:34:56.402425
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMzY2MkM2OUVEQkU4MkUwMjkA	2025-09-24 01:36:09.994657
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNzBFRjA4QzVFMTlENDE3NDUA	2025-09-24 01:37:00.143861
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNjQwRUE4NjAzNjJBRURCNzAA	2025-09-24 01:38:19.007785
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBRUVFQkIwMTUyMjE0OEUyRjcA	2025-09-24 01:38:53.845948
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNDBENUFBMEQxQkNBQjgwNTkA	2025-09-24 01:45:16.331215
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0OUJDNUY4QkMzMzU2QUJDN0QA	2025-09-24 01:45:40.216797
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2Qzc0MEM5REZENDhENjdFMDkA	2025-09-24 02:05:18.439898
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNTQ3QkE3QkY5MDEwQkU3QTMA	2025-09-24 02:06:04.679761
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5RkEzODVBMUU0QTY2MEJGQ0IA	2025-09-24 02:07:11.142863
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQzM0QzdFRUQwMkMxOTIwOTgA	2025-09-24 02:18:30.940499
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBMDI3RUI3Q0FDOTU3QjQ1QjgyAA==	2025-09-24 02:47:11.386056
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBMUI3M0JENERDMUMyOEM3Qjc2AA==	2025-09-24 02:47:42.424634
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBMzlEOTk1NUM1QjAwRDkwRkRDAA==	2025-09-24 02:48:05.090094
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBNDA0Q0ZEREE1NjA0ODhCNDAxAA==	2025-09-24 02:48:28.465298
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBQThGQUQ1Mzg5QjNFRkI5RjA3AA==	2025-09-24 02:48:40.531572
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBNzdEQzk4NTRDMEQ2MjMyNjg5AA==	2025-09-24 02:49:14.058443
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBNjIzRkNFNTdCMjJBRjVCOEJFAA==	2025-09-24 02:49:23.21574
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBMjIyNDEzNDI1RUMzQTZDOTYzAA==	2025-09-24 02:50:12.502341
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBNUMzRTYzRDMxMEY5RjMzRjEyAA==	2025-09-24 02:51:45.226505
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBQjQwMDcwODdCMjY3OEJENjcyAA==	2025-09-24 02:52:16.70093
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBNzI2QTYyMkFCQjc1QzNENzQ4AA==	2025-09-24 02:52:44.128353
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBQTk2MEY2RUJGRDMxQjFFMDI5AA==	2025-09-24 02:52:56.562915
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDRERUNEOEU0RUFGOTdDN0MxAA==	2025-09-24 02:53:24.177347
wamid.HBgNNTIxNjg2NDI0NzczMBUCABIYFDJBMEZBNEZFNDU2NzRERDQ4QTQ5AA==	2025-09-24 02:53:43.792506
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkIxMEVEOTk4ODk2Rjc4MTgzAA==	2025-09-24 03:20:33.902322
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDk3MUEwMTkxMTRCRjQ5NjFCAA==	2025-09-24 04:38:34.629503
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMTQ3NkYzNzkzQ0M5MUE0OTQA	2025-09-24 16:26:17.902918
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3OTBBQTg4OEEzRUZENjNCQTkA	2025-09-24 16:26:38.602532
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0Q0MyMEVGM0JFNTZCNkFFM0IA	2025-09-24 16:38:33.885591
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5MjA3NkYxNzM2N0JFRjQwQkMA	2025-09-24 16:54:01.745677
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5NDg3MUM3QUU5NzdFMkI1NkQA	2025-09-24 17:06:33.06208
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMEY0NjY0NDAxM0FBMjc4QTMA	2025-09-24 17:19:47.17017
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2N0ZERUJGMDY5NThFMjg3OTEA	2025-09-24 17:20:08.069457
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NzIxMUQyMUI0MEYxN0QxNDgA	2025-09-24 17:20:27.675722
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0ODZCNDJBQ0ZBMkNFRDJGOUMA	2025-09-24 18:07:59.148515
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyREUwNjEwNERBNTlBQkFGRjkA	2025-09-24 18:22:19.636508
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQTAxQzAyOUZDMkY1NDlCOUUA	2025-09-24 18:33:12.222304
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwNDlBQzI3OUZBMjMzMjUyQUMA	2025-09-24 18:33:42.003607
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxRDY5QkM2NzhBRDI4QzlENzQA	2025-09-24 18:34:37.364768
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDOTVEOTAwODlFREI3NEUxQUUA	2025-09-24 18:34:46.303453
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RTE5ODYxODY1RkZCRDZBMDAA	2025-09-24 18:40:27.286342
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RDlENjVDMkUwQzI1RUFFQzIA	2025-09-24 18:40:45.759783
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzQkQ2RDg0RTQ5NTUzNDQ2ODYA	2025-09-24 18:41:05.929905
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNTlENjNERDE4RTM1ODkzRUQA	2025-09-24 18:41:23.144758
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQUYxRTlDNjI2NEM5MzBBQUYA	2025-09-24 18:41:49.121958
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDOTkyNEQ5NkNDNzdBQzYyQ0IA	2025-09-24 18:42:15.290991
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxRkFGQ0YxMTBDOTM0OTVGRDIA	2025-09-24 18:42:55.638975
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxREQ0NjY1QkRFNzRGQUE3NDYA	2025-09-24 18:43:45.753054
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NjlCOTgzQjk0MjlDNjJENDIA	2025-09-24 18:44:07.199739
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFNDU2RDBEQzczODBGMEMxRUUA	2025-09-24 18:44:23.072088
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNUYzRTBBRkNBNTg5NzlDODUA	2025-09-24 19:37:39.338981
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBENjMzQkUwRDExMjZCOTFBM0EA	2025-09-24 19:38:18.972817
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxMTgyMjVFRTM0RDE0OTU2MEEA	2025-09-24 22:01:28.877468
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5REY4NkNGMTJFM0I5NTU1OEIA	2025-09-24 22:01:50.894959
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQkJCMzM2MDU1QTAyMjgzNEUA	2025-09-24 22:02:23.384634
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFREE0QzZEMEQ3MDcyOTkxQjIA	2025-09-24 22:03:34.250474
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3MzE2NjNCNjE0NUUzODZDNzcA	2025-09-24 22:03:54.273817
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMjIzRjg1NzJENzE1QUI2MTUA	2025-09-24 22:04:09.574572
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDMDc1RjE4RUFDOUFBM0IwODIA	2025-09-24 22:04:37.591686
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MjExQjZEQTMwOUUyQzIwODUA	2025-09-24 22:05:10.220797
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNDdFNzM3REM2MkQwODg4NUMA	2025-09-24 22:06:33.699486
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NzY5MzY4QjVDQjY3MjlGNkUA	2025-09-24 22:07:12.331708
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMjlCQTcyNUU0OTgzQUEyQjYA	2025-09-24 22:07:35.302392
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3RDMyRUVFNUM2NzM2RTEwNEQA	2025-09-24 22:07:51.15188
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MUE2QjM4QzUwRjJEOEZGQjYA	2025-09-24 22:35:02.598457
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQTYwREZEOEJDOTMyQTdBODUA	2025-09-24 22:35:41.637834
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQzQ1RTJDQ0ZGM0IzMTVERDgA	2025-09-24 22:37:17.053062
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGODRGOUMxOEZDMjY3NjZFNUQA	2025-09-24 22:37:36.202573
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMzEwNjQ2N0I0M0JERUE0RTgA	2025-09-24 22:37:46.36874
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2ODA1Njc0RENENERBOTZDODEA	2025-09-24 22:46:36.122383
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMUY1MTE2M0FEOTQwMUMxMzAA	2025-09-24 22:46:45.488318
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NTAyMUQzQTIzRjdEMEMxMTMA	2025-09-24 22:47:03.195874
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3RTlCMzJEOTYyRTFCQUU2OUUA	2025-09-24 22:47:11.373892
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCRUU0Q0E0RUI4QkZBODA3RjYA	2025-09-24 23:00:01.463179
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNThDMzdDMkEyQ0Y1QTlGQzUA	2025-09-24 23:00:21.559601
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwODFGQ0U1QzYwODc1RTM4MzcA	2025-09-24 23:00:37.418569
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGRjU5NDJBOTYyOEVGQ0RBMDgA	2025-09-24 23:00:47.044642
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5RkM1NkY0MzY4MTdBQ0VGRTkA	2025-09-24 23:01:47.859229
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNjY0QTExNzhGODkzRkYxNUUA	2025-09-24 23:02:29.909507
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMTU1QjRCOUZFRUE1M0VGNDMA	2025-09-24 23:03:39.595582
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3Rjg2Mzc3RUQyNUFDMTY3QzMA	2025-09-24 23:04:02.083084
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5ODNDNzc5QjQxMjUwMUNCMEQA	2025-09-24 23:04:25.968842
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0QzdBNkZBRjBFRENGRkE3NjYA	2025-09-24 23:04:48.369135
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1N0IwMTM4Njk3OEIwRjUyODY3Q0VCMjNBRUY3QkMxAA==	2025-09-24 23:05:32.596745
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RDlENjVENDE2MDA4QkM1MzhFQkFENEI2MEEyMDZFAA==	2025-09-24 23:05:54.733892
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NjE1QjFBQUIyRkY3MEY3OTExREIxOTVCRDFBQTQ0AA==	2025-09-24 23:06:00.988169
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NjE4QkY2MkM5QzA4M0ZFNkVDMEMyQ0VCQTlBMjQ2AA==	2025-09-24 23:06:15.944134
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1Mjc2Njc5RjM5RUJBODZDOEU0RDIxQTE5MzM1OTU2AA==	2025-09-24 23:06:28.821563
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1Rjk4RDU4QjA5RjdBNEVFMTYzNTM5OTBGMjk5MUZCAA==	2025-09-24 23:06:43.118461
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NjdDQkM0NDQ0N0IzNzNEQjRFQjc1QzVDQjJBNEZGAA==	2025-09-24 23:06:54.737676
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NUZCOTg0Q0EwRUMzOEEzMEFEQUM2QjY0MDlEODczAA==	2025-09-24 23:07:10.624371
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NUIxQzY1MjQ4NEY2MUQwMjg4QTAzNDVDRDgwQjk4AA==	2025-09-24 23:07:21.435785
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1OTI0MUJENkQ3NzczRjY1MkI2NjJDOUUwNUIyNEY2AA==	2025-09-24 23:07:38.530332
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1QjhGMjFDODgxRDNEOEJCRDlEMTRERjYxMzFGQzg2AA==	2025-09-24 23:07:50.924012
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MzI2RTM5RjIzNDJBMDM0RTNDRjMyMTZGNEYyNzhCAA==	2025-09-24 23:07:59.255601
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MkE4QzVBNTE0RDE5MDBCQUU1QjlDODQ3NkE4MzcwAA==	2025-09-24 23:08:11.171434
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RUUzNEY0QzM2RTUxNzJDQ0JBQTRGOTQzNEExNTU0AA==	2025-09-24 23:08:25.552739
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1OTk5RDAxRTVCNTk1QkYwRDk3RjRDMDk4NTFFRjg1AA==	2025-09-24 23:08:40.741514
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RjcxRTA1RUU4RkM0Q0MzNDgzMUM1NkJBNjlGQUU3AA==	2025-09-24 23:08:47.829915
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NTg2N0FCNjcyMUE3NUU2MTNDODNBMjExM0MxQjJCAA==	2025-09-24 23:08:57.826686
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RTJCNTJDMTcxMzZBOEIyRDY5RURDNkU0RDQ3NjZFAA==	2025-09-24 23:09:05.401689
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1N0YzQzhDN0UwMDEzQUU0QkZGRTYzNUYxNUZENTMwAA==	2025-09-24 23:09:16.055965
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NTQ5NTJBRDBGOEFBMTQxOTM0QTlFRTM3OUQyRUFDAA==	2025-09-24 23:09:35.774399
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1QjRBMjdDQzVCNTExOTE4MTA4NkUyODUwMUU3RTQyAA==	2025-09-24 23:09:41.793606
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NDUyOTgxRjdBNEU3RTgwRTVFQzRGOEQ0REJENzQ2AA==	2025-09-24 23:09:56.359897
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RkQzNDI4Q0ZCNUVBNDYxQzkxODZEQjAwM0RBQTA1AA==	2025-09-24 23:10:11.895692
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MUZGNDFCQjNDRURBQjFFNEQ0QkFCQTU0OTU2RkI5AA==	2025-09-24 23:10:24.86748
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1OERCRjkxQ0IyQTJCM0NEMkE3MzBFN0E1M0VBNThEAA==	2025-09-24 23:10:38.541011
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NTNCMTVENzFGNjQ4RDc4OTQzRDkwQUI3OTY2OTdFAA==	2025-09-24 23:10:46.737231
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MEZGODU2MEM2M0Q2QzczRUZBNTAxRTM1NzA2NTc0AA==	2025-09-24 23:11:01.456128
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MDJFNjdFREVFOTVBNzJDMUFBOUQ2OTdBQTM2RDYwAA==	2025-09-24 23:11:12.213388
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NjI4NEUwRjMxQTI3NDBEMTMyQkRBN0MwOUM5Njk0AA==	2025-09-24 23:11:17.246952
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RDAwMkZCQURCNkM3MjgwNDNBNTI3ODhFM0JCN0MwAA==	2025-09-24 23:11:31.024186
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1QjYxM0IwODFBQUQ3QkI0OEQ4NjMwOTRBRjU1NzNDAA==	2025-09-24 23:15:26.639185
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NDFFNEYwRDMyNzJGMEM2MkVCRjVBNjIxMjU3MTUwAA==	2025-09-24 23:15:30.583898
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NzBBN0Q3QzY2MTRFQjBEMjAzNUQyOUZBRkRBNERFAA==	2025-09-24 23:15:44.241391
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NDg3NjY4MzQ1Mjg0QkY0Qjg0NjEzNjlGQTA2OTk4AA==	2025-09-24 23:15:52.400373
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RkYwNEE5NTIzMTUzMEY4NjNFMEI0MTE1MkFGQTQ5AA==	2025-09-24 23:16:04.589098
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBNTBDMkE1RkFEODE5QTE2Q0QA	2025-09-24 23:16:16.763674
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MkUwMDA5NzU5M0IwMjFGRkFBRkRGNTlCRThGNEMyAA==	2025-09-24 23:16:17.243174
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1OTJDOTNCREM0Rjc3NTg1RUM2RjAzRTk4OTY0NjE1AA==	2025-09-24 23:16:26.359304
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1Mzk1REU2OEREN0E0QjA1OTE2Q0VCQjQ2MDIwMjk5AA==	2025-09-24 23:16:40.893212
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NUY5MENBRTMyOUM2NDI1MDI5MkZBREIxQTlBQjZBAA==	2025-09-24 23:16:58.015583
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxOTBBNjY5MjEyM0M2NUYxNUIA	2025-09-24 23:16:59.926441
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1OUI1OUNENjgyNEI5NEM1ODUxNjQ3MDQ1REFCN0MxAA==	2025-09-24 23:17:06.669902
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1QkIzRTg4Qjc2OUM1Mjg1REFGQjQ3MjE1QzY2RUM5AA==	2025-09-24 23:17:12.997099
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MTA2Qzc5NjI3RjRCRDAyRTkwRUUxMTk0ODMwNDg4AA==	2025-09-24 23:17:24.595676
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MjU1MUE1NjFGRDdGREE1OUY2ODI2MzA5NkMyNjc1AA==	2025-09-24 23:17:35.494469
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1OTU2MkY3MjdGRDUyQzM5OTcyN0QwRDFBMkJDMkVCAA==	2025-09-24 23:17:39.643872
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MTE4NDU1RTBCNTk1OTdCRTU0QUJDNTg3NUZDMzFEAA==	2025-09-24 23:17:48.044456
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBNjg2Q0MzNEM5RTU3MUE0Q0MA	2025-09-24 23:24:21.579832
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RDMyMTdBRkU3NjFFQjMyMzkA	2025-09-24 23:24:55.855353
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMDE5MTRFMzIwMjlGMjhFQUQA	2025-09-24 23:25:12.686053
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RkRDM0VFOTMzODQ1Q0ZBODRGRTY4MjEwQkMzMjcyAA==	2025-09-24 23:28:20.883529
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MjAzQzVDOTI3MjBDMTFFRjgzOEJERjRGMDVEMTUxAA==	2025-09-24 23:28:36.18302
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1N0IyMUM5QjJGRUVBQUQwMTQ5MkJFQTc4MTFGMTNEAA==	2025-09-24 23:29:09.703375
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1QTkxRkFGOTk3OTYxMUU0MkVCOEYyM0FCOEUxMUE3AA==	2025-09-24 23:29:23.117393
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1QzY4QTJFNzZCOTk2NUE0NDNFNjc5QTc4RDgxMTIzAA==	2025-09-24 23:29:30.362696
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NTA3NDNGNzU3OUMzMUZENTU3OEM2Nzg0MTQxRDg4AA==	2025-09-24 23:29:46.404314
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1N0Q5NDgyQzk0MEUyMDFGQzQ3RkFDNUIyNDEzNDdCAA==	2025-09-24 23:30:00.010312
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NjlGRjc2QkVDMEYyQUIyRTU2OUQzMEQ4Q0NCOTc2AA==	2025-09-24 23:30:28.807039
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MzczNTk0QTI2QzBCNjE2QzIyRDE5QzE1NkE0NDAxAA==	2025-09-24 23:30:41.244823
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1MzFFNkE0Q0UzRURCRkU0MjEyQTRFNjVEQUJCRTQ2AA==	2025-09-24 23:31:02.323815
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1RkQyRDg0NDI5Q0Q4MzIxN0YzQjRGNEVCRTUwQThBAA==	2025-09-24 23:31:10.734637
wamid.HBgNNTIxNjY3MzQzNDIyMhUCABIYIEE1NURDNDEwODI2MUJFNEQ1Njk1RDg4NTczM0JCQjk0AA==	2025-09-24 23:31:19.253362
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFRDg1M0I0RjhFN0NGQjdFRjEA	2025-09-24 23:33:15.406098
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTJERkM4QzVDQjg2RUREMUY0NgA=	2025-09-25 00:26:42.432194
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQUUxMEY3ODM1NDhFNzBDQTU1RAA=	2025-09-25 00:27:21.227946
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTZDM0YzQjY1NzYzMjI0Q0E4QQA=	2025-09-25 00:28:07.525531
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTUzNDc5ODVENjlDRjE1RTMyMwA=	2025-09-25 00:28:23.454004
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTlDMzhGODdEQURDQTQ0N0VBMgA=	2025-09-25 00:28:38.992648
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTFGODIxNDQxOUVCRTdGMjE4RgA=	2025-09-25 00:29:01.221532
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTgwQ0IxOTRGNUY0MTVCMkIxMQA=	2025-09-25 00:29:21.674792
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTA1RDcwMTk5NEY0RjJFNDQ4NwA=	2025-09-25 00:29:34.939733
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQUI3ODUyMkU4MzA2NjQ1N0NEQwA=	2025-09-25 00:29:53.973829
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTVBQjg2MUZFOTQ0OUEzOTNCRQA=	2025-09-25 00:30:02.749755
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTIxOEIwQzU3NUQ4NjFDMDdBNgA=	2025-09-25 00:30:11.866941
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTQyNkU5MDJBNDZDNEIwNTA3NQA=	2025-09-25 00:30:30.215822
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTk1MTdEMUFBRkMyMDZBNTg5RQA=	2025-09-25 00:30:55.932479
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTc3MDdCQUY5OUQzMEU3RjExNwA=	2025-09-25 00:31:08.437379
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQUIyRUREMjlFOTkwNkZGOTVEQgA=	2025-09-25 00:31:25.469383
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQURCODA5MDdDNzhDM0NBQkJGMQA=	2025-09-25 00:32:27.133472
wamid.HBgLMTc2MDg2NzY3MzEVAgASGBQzQTNEQTk1MEVEQzlBQzA1MTI5RQA=	2025-09-25 00:32:43.354481
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQ0VDOTkxNTY3MzAzNUFBQjUA	2025-09-25 00:33:13.855863
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3Qjg1MUNFODU5RDcxMTlERDMA	2025-09-25 00:39:05.189681
wamid.HBgLMTkyODI0ODk1NDIVAgASGCBBQzg0NkMxN0ZDRTg1QUYzRTI5Mjg2Rjg4MEE2MEEzRQA=	2025-09-25 00:44:21.851775
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2M0QzMzc0Qzc1MjFCRURGMUMA	2025-09-25 00:45:27.473733
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDMEVGQUM3OTk4N0YzNzVGOTQ5QUQ4M0VGQTc1ODEzAA==	2025-09-25 01:32:27.901022
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0ODhFMjkyN0RGNzdERDRDRDUA	2025-09-25 01:33:19.726272
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDNjdFRDBENDY5NEVCMTc4OTFENzlGNDQyQUU4RUZCAA==	2025-09-25 03:47:10.473291
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3NERBOTVFNUY1NDIyRkQ5NTcA	2025-09-25 03:48:12.797104
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDNjZGQ0QwOUIzMDc5M0Q5MjNFRjFEMkY0QTk3NzA3AA==	2025-09-25 03:48:40.524334
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4REE0REVCOTExRkVFNDExMDgA	2025-09-25 03:49:21.077769
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzOTlFMUI1RUFCMjk3MzEwOTcA	2025-09-25 03:50:04.430465
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQzBGMUJCQjVGREU2MThBMzAA	2025-09-25 03:51:21.029571
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1QkZBNzQyRUMyRUYxRERBMzcA	2025-09-25 03:51:54.344096
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQjg4MEMyRjE4REE0QzE1QjcA	2025-09-25 03:52:09.787215
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQ0NERTYyQ0FDQTc2RUEyRTQA	2025-09-25 03:52:29.277822
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQzc0RkZFRkZGNjQ3RDZGQTYA	2025-09-25 03:58:54.558242
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQkVGMUY2NjdGQzQxRUY3RjkA	2025-09-25 03:59:15.527087
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDNkE4RTExNzNGODg0ODUwRTNGMEY2RjUxRjEwQkZDAA==	2025-09-25 04:00:08.371375
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFNkE4MUREOTQ0MzMxREJGM0MA	2025-09-25 04:00:20.181195
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDNzNGQzM3NEE2NDQwNTA4MEY0NjI1QkNGNTZBQ0RCAA==	2025-09-25 04:00:28.654904
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MjIwRTdBRUE3NzI0NEYxRDIA	2025-09-25 04:00:46.896985
wamid.HBgNNTIxNjg3MTUyOTc3NxUCABIYIEFDQkZGMjE2OTRCOThEQzg2RjAzQ0E4RTBEMDZGQURFAA==	2025-09-25 04:00:58.394502
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NTAyQUQ2OTk4MkE2RDlCRUQA	2025-09-25 04:01:18.299382
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RkY5MzNBMUZBMTVBRjA4NzkA	2025-09-25 04:03:01.012849
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2MDg2NTdGNjU3RTgzQzNCMEEA	2025-09-25 04:05:44.86885
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkMxOTczNTA0M0Q3Njc4RjJBAA==	2025-09-25 04:08:25.007289
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOTVEOTA3OUJDMTMyRDM5NjRDAA==	2025-09-25 04:08:37.702937
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMDI1ODFDNEU4MTU1MjYxQ0RGAA==	2025-09-25 04:09:13.766739
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjI2M0U1MzhERTAxODI0NThBAA==	2025-09-25 04:09:54.901079
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDE1NjQzNjI1NzAxNDUzN0VCAA==	2025-09-25 04:10:06.396796
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTNFNjlENzg5MjE4NkU5NjAwAA==	2025-09-25 04:10:25.697717
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNUI1Qzg4QTdGRUUzNkQxQURDAA==	2025-09-25 04:11:10.605243
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDE4NTI0OTVBNDZBMTg2QTFCAA==	2025-09-25 04:11:22.058224
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQjg0REU1RkZCRUJGMUE4MDAA	2025-09-25 04:22:01.230676
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzODBDRTI4Q0RCODMzM0JGMkUA	2025-09-25 04:56:11.469566
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQzhFMDYwOUNFNkZFNUEzM0UA	2025-09-25 22:05:42.926818
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MkQzRDZFOTQ4NTI1MDBBNUIA	2025-09-25 22:08:34.693981
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyNjYzODUxMTkxODE3QjZCMTgA	2025-09-25 22:11:13.084432
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NUEzMEVENkY0RTc2Rjg3REYA	2025-09-25 22:14:27.161764
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2N0VERUEwNURBRDcyMzQ3NDMA	2025-09-25 22:17:42.961659
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4MDNFNDEzM0E3MzlBOTM3MTMA	2025-09-25 22:18:09.899425
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MTEzOEI4RTdFMjVCNjE0QUUA	2025-09-25 22:20:25.38765
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzOTEzRUU1Mzg3NzZDNjU0RDMA	2025-09-25 22:20:39.449326
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMjUyRkM5RUUyNEY2OTFBNUIA	2025-09-25 22:20:45.827218
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMzYzQjhDNTlFQzJBMDYyOTMA	2025-09-25 22:24:20.778872
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxN0EyMjZCMDE5MENGN0ZEQTkA	2025-09-25 22:24:42.153002
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNEZDM0I1NDREQzY0MEU2MTMA	2025-09-25 22:26:11.951871
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMUI1RkMxM0RDQzEyMUM4N0YA	2025-09-25 23:23:07.650229
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFNEZGRDI3ODZDMUI5MEI2MEEA	2025-09-25 23:23:18.864183
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5MUZDREI4QUZFMkEwMjdGMDgA	2025-09-25 23:53:40.868499
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGRTVDNTIzMzcxNDBFMzg2MDQA	2025-09-25 23:54:20.475132
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQTE3RjA4MzI2NkRBMENBNTIA	2025-09-25 23:54:45.838138
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyNEFBNUFBOTQ0QjUxMkFBOTMA	2025-09-25 23:55:35.754086
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyNUY1NzQxQUI4MzdDMkU2MEIA	2025-09-25 23:56:00.696322
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBOTZCOEQ2OEFERkU5MkQxQzMA	2025-09-25 23:56:37.729139
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQkE4N0YxNDQxM0FERjE2MTUA	2025-09-25 23:57:06.40352
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQUNGQTA2RjE0NzQ3QkM1QzUA	2025-09-26 00:37:21.84645
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4QzhDMUZBMzE5QjQyRDdGQTkA	2025-09-26 00:37:59.867082
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFODhFMjFBN0U5RjY2MEUzNEIA	2025-09-26 00:39:57.61466
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1NjQ2NjdDNEM4RURDNzJBM0YA	2025-09-26 00:40:22.620506
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3RjZDNjRGRjdEN0MzM0QxNEUA	2025-09-26 00:41:10.491466
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwRDhENjI5MUE0RDA4RUI5NjQA	2025-09-26 00:52:28.132346
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3M0Y4RDE5NjdCRDQxRTJDRDYA	2025-09-26 01:04:09.988037
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQkZEOUY1MzBBQTVBMzJDNTgA	2025-09-26 01:56:57.847328
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzgwOEExRDcyRTVFNzY3RDJFAA==	2025-09-26 02:58:24.512093
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRkM3MDIxNDYyMjhGMzIxRTFBAA==	2025-09-26 02:59:18.260632
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNjcwOTEyNDU0M0U0MzE1MzU4AA==	2025-09-26 02:59:36.421784
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjJDOEQ5QjEwQzdDNEZCNzFGAA==	2025-09-26 02:59:47.19434
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOEUzODlGMDg0NEE2NDM5MjUwAA==	2025-09-26 02:59:56.940521
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTNEMERGRDYyRDZBMThFMjg4AA==	2025-09-26 03:00:23.410493
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjdDMzE0MDUwNUZGMzIxOEQzAA==	2025-09-26 03:00:28.150662
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMEM4QjRBMkNEM0YxMDc2MTZDAA==	2025-09-26 03:04:32.513653
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOTAxQThEMkMyNzJCMkEzMDkwAA==	2025-09-26 03:05:05.909688
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkJDRTU0QUU5M0QzMEFENjYxAA==	2025-09-26 03:05:28.311286
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDY3MzRCQjY1QkQ1QzFBNzA4AA==	2025-09-26 03:06:12.959354
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3Q0UyRDE5M0FGQjkzNUU4MTUA	2025-09-26 05:53:41.328195
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMjNCRTFFN0UzM0VDNUExOTgA	2025-09-26 05:54:42.307681
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5RUI4MjYwMDdCNzU5NzlDNzUA	2025-09-26 05:55:34.26272
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQzA0Rjg5NTM1NkJDM0FCNEUA	2025-09-26 06:58:23.200125
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBQjRFODU4Rjc3Qzk4NDk0MDIA	2025-09-26 06:59:29.835341
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyN0U1QzczOTI3MzkwMzM5MTAA	2025-09-26 07:20:13.251303
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyN0E3OTE5RjMzMUZENDZDQUIA	2025-09-26 07:20:50.166835
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQjc0NjEyNzEyM0FFREFDRkQA	2025-09-26 07:35:20.862614
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MDc0NTk5NDEzM0Q4ODFGNTgA	2025-09-26 07:35:37.30602
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3RjY0ODFBQkZFQzhCQTgwOEYA	2025-09-26 07:38:02.327608
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBNTU0MkM2Q0MyQ0QxMDRBMzUA	2025-09-26 07:38:20.927718
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMzI0NEIzNTQ0MDIzMTFEQTYA	2025-09-26 07:54:56.095189
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RTRGRDE0QkUzN0FBOUYxMTYA	2025-09-26 07:56:49.137276
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0QjU1QzgzRkU4NUQ2NjBDNkEA	2025-09-26 08:03:16.891092
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyOTZDMjc2MEVDMDREMkEwRjkA	2025-09-26 08:09:12.830787
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMUFCNjYxQUY1QzFBMzNDREMA	2025-09-26 08:09:36.245149
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxOEExMkVGNURCNUUwMzcwMUIA	2025-09-26 08:09:59.444674
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzRDc5QkVEMkJFMEJDREZDMkEA	2025-09-26 08:10:19.144207
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMkNERDhENEM3MkY4MjIzQzEA	2025-09-26 08:33:20.437954
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQjAwNzhCN0VBMjgxRjE4NzUA	2025-09-26 08:34:49.951483
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQTc5NEM3OUIxNTUzQThGMUEA	2025-09-26 08:35:22.015029
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3REREMUZCNjgzM0EyQjVENUMA	2025-09-26 08:46:59.039216
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMTVBREU1QTRENDhEN0U4MEIA	2025-09-26 08:54:20.511439
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQjI5OEVDOTdDRDYxNUNFNTIA	2025-09-26 09:02:53.970851
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQjZFQjNFRDQxRkY3MjNCMTEA	2025-09-26 09:03:31.134902
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCOUM0MjhFQTM4REYyRUM1MUIA	2025-09-26 09:18:39.841166
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFOEY2RDdDMjcxRjk2NjU1QUYA	2025-09-26 09:32:47.351647
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNTEwOEVDMDA2MDYzQkQ0RDQA	2025-09-26 09:33:25.590811
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMDQwNTZBQUZFMzE3NTQ1RUYA	2025-09-26 09:34:36.081715
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDOTg4NEYwQ0RDMkNENDZFMkYA	2025-09-26 09:34:52.490134
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyQkMwRjQ5QjY4QzgzOEU3MzgA	2025-09-26 09:35:08.143618
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1M0ExRTEwNzI0MUQ1QkU2RkEA	2025-09-26 09:51:51.993855
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMDVBNEJCQ0EwNjFDRUVBOUEA	2025-09-26 09:52:27.637892
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2QTJGREQwNTY1NkYyMEIzRjQA	2025-09-26 09:53:06.3091
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCOUY0MzdDNjI1NTJCODUwNjUA	2025-09-26 09:53:45.027789
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDMjg5MDQxRDA3NjlCRjE3M0MA	2025-09-26 09:54:18.382236
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyOEMzRUQwRkQzOEZBQzgxQUMA	2025-09-26 19:14:59.224105
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFNUUxMTE5MjRBMTQzOEY5NjAA	2025-09-26 19:15:18.901556
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBENjlFNzAwMUI1NEY5OEUzODgA	2025-09-26 19:15:43.577279
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MTQwNUUxRUIzNDJGN0M2MjMA	2025-09-26 19:16:00.523147
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQkQyQjAyNDFBOTVFQUVBOUYA	2025-09-26 19:16:23.722026
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQTIyODhGRDlFQzlDMTI3ODEA	2025-09-26 19:24:42.060015
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQjM1NzE4RDY5Rjg2RTNEOTcA	2025-09-26 19:25:04.494547
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQzE5NTFCQkUzNUZDQTFEMjkA	2025-09-26 19:25:18.669019
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyQTc0NEE4MDhFQkUwOEEwMjgA	2025-09-26 19:26:00.678803
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5MDRFQjMwRjM2RjZEOURCNjgA	2025-09-26 19:26:52.34997
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMDVEOUY5NjgzNTVBNEE1QUIA	2025-09-26 19:31:18.96576
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NEMyMzRERURGRjg1MzI1MDMA	2025-09-26 19:35:53.542739
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBENTJGM0RCRjlGNzQ3RDUxOTEA	2025-09-26 19:37:48.953295
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDMTc2RDU1QThGNDdDODRCQkUA	2025-09-26 19:47:14.425063
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCOTdGQzI3M0QyQjIwQ0IzNzMA	2025-09-26 19:47:30.54886
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjIxRUY1NjlENjdCNjFERjMzAA==	2025-09-26 20:15:25.717318
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMzI0RkZCNDVGMTY2REI0QkYA	2025-09-26 20:33:36.701691
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxMTExRDM5QjNGOUE0QzIyNDAA	2025-09-26 20:33:45.325688
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQTdCNDEwNzk4NjcyMTYzNzgA	2025-09-26 20:33:50.54629
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBQzM2MDZDRTQ1RjlCNzhDQTcA	2025-09-26 20:34:15.931945
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4OTUzRkI1OUM1QTE3MThEMzEA	2025-09-26 20:34:35.972316
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxOUY2OTM5NTA1Njg0NEQwMDcA	2025-09-26 20:34:56.528874
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3MzBENTE1NTQ4N0MyRDg0NTMA	2025-09-26 20:35:20.799968
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyNDg1RDlFQUQ4MjZCNDAxNUQA	2025-09-26 20:35:37.947813
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDOUVFQTFBQzc2MjFGQTlEQzIxNDhBNTM2RUI0QTQwAA==	2025-09-26 22:09:31.899401
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRDZCQTc4OTUyNUNCNjQ2Q0VDOTRFNTdFMEIyNkE1AA==	2025-09-26 22:10:09.298674
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNjJCRDE1MkE5QzUzQkNENzYwMzJBQUVDOEEzNDlEAA==	2025-09-26 22:10:26.36098
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDOUJFQkU5QTU4OThDRjY0M0Y3RkQzQUIyODlBMTUxAA==	2025-09-26 22:10:46.172788
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDN0U0QzE0OTNFRjFGMkIwNDA4QTMzNjI5RjUxODcyAA==	2025-09-26 22:11:22.363732
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMjQ2N0ZDMDc3NjRFREQ5NUVBNDc3RTE0ODQyQzkzAA==	2025-09-26 22:11:47.043558
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQkJCMUQ4MEFBRDEzNENDNEFENUU0ODMwQjc1MDczAA==	2025-09-26 22:12:07.729828
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQTY0RUVERUEzMzNBMzlCRjg2NTcyMDQyRDdCNUFBAA==	2025-09-26 22:12:52.26369
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRDA0RUE0MDVCN0RDQzZEMzM3OTFEMjUzNDY0MEI5AA==	2025-09-26 22:13:13.02895
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDM0JCRkVCMUQ5RDU2QTMyRjg3QzRBMzUzQzFERjI2AA==	2025-09-26 22:13:35.090869
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMkI2OEZCMDM0OEJFNzM1NkZEREI3QkNCQzE0MjAxAA==	2025-09-26 22:14:02.119012
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQ0VBNjU3NTI0NUU2QTQwQkUxRUQ4QTEwOTg5RDc1AA==	2025-09-26 22:14:35.041673
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRTMzNEMwN0Q0MzBGREYxN0I3NTE3Q0YxNDI3ODBDAA==	2025-09-26 22:14:58.076065
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMUQ3ODBEMTQ4Njc2RDkzMDNFRTJBQzE2MDYwQTA5AA==	2025-09-26 22:15:16.299386
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGODY3MURGRDdDOUQ4QUI5MjMA	2025-09-27 05:50:44.794485
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2ODAwOTlEOTI2NUQ0QkFDNjMA	2025-09-27 05:51:15.770596
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2MzhEM0FGNkUyRDc2NEY1OUUA	2025-09-27 05:52:32.5671
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQzcxMjY1QkJFRjFDQUFFMTMA	2025-09-27 05:52:45.631735
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MDAyM0NDMTIzRTZBODEzNjEA	2025-09-27 05:53:04.056894
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0QzdCMzBFNUYxRkQwRDY4NDcA	2025-09-27 05:53:12.846001
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFN0U0Nzg5MjAxREI3ODJCQTIA	2025-09-27 05:53:52.424248
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3MUVGNTk1RkMyQjVGQkRBRkYA	2025-09-27 05:53:59.858993
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4NkM4MjNDNDc4OTIwQUM5MzAA	2025-09-27 05:54:17.736732
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxODQyMkUwN0Q0QjVFRTY4QkIA	2025-09-27 08:05:37.578581
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMDZFM0I1NTVFNDBBQjE2RDEA	2025-09-27 08:06:28.785869
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQzkzQzE2ODBFQjBBNDlDQkMA	2025-09-27 08:07:18.740308
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0QTJFODQ5NDEzQjhDRjI5MjQA	2025-09-27 08:07:27.556068
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDRTBBMEU4MUE4REI0QzQ5MkEA	2025-09-27 08:16:50.128387
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBRkQ2MzFCMjY4MDQxMUI1Q0IA	2025-09-27 08:17:08.963618
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBERkQyNjk1NTg3RTJBMjZGRDYA	2025-09-27 08:17:26.056194
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyQTM1MjI0MUNBOTJFOUM4MTYA	2025-09-27 08:17:33.533494
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3QTYzNzMwQjNFMEJBMTJDMTEA	2025-09-27 16:52:34.067474
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwNTc5MDBFRTdCMzlENEM3RjEA	2025-09-27 16:53:04.876504
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMDRFNEI5RjRFM0Y5MkQ4MTMA	2025-09-27 16:53:59.58132
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNjU3Rjg0REEwOUZGQ0E1NzUA	2025-09-27 16:54:22.362908
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxMjFCMzYxQTMyNkUxQkUwRUIA	2025-09-27 16:54:45.876391
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQ0M1MkQ2Mjg1MjlBQUZDQkUA	2025-09-27 16:55:14.938522
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2OTBEQkM0NEZCNzAwQTE3NzEA	2025-09-27 16:55:43.898305
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2ODQzRDE0NjI4NUMzMURCRDUA	2025-09-27 17:27:22.638172
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBRDhBNDk3NEVFNDgxQzhDMjYA	2025-09-27 17:28:25.366139
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMzMwQzQ0MzIwRUM2NzY3M0QA	2025-09-27 17:28:40.847326
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMkIzMEQxOTMyREI5Mjc2MjcA	2025-09-27 17:40:37.377276
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQUQ3MEQyRTk4QjlDNjBFQzUA	2025-09-27 17:40:49.265974
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDNURBRUEwNzU2NjdEMkJBMTcA	2025-09-27 17:41:03.709475
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNEU3RjVFNTQ2ODNEM0U5REQA	2025-09-27 17:42:34.374568
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MjRFRDQwNkVCN0RCNjc3RTAA	2025-09-27 17:42:57.790839
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQ0YyREIwM0UxNDhCRjk1MDAA	2025-09-27 17:57:39.441113
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzMjE4RUU3RUFBRDRGNzc3MUIA	2025-09-27 17:57:55.433504
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBENDU2MDY0MkY2QjI1ODk5N0YA	2025-09-27 17:58:02.901592
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMTQ2Q0M3RDE2NjRGOTE4MDMA	2025-09-27 18:05:54.905278
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RTlGM0ZBNkE5ODVFNTAyOUUA	2025-09-27 18:05:59.579235
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCOTRFMzkxQ0I3NTVDOTg2MzkA	2025-09-27 18:06:23.897603
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2MDBBMzc1OTRCRjQzQzYwMzIA	2025-09-27 18:07:09.354168
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEOENDQkQ4NTAyMjYzRTY0Q0YA	2025-09-27 18:07:16.777589
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5OEVERUUwNUY5MUU0RDBEQjgA	2025-09-27 18:07:44.09433
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFNkVBOEQ2QzZBMjM4NkQxNkMA	2025-09-27 18:11:04.733068
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBERDMxQjYzRTc4Qzk3N0RDMEYA	2025-09-27 18:11:24.665281
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTdFRjI3NkY5RTA3RDM5OUU3AA==	2025-09-27 21:41:23.326713
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzY5NjI0NDBEMDYxNzI4N0VGAA==	2025-09-27 21:41:36.440932
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDhDRDE4MkRCMTEyRDQyMjVBAA==	2025-09-27 21:42:11.679852
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDA1MTlGNDhFQkJBQTdEMEREAA==	2025-09-27 21:42:19.761331
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjI2Rjc1Q0UzQkJCMTFCNEM5AA==	2025-09-27 21:43:14.219691
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOEY2RkNCNzdEMjQ0N0UxMTQ4AA==	2025-09-27 21:43:26.977763
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMDFEMjYzMTlGNTQzOTY3RTM5AA==	2025-09-27 21:43:32.560456
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDVFQURGRDk0MDM4MjVBQjY3AA==	2025-09-27 21:43:40.721328
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTNGODM4OTU5QTBBNjhCMEQyAA==	2025-09-27 21:43:51.857038
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBN0ZENTRFNDgzRjI0MjQ3MzRFAA==	2025-09-27 21:44:06.872324
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNjZEN0EzNDg2QUMxMDg5RTk0AA==	2025-09-27 21:44:19.584734
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjNEODgwRDBFRkY0MTkyMTgwAA==	2025-09-27 21:44:32.92551
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDUyN0MyRjg3NDA3RUE5RTcyAA==	2025-09-27 21:45:03.968346
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjMzQTIyRDg0OTdFRjg5QUJCAA==	2025-09-27 21:45:08.967109
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMEFBRkI3MUMwRjNGQkZGQ0Q2AA==	2025-09-27 21:45:20.179697
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMDdBMkNCNDBBMjBGQkI4NEQ0AA==	2025-09-27 21:45:26.090718
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOEZCMkJEMzdBQjA0RTBENzZBAA==	2025-09-27 21:45:46.423692
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTVGNzQyOUFCODY1OEM4MzM4AA==	2025-09-27 21:45:55.251175
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBN0Y0MDYzMjNDMzBCM0I3NkQ3AA==	2025-09-27 21:46:12.22489
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTI2ODY2MEE4REU5REJERDBBAA==	2025-09-27 21:46:27.17611
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkFENTIyRDEyMUZBODVGN0I0AA==	2025-09-27 21:46:35.100663
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMUE0OTE4MDFFNDEwMkU3QUQ1AA==	2025-09-27 21:46:45.454388
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTAxMDk3NTk1NjZFNjhCM0M3AA==	2025-09-27 21:46:49.779486
wamid.HBgNNTIxOTUxMzIzMzYzORUCABIYFDNBNzI2NjU5RDQ3NzhDQkRDODI3AA==	2025-09-27 21:46:54.52256
wamid.HBgNNTIxOTUxMzIzMzYzORUCABIYFDNBNzgxRjg1NTYwRDZDMzEzMjEwAA==	2025-09-27 21:47:27.552644
wamid.HBgNNTIxOTUxMzIzMzYzORUCABIYFDNBNjkzMkYyRTNDNkVFMjE1NDM2AA==	2025-09-27 21:48:07.467769
wamid.HBgNNTIxOTUxMzIzMzYzORUCABIYFDNBOEFCMTNCMzBGNUREQkIwQzk2AA==	2025-09-27 21:48:31.947119
wamid.HBgNNTIxOTUxMzIzMzYzORUCABIYFDNBQjcxMzFGNjA0QTlDNEVGRTc3AA==	2025-09-27 21:48:36.401694
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNTRFOUYwRUM0MDVFRTY5OTUA	2025-09-27 22:55:37.275303
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0NTdDMjFDNkZEM0MzNEI2MUUA	2025-09-27 22:55:51.311084
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBODJFQkVDMDQ5NDU1RjNGOUUA	2025-09-27 22:56:06.815586
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5NzUwRDhDMTY5NDYzQTJEOTQA	2025-09-27 22:56:12.023818
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4RjdCN0E4NEIzMUEwMDVCQzAA	2025-09-27 23:03:43.926328
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxNDJBQ0YwQTBFQzAwQ0Q3NzYA	2025-09-27 23:03:55.233006
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4RTRFOEY3MzZERTZGODM3MzAA	2025-09-27 23:04:19.538087
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGQTM0NTVDNjY0NDNBNDM5NzQA	2025-09-27 23:04:52.202748
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwOUU1NzA0NUUxMUI3RUQyNTgA	2025-09-27 23:05:17.712286
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMEYxQUNDQzY5ODZGMjM1MzEA	2025-09-27 23:05:27.259694
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwNTVFREMyMjE0RTgwNjhBMzUA	2025-09-27 23:05:45.737456
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBENjIwMzkwNDEzMkIxRURGQTkA	2025-09-27 23:05:56.715101
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5NENBOTFCRDRDREJBNEU4REYA	2025-09-27 23:06:06.005
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQTg3NzA2QUJDMzhEQzRDNjkA	2025-09-27 23:06:20.156294
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDNzM2NjM3MDU1RDI5MDA5ODcA	2025-09-27 23:10:30.141958
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MEUyRDI0QkNDRTYwMjY3QkEA	2025-09-27 23:10:45.921527
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1NTI0MTdBRjg5N0UxNzNFN0YA	2025-09-27 23:10:54.908269
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCQkY4MEJCN0Y0MUJGRDk3RDUA	2025-09-27 23:42:27.783294
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDM0IxMzk5NjAyQkIwQUI4ODAA	2025-09-27 23:43:13.761219
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQjI5QzlGNkM5MjFEMUY0MkUA	2025-09-27 23:43:29.865787
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGRThBMTYyMzA0RENBNkJDNUUA	2025-09-27 23:44:08.587043
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBERjk3MkQyQkMyQjlGMTBDN0MA	2025-09-27 23:56:09.920447
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEOTU2OUIyMDU1QTM5Q0FFMjcA	2025-09-27 23:56:38.878322
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMjEyNTU4Njk1NzJFOEQ1MTYA	2025-09-28 00:08:17.109893
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCNUQ1MjI3NkVENjRDM0FGRDAA	2025-09-28 00:08:36.506169
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4NUJFQ0I5NEUzMTRBRTcyQUQA	2025-09-28 00:17:35.208218
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1NEI4QjJBNDBBQUFEOTFERTEA	2025-09-28 00:23:19.646347
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNUJFODQ1NDZDRERDMjlBNzgA	2025-09-28 00:23:48.919711
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0OTQxQTIyNjBFQkJBM0EzNEQA	2025-09-28 00:29:21.873602
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBRDQxQTM5OUI2MkJDRkI3QTIA	2025-09-28 00:29:43.58535
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMzc0QTYyNTBGNTJFNjFGRTEA	2025-09-28 00:31:48.721762
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1NDc1MzVBQTIwMjFCQUUxQ0IA	2025-09-28 00:34:59.12023
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3NkY1MzQ0NTQyNTU2NkIyQkEA	2025-09-28 00:35:12.79307
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQzNBMTQzODRGNjdEOUJEOEYA	2025-09-28 00:35:28.908793
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5QjlDQjVDN0FDQTE5NEFEQ0UA	2025-09-28 00:35:34.115281
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQkZFN0JGMzEwMTYxNjUxMkIA	2025-09-28 01:39:53.731224
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RjdCREVBMzE3QkJBRjkwQzAA	2025-09-28 01:40:10.345898
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDQ0JFMzg5OERBNzRFQzQ3MjkA	2025-09-28 01:40:20.768739
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFNUYyOENERjg3MEZFQjdBOTEA	2025-09-28 01:40:27.681763
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5OEQ3RUFDRDMxRDFGODEzQzcA	2025-09-28 01:42:48.800551
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGOTg4RkJEOUZDMzNGNjJBRjgA	2025-09-28 01:43:31.58838
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNjY4QUNDQTY0NkIxOUI4OUYA	2025-09-28 01:43:43.329704
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzMzMwQTBBQjBGMjc0OUZDODUA	2025-09-28 01:44:00.135843
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQ0U3NDkwQThERkU4M0ZCOTYA	2025-09-28 01:44:47.607559
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwRERFNkI1NTA0NTM4RDFEQzIA	2025-09-28 01:44:52.907651
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RjUxRjhGMkY1NDVGOEFCQzQA	2025-09-28 01:45:07.721346
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQjE0ODAyODhGNkJBQUZENDcA	2025-09-28 01:45:12.838375
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOTE3RTFFMzJGQkFBODg4QkZEAA==	2025-09-28 18:23:53.479179
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBREIwRjFCNzk5NDZCRTZBRkU5AA==	2025-09-28 18:24:31.235393
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNTg2RTE0NjQ5Q0Y4MjAyMDBCAA==	2025-09-28 18:24:44.221321
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMkM5REJCRkNCRDlCRjlGMzQwAA==	2025-09-28 18:24:54.120165
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDQ2QTE2NzI3MzVGQjFBRDRGAA==	2025-09-28 18:25:57.152152
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRTIyQUQwOUJCRjNDMzc1OTk4AA==	2025-09-28 18:26:11.469604
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNUMxQzMyQzYyNjU1QTJGRUI4AA==	2025-09-28 18:26:20.409368
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTgwNjNFNjdFRjdEQTY5RTdBAA==	2025-09-28 18:26:46.585752
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjQ2MUVFNDFEOTdCQzBGRUI1AA==	2025-09-28 18:26:59.572282
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQ0U1Q0JCQTRFQzk0OUI1MTAyAA==	2025-09-28 18:27:19.529134
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBODE0MjFGOERFOUNDNUNCOTg0AA==	2025-09-28 18:27:38.326228
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMTE1ODUxMDc2MzM4MEVBMDFBAA==	2025-09-28 18:28:25.876962
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDYwOTgwQkZBQ0QzQjczOERBAA==	2025-09-28 18:28:38.143366
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOTNFRUMzODM4MEU4MTZGQ0IwAA==	2025-09-28 18:29:15.253585
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjJEOUQ3QTM5NDVCQjdGQzA5AA==	2025-09-28 18:29:59.101726
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzE2QTlDNTkwNTcwQTE1NjJEAA==	2025-09-28 18:31:28.065569
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMEE5NjU2M0MzNTBERTdFODgwAA==	2025-09-28 18:32:09.532718
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzU3ODc3MjVFM0NBQUJFQ0M5AA==	2025-09-28 18:32:30.253983
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTY4QzA5QTBFOUYyRTcwOUZEAA==	2025-09-28 18:32:43.211546
wamid.HBgNNTIxNjg2MzExMjYyMxUCABIYIEE1MTI1RTVDQzEyRkY2NUY0MzIyMEUyMjM4OTNFQjVBAA==	2025-10-01 23:45:06.092907
wamid.HBgNNTIxNjg2MzExMjYyMxUCABIYIEE1NTMyNTZGNzM5NjdCNDRFOUYyRDlFMzg2QkIwQ0M2AA==	2025-10-01 23:45:19.475986
wamid.HBgNNTIxNjg2MzExMjYyMxUCABIYIEE1OTJCQzVDQTk5MjNERTg4M0Y1OEE5RkY3MEZBQkNGAA==	2025-10-01 23:45:37.459119
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDM2MTdGRkM0MUU0QzY3MDJEAA==	2025-10-01 23:45:59.584431
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQTRENjEyRjY3OURDMUQ0NjBGAA==	2025-10-01 23:46:14.524755
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjFFNDY1OUYwQzFBMUFEQjgwAA==	2025-10-01 23:46:35.420013
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQkE0RkVDRkVGRDExOEMwMEFEAA==	2025-10-01 23:47:20.563151
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQjE4RDNFRkNEQTE1M0ZCOEM4Q0IxNDYxMjUzN0ZEAA==	2025-10-02 00:13:57.867948
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDREVDMjE5OEM3MTYxRTE1NjRGOThCNTIyQjI1RUZFAA==	2025-10-02 00:14:09.75191
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNEIxMEY2MThDRTJGN0Q1NkQwQzM3QUY4NERENjhFAA==	2025-10-02 00:14:34.545553
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDOUQ4MzgxNkQwNjI1NkMzNkVBNTgyODkwMzE5RUNCAA==	2025-10-02 00:14:55.03137
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDOEQwQTlFMzdBOTFFMThBMjY1NDhDNEFCRjQzRjY4AA==	2025-10-02 00:15:34.283296
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMTc5Q0VCOUM0NjdGQkEwRTNCNzBCRUM5RDg0M0U1AA==	2025-10-02 00:15:54.932305
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNjM1RkM2MUEyMTFDRjVCRkZGMTA5QzdENUJEN0I5AA==	2025-10-02 00:16:06.672325
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDM0JCRDJEMzEwMDdBMTZDRUExOTZBQjE5RUQxNjM4AA==	2025-10-02 00:16:14.996065
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRjdGNjU2NDY5MDMwQzIyMzU2NTAzNkQyMzI4Q0M1AA==	2025-10-02 00:16:20.820408
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNDFENkVFODJDQTI4RTlDMzIyMDUxRUREMjBFQTE4AA==	2025-10-02 00:16:27.099034
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNjRBNjhFRURDQTBENzIzRjhCRUY5RDA1OTEwQjE0AA==	2025-10-02 00:16:43.84777
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDN0Q5QTVBODI0RTNCMTlFMUQ4NEMyNkI0NDI0QkFDAA==	2025-10-02 00:17:08.497941
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDMjYzNzQxNTQ2QTlBQUZCOEUwNjYzRkRGMEI3Q0Y3AA==	2025-10-02 00:17:15.913215
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQkMxQTc2MjAzQjEyQjBBMUMxODU1NzUyMEVENEFGAA==	2025-10-02 00:17:19.077979
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQTdDMzkzNjNENEYxQTc0ODI5N0M2OUNCQjM4Njg4AA==	2025-10-02 00:17:39.904555
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQTc3OTYwMERGMTRCNTM3NUQxNTdBOENDOERENkZBAA==	2025-10-02 00:17:59.818859
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQTBBRDJDNUNFODgzN0E5RUUwMDEzODUwOEVDMUUxAA==	2025-10-02 00:18:50.527202
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDNzY4NTk2RDg2NzMyREY4RjMxMEFGOUNGQTRBQjg4AA==	2025-10-02 00:18:53.672229
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDRDc2QTQzNDQwNkVGMEI4M0ZBMzE1OTc1MEUzMjMwAA==	2025-10-02 00:19:08.809113
wamid.HBgNNTIxNjg2MzAzOTcxNhUCABIYIEFDQUU2Qzg0NzE2QTdGQjhCMkU1QTZGNjVFQjAyM0EwAA==	2025-10-02 00:19:30.868594
wamid.HBgNNTIxNjg2MjIyODMxMxUCABIYIEFDQzdCMDg3MjNBM0FFMTNDODhGQzBGRjQzNTc4NDZCAA==	2025-10-02 19:39:21.307851
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOTVBRDExMDI4Rjg4RTY1NTY5AA==	2025-10-02 20:25:14.976153
wamid.HBgNNTIxNjg2MjIyODMxMxUCABIYIEFDMDJCMTAzQzMwRkFCNDVFQ0U4MkUzMERBMEZGNkQ3AA==	2025-10-02 20:44:08.39479
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOEIwRUM3MjQ3OTNFOTIxMDY5AA==	2025-10-02 21:07:46.673614
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyOEU4MDUwOUQ0NUQ3MDlCNjEA	2025-10-06 20:27:29.596367
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNTY5NTczMzUxRkNENjE0OEUA	2025-10-06 20:36:22.432087
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMDQ2QzE5NzE3RTA1QzUwREEA	2025-10-06 20:55:44.817469
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzM4NUM4QzU1NzgzMzJFOTY1AA==	2025-10-13 23:51:57.401472
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjlDMTNFMjI5ODc0M0Y1MDRDAA==	2025-10-16 16:11:49.787299
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDZCRTg4N0Y4Mjk2MDQ2QUU2AA==	2025-10-16 16:11:57.599841
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNzc4RUY1NUJBNzMyOTQ4RUQxAA==	2025-10-16 16:12:11.716242
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBN0Y4ODkwMTRGQTI1QjExQjFFAA==	2025-10-16 16:12:35.658129
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDUyOTY1QkM1QjFBMjY2QTdFAA==	2025-10-16 16:12:44.784117
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMEIyNTJCQThBQjA2RTkxMUQwAA==	2025-10-17 21:48:42.919191
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNkQ5OTJBOUZBODMxREI5ODIzAA==	2025-10-17 21:48:51.494996
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4NUYwNjFCNkQxRjNBNjAyRjIA	2025-10-21 08:04:33.224134
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3OTBCREVCODQwNTM1OTc3M0UA	2025-10-21 08:04:42.946507
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3OEM0NkZCMkUyNDgzMDA0MTYA	2025-10-21 08:05:14.846785
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxMkQ5RjcwRDg5MUY4QkJGMDgA	2025-10-21 08:42:04.157397
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1Qjg1ODE0NDRGODM0OEE2MjUA	2025-10-21 08:42:11.460594
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1RTE2MDBDMzE1MTkyQzNBMDgA	2025-10-21 08:42:29.804081
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCOTkxMzk5M0NFM0EyNjAyOUEA	2025-10-21 08:43:03.015689
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1QTUyMTEwODA5REM0OTI3MEUA	2025-10-21 08:47:23.525253
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxOTc4MjRFMjQzMkQ4RThGNTgA	2025-10-21 08:53:27.27002
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRTA1QzRCMzVBQzczQzMzQTEA	2025-10-21 08:59:51.160307
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQ0I3NUMxQjYxQUI2ODc1MEQA	2025-10-21 09:00:16.165774
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMThGNkVGRUIwRDI3NDRENTIA	2025-10-21 09:00:38.992626
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MTczMDBDMzExNDcwNjE5NjkA	2025-10-21 09:01:07.779723
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFOEE3NUY4MkFBOTUyRTQxRTAA	2025-10-21 09:01:25.820251
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwN0E1QzVBODE3NkQ1QjU4QjMA	2025-10-21 09:03:05.34556
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4QUIxNTQzMUM5QTQ4RDQxRTMA	2025-10-21 09:03:17.280506
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzNDI2RjUzRkEyMkUwRUJEMDAA	2025-10-21 09:03:27.597442
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4NjVDODBGN0Y5QzJCRUVFREQA	2025-10-21 09:03:36.581003
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEQzNCQzZDQUM5OENFM0JCNzIA	2025-10-21 09:03:48.743055
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzOUE1REQ2NTVFN0NGQTM1NjEA	2025-10-21 09:04:14.235735
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2MkQwQzY3M0NDODg4NzUwODQA	2025-10-21 09:04:36.701072
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwNjQ0QjY1QjVCNkJENUQxNzYA	2025-10-21 09:04:52.842612
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RjY0RjZCMzY5OTkyM0U5MzUA	2025-10-21 09:05:15.393019
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NkJEOTU2NDE0MjE0Qjc2MTgA	2025-10-21 09:05:38.432438
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0OEJENUI4Mzg4ODIwQzZEMDYA	2025-10-21 09:06:52.717906
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4OTcyRDU5MEQ1MDNBMEQxODgA	2025-10-21 09:07:14.140508
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMEYzOTczODBDQzNFRjZBNzgA	2025-10-21 09:07:32.201252
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RDk0NDM3OTM4Njk0QzE1OEUA	2025-10-21 09:07:49.5123
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMjFEMTUzNUQ2NjA4MjA1QzAA	2025-10-21 09:09:09.343365
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0Q0Q5RTM1N0RERkZDMzFCNTcA	2025-10-21 09:53:49.632242
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzMEY3RDBCOEEwRDVFODQwQTkA	2025-10-21 09:53:58.873958
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDRDBCNkZGNDc4QzNBMzAwMDAA	2025-10-21 09:54:07.053867
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFQUFFNDk3OEE4NTFERTU2MTkA	2025-10-21 09:54:26.72953
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MEE2MzhGMDE1MDE4RDE2NkYA	2025-10-21 09:58:58.54005
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwNEZFQkQ5Rjk2NzVBQjMyMEEA	2025-10-21 09:59:18.456455
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzODY3NzFBNDRGOERCQjNCQUQA	2025-10-21 09:59:58.842265
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzQjYyNEMyREYzQ0JCN0I1QUMA	2025-10-21 10:00:31.66139
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCOTJDNEFBQ0M3MkYxNjcyRTIA	2025-10-21 19:07:03.497362
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwQTRGMDIyMTMzODhCNjVEQjEA	2025-10-21 19:07:43.56388
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDRUJFQkZCOEVGQzlBRjY2Q0UA	2025-10-21 19:08:15.81602
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzOTA3NTlBN0E0NERFMENCRTEA	2025-10-21 19:08:30.661831
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGNDEwNDU1QTRFQUI5MzI3RTYA	2025-10-21 19:08:36.309395
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RjNBNTIyNkQzMTlFNjNEOEMA	2025-10-21 19:45:27.861671
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMjYwRTdEN0E3QUJFRTg3MkYA	2025-10-21 19:45:56.672783
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGRjBCQkI5OUU0NzdCNzAyOUMA	2025-10-21 19:46:48.672455
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMzU5QjAwODEyODg0MDA2OTQA	2025-10-21 19:47:10.651408
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxQkRENzZGRUQ0NjY1RjYzN0YA	2025-10-21 20:33:17.611361
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBERkQ2NTgxQjI2OUM4MjdEODgA	2025-10-21 20:33:37.377715
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzRTI1REE2MDU2NkFCRDU5RDEA	2025-10-21 20:43:33.647275
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1QTI0QTRFRUVBNzlFREI1NzQA	2025-10-21 20:43:57.098048
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwMjIwRjQ0RUEwQUFCMDZGRTEA	2025-10-21 20:50:12.50239
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBQTkwRjlFQTAxMzZEREVEODgA	2025-10-21 20:59:10.183759
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0MjIwMjBGOUI4NDJBMDU4NjIA	2025-10-21 21:05:38.02603
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDU3MTczNzYwRjdERUMxMjIwAA==	2025-10-21 21:44:56.921269
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQzJBMzYzNDU3NjI5NUQ1QjAwAA==	2025-10-21 21:45:31.064133
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMjdENDBEODk5NUZGM0Y3QkJDAA==	2025-10-21 21:45:39.918843
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDFDMkZEQ0Y1ODE4OUVFNkVDAA==	2025-10-21 21:47:47.972264
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOUE3MjMxREM5MDFFNjhCMzlGAA==	2025-10-21 21:48:04.658658
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQ0I1NEQ5NTc4OERBQThBNTM0AA==	2025-10-21 21:48:25.973249
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDY3OUNGNTQxMzJBREQxQzM4AA==	2025-10-21 21:48:40.999322
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQkMzQkVEODI4MkIzOTM5RjU4AA==	2025-10-21 21:48:59.146078
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRDUyNjZFNTNEOEI4RjI2NTIxAA==	2025-10-21 21:49:23.592973
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRjg3REI5NkVCNDBGODg0MjBFAA==	2025-10-21 21:49:30.861365
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjg0RTJCMjU3M0MxRDAwNzc3AA==	2025-10-21 21:49:39.543209
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBOEJEMDRDRjM3MjQ5QTM0NDVDAA==	2025-10-21 21:50:09.886527
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBRkVBOUJGNDI4RkE0MUYzM0U2AA==	2025-10-21 21:52:59.194379
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBNDA4ODkxQjZBNzk4NkVBQzlGAA==	2025-10-21 21:53:05.921478
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBMUE2ODc1MDczNjM4MDkyM0M5AA==	2025-10-21 21:53:29.83064
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQUM1NUY2QjZGQTRCNjc3ODlCAA==	2025-10-21 21:53:54.404171
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjdFMzI4NTNFMUFERDcyM0NBAA==	2025-10-21 21:54:00.69729
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBMjVFRDMxMjY4Q0NGMDU2NjQA	2025-10-21 22:13:59.626983
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFRTEyMTVCNDk1RkZBOTM1MEEA	2025-10-21 22:14:20.247468
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDNBQjRERDY5REIxQTgwQjk5OTAyAA==	2025-10-21 22:18:57.798621
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBGMjhFNDQyMDA2QUE1MzVDMTIA	2025-10-21 22:29:38.373158
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5NTVENkJEQjgxNjg4NUNFOEUA	2025-10-21 22:29:52.903005
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyODEyRDY2RDRDQTUwMTk5NTAA	2025-10-21 22:30:06.156261
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyM0U1MzkwQTQ0ODFGQTU1MEQA	2025-10-21 22:44:52.665364
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3QTkwNkFDNUNCRjNGRDQ4RUUA	2025-10-21 22:45:05.960358
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFREI3Q0FGRkQ0RjA2RERGRjQA	2025-10-21 22:45:21.940664
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4OEVCOTMzNDU0QjE1OTM5MTQA	2025-10-21 22:45:28.358281
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFODMzNzkxRjc2RTU3Mzc3NTgA	2025-10-21 22:45:45.653537
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3Q0NDQjhDM0NBREJGQTExMTAA	2025-10-21 22:46:01.164503
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDOEFEQzgyMzYyQjc3NkMyMzEA	2025-10-21 22:46:21.079417
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzREM4NUZFODU5M0MwRUE1OUQA	2025-10-21 22:46:36.641837
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxMENCOEI4NjNFNkI5MUI5OTUA	2025-10-21 22:46:55.505506
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA4Mjg4Mjg1MkYxMEJEMkM0NzEA	2025-10-21 22:47:03.955269
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRUVDRERDOUE5QzA4NUZBQzgA	2025-10-21 23:13:27.762144
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2MDcwQjdDQzZCOERCRTU5QzEA	2025-10-21 23:13:45.930227
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2RTg0QTk1MzlDQkQ0NjVENEYA	2025-10-21 23:14:10.685947
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMUY4NTc5RUM5MzJERTA3QUQA	2025-10-21 23:14:17.244386
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBDMzkxQjBBMDE4QTBBMjU5NTgA	2025-10-21 23:17:47.130274
wamid.HBgNNTIxNjg2MzA3MzM5MBUCABIYFDNGOTExMzhFQTg2OTQxNjM1M0ZDAA==	2025-10-21 23:18:51.17357
wamid.HBgNNTIxNjg2MzA3MzM5MBUCABIYFDNGQUZDM0NFQzNERTU5NkVBQjBCAA==	2025-10-21 23:19:33.091721
wamid.HBgNNTIxNjg2MzA3MzM5MBUCABIYFDNGRkE3MDA4REExQzc4Mjg4RkRBAA==	2025-10-21 23:19:54.780789
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBCMEI1NkJDQjU1MDFENjFDODIA	2025-10-21 23:42:32.784688
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2NzQ2QUZFOUIxQkY4MjJBNjUA	2025-10-21 23:42:48.418221
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5OEYxMUI0OTcxNDJFQ0EzQzMA	2025-10-21 23:43:02.351409
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyRTdCMTc2RUE4M0IyQzI1ODIA	2025-10-21 23:43:28.496786
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBEMDYzQjUyRTg5N0YyMTJDRDYA	2025-10-21 23:43:36.930511
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1M0ZCNUQxMDA1QzBDODhGOEIA	2025-11-19 05:21:49.210439
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAzQjU4MDRGRjg5MUZGNTk4QzEA	2025-11-19 23:57:29.312769
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3REQ4QjVFNkQyOTRFMDdFMTkA	2025-11-20 06:38:18.391517
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBMzlBRTVDRkU1QTcxN0E3QjU3AA==	2025-11-20 18:14:53.032414
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBOURFOEVDQ0EzRENDRDZBMEVFAA==	2025-11-20 19:08:25.280297
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA1MDMwRTMyRkJGRENCNTQxNzMA	2025-11-19 05:53:08.937319
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3OEEyODk2OThFRUM3MjI5NTkA	2025-11-20 00:00:41.69762
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFMUEyNTdBM0MyRTUyNTA4NjcA	2025-11-20 06:38:39.103709
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBQTg1MjhFQzI1RjY2NUE4RDhCAA==	2025-11-20 18:16:48.278182
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBQkZDRDIwMzM3RTQ4OUYwNEUzAA==	2025-11-20 19:12:35.268374
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA0RTRFQzhEQkQyNkVFQzU1NzAA	2025-11-19 23:18:33.19348
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA3NEI0RDRFMzcyMjBBMzdBRTgA	2025-11-20 06:21:15.566252
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5QkZDMUY4RkZDRDg4NDdCOTEA	2025-11-20 08:05:46.012587
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAyMEExNEZEMkVDRDI4QkFCQzUA	2025-11-20 18:17:38.076674
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDJBNDc2MTg3NzZEN0M3NjAxMThCAA==	2025-11-20 19:12:58.881422
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAxOEFDRDVDRjQ0RjExNzIyMzYA	2025-11-19 23:40:04.990792
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA5MkZCNUQ2QTM2NzE0MTVEODYA	2025-11-20 06:21:54.513249
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDJBQjY4RTZFNDZBM0Y3NzdGOTIyAA==	2025-11-20 17:42:59.631831
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBMUY0RjkyNUEwNzNGNzZCMUFEAA==	2025-11-20 18:18:48.646474
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDJBQUQ2QzBGNzU4NTlCQTJGMTlCAA==	2025-11-20 19:15:26.438005
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBFRDcxN0RDOTdDQUY2Mzg5NEMA	2025-11-19 23:51:58.511435
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjAwRUE5NUZBM0NGRTNFRDZCQTAA	2025-11-20 06:36:13.78127
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDJBRkE3N0VEOTlGMjExQUM4OTEyAA==	2025-11-20 17:44:26.005947
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBRDYyNTkzMzUzMzk2MDNDMDk3AA==	2025-11-20 18:20:58.777229
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjA2N0M5NTg3RDU3REQ2NzcxMDMA	2025-11-19 23:52:19.287106
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFjNFQjBBNEZCNEJBNjNBOEUxQjcxMTkA	2025-11-20 06:36:36.300218
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBMkI3MkJDRUFFM0NBREY1RDkwAA==	2025-11-20 17:45:20.148042
wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABIYFDJBNDYzQzgxMzQxQTJDMkVCRTAxAA==	2025-11-20 18:23:07.819976
wamid.HBgNNTIxODEzNTUxODU3NRUCABIYFDNBQzczRkFGREY0NEUyMEM5MUI3AA==	2025-11-20 18:23:17.002824
\.


--
-- Data for Name: whatsapp_faqs; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.whatsapp_faqs (id, slug, title, patterns, answer_text, price_text, buttons, media_link, active, priority, sucursal_id, created_at, updated_at) FROM stdin;
1	limpieza	Limpieza dental	{limpieza,profilaxis,sarro,placa,"limpieza dental"}	🦷 **Limpieza (profilaxis)**\n• Retira placa y sarro para prevenir caries y gingivitis.\n• No duele; a veces hay sensibilidad ligera.\n• Duración: 30–45 min. Recomendación cada 6 meses.\n• Después: evitar alimentos muy pigmentados 24 h si hay pulido.\n\n*Info orientativa. La evaluación confirma diagnóstico y plan.*	💰 **Rango**: desde $___ MXN (según evaluación y necesidades).	[{"id": "AGENDAR_HOY", "title": "Agendar evaluación"}, {"id": "FAQ_PRECIOS_limpieza", "title": "Precios"}]	\N	t	100	\N	2025-09-18 19:12:31.737716+00	2025-09-18 19:12:31.737716+00
2	blanqueamiento	Blanqueamiento	{blanqueamiento,"dientes blancos","aclarar dientes",blanquear}	✨ **Blanqueamiento**\n• Aclara el tono dental.\n• Candidato: sin caries activas ni sensibilidad severa.\n• Tiempo: 1–2 sesiones de 45–60 min; a veces férulas en casa.\n• Puede haber sensibilidad temporal; cuidar dieta sin pigmentos 48–72 h.\n\n*Info orientativa. La evaluación define el plan.*	💰 **Rangos**: en clínica desde $___ MXN; en casa desde $___ MXN.	[{"id": "AGENDAR_HOY", "title": "Agendar evaluación"}, {"id": "FAQ_PRECIOS_blanqueamiento", "title": "Precios"}]	\N	t	100	\N	2025-09-18 19:12:31.737716+00	2025-09-18 19:12:31.737716+00
3	brackets	Brackets (ortodoncia)	{brackets,ortodoncia,frenillos,alineadores,invisalign}	😬 **Ortodoncia (brackets/alineadores)**\n• Corrige alineación y mordida.\n• Opciones: metálicos, estéticos, autoligado, alineadores.\n• Duración estimada: 12–24 meses; controles cada 4–8 semanas.\n\n*La valoración de ortodoncia confirma el plan y tiempos.*	💳 **Planes** desde $___ MXN/mes; pago inicial desde $___ MXN (según opción).	[{"id": "AGENDAR_HOY", "title": "Agendar valoración"}, {"id": "FAQ_PRECIOS_brackets", "title": "Financiamiento"}]	\N	t	100	\N	2025-09-18 19:12:31.737716+00	2025-09-18 19:12:31.737716+00
4	endodoncia	Endodoncia (conducto)	{endodoncia,conducto,"dolor muela","infeccion diente","endodoncia precio"}	🧪 **Endodoncia**\n• Retira nervio infectado para eliminar dolor y salvar la pieza.\n• Con anestesia; puede haber molestia 24–48 h.\n• Suele requerir **corona** después para proteger el diente.\n\n*La evaluación clínica y radiográfica confirman el plan.*	💰 **Desde** $___ MXN por pieza (depende de complejidad y raíces).	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "FAQ_PRECIOS_endodoncia", "title": "Precios"}]	\N	t	100	\N	2025-09-18 19:12:31.737716+00	2025-09-18 19:12:31.737716+00
5	muela_juicio	Extracción de muela del juicio	{"muela del juicio",cordal,"tercer molar","extraccion muela juicio","quitar muela juicio"}	🦷 **Muela del juicio**\n• Se indica por dolor, infección, falta de espacio o mala posición.\n• Anestesia local; 20–60 min según complejidad.\n• Recuperación: inflamación 2–3 días; dieta blanda; no fumar.\n\n*Una Rx panorámica ayuda a planear la cirugía.*	💰 **Simple** desde $___ MXN; **quirúrgica** desde $___ MXN.	[{"id": "AGENDAR_HOY", "title": "Agendar evaluación"}, {"id": "FAQ_PRECIOS_muela_juicio", "title": "Precios"}]	\N	t	100	\N	2025-09-18 19:12:31.737716+00	2025-09-18 19:12:31.737716+00
7	ortodoncia	Ortodoncia (brackets/alineadores)	{ortodoncia,brackets,alineadores,frenillos}	Alinea dientes y mejora la mordida. Ofrecemos brackets metálicos, estéticos y alineadores.	Planes desde $X mensuales; confirmamos en valoración inicial.	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	76	\N	2025-09-18 23:04:40.266222+00	2025-09-18 23:04:40.266222+00
8	carillas	Carillas estéticas	{carillas,facetas,laminas,"estetica dental"}	Mejoran forma y color del diente. Se requiere planificación previa para un resultado natural.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	72	\N	2025-09-18 23:04:40.269509+00	2025-09-18 23:04:40.269509+00
6	implantes	Implantes dentales	{implantes,"implante dental",tornillo,"falta diente"}	Reemplazan piezas ausentes con una raíz de titanio y corona. Alta estabilidad y estética.	Plan integral desde $X; depende de estudio óseo.	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	90	\N	2025-09-18 19:12:31.737716+00	2025-09-18 23:04:40.27075+00
10	coronas	Coronas (fundas)	{corona,coronas,funda,fundas,incrustacion}	Protegen y restauran dientes debilitados o tras endodoncia. Materiales estéticos disponibles.	Desde $X por pieza; confirmamos en valoración.	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	74	\N	2025-09-18 23:04:40.272998+00	2025-09-18 23:04:40.272998+00
11	bruxismo	Bruxismo / placa de descanso	{bruxismo,"apretar dientes",rechinar,placa,"guarda oclusal"}	El apretamiento puede desgastar dientes y causar dolor. La placa protege y alivia.	Placa desde $X; confirmamos en valoración.	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	60	\N	2025-09-18 23:04:40.27397+00	2025-09-18 23:04:40.27397+00
13	radiografias	Radiografías	{radiografia,"rayos x",rx,panoramica,periapical}	Las radiografías ayudan a diagnosticar con precisión. Se toman sólo si son necesarias.	Desde $X por imagen.	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	58	\N	2025-09-18 23:04:56.095899+00	2025-09-18 23:04:56.095899+00
14	retenedores	Retenedores	{retenedor,retenedores,"post ortodoncia","mantenimiento ortodoncia"}	Mantienen los dientes en su nueva posición tras ortodoncia.	Desde $X por arcada.	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	56	\N	2025-09-18 23:04:56.096956+00	2025-09-18 23:04:56.096956+00
12	urgencias	Urgencias dentales	{"me duele mucho",urgencias,emergencia,"dolor urgente",urgencia,hinchado}	Atendemos dolor agudo, fracturas y abscesos. Buscamos aliviar el dolor y resolver la causa.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	95	\N	2025-09-18 23:04:56.09288+00	2025-09-18 23:27:42.605338+00
15	periodoncia	Periodoncia (encías)	{encias,"sangrado encia",periodontitis,gingivitis,raspado}	Tratamos inflamación y sangrado de encías para evitar pérdida de soporte dental.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	66	\N	2025-09-18 23:04:56.098039+00	2025-09-18 23:04:56.098039+00
16	protesis	Prótesis (parcial/completa)	{protesis,"placa dental",dentadura,parcial,completa}	Alternativa removible para reemplazar varias piezas ausentes. Se diseña a medida.	Desde $X; depende de número de piezas y material.	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	62	\N	2025-09-18 23:04:56.099366+00	2025-09-18 23:04:56.099366+00
17	sensibilidad	Sensibilidad y dolor post-tratamiento	{sensibilidad,duele,"dolor despues",molestia}	Puede haber ligera molestia temporal. Indicamos cuidados y analgésicos si se requiere.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	54	\N	2025-09-18 23:05:07.168971+00	2025-09-18 23:05:07.168971+00
18	sangrado	Sangrado de encías	{sangrado,"sangra encia","sangrado al cepillar"}	El sangrado frecuente indica inflamación. Una valoración y limpieza profunda pueden ayudar.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	52	\N	2025-09-18 23:05:07.172863+00	2025-09-18 23:05:07.172863+00
19	embarazo	Atención durante embarazo	{embarazo,embarazada,gestacion}	Podemos atenderte con precauciones y en coordinación con tu médico. Evitamos procedimientos no urgentes en el primer trimestre.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	50	\N	2025-09-18 23:05:07.173964+00	2025-09-18 23:05:07.173964+00
20	odontopediatria	Odontopediatría (niños)	{nino,nina,infantil,pediatria,odontopediatria}	Atención amable y técnicas adaptadas para peques. Revisión, selladores y educación de higiene.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	64	\N	2025-09-18 23:05:07.175269+00	2025-09-18 23:05:07.175269+00
21	pagos	Formas de pago y seguros	{pago,pagos,tarjeta,efectivo,seguro,aseguradora}	Aceptamos diversas formas de pago. Podemos elaborar presupuestos y planes según tu tratamiento.	\N	[{"id": "AGENDAR_HOY", "title": "Agendar hoy"}, {"id": "AGENDAR_ASESOR", "title": "Asesor"}]	\N	t	48	\N	2025-09-18 23:05:07.176438+00	2025-09-18 23:05:07.176438+00
\.


--
-- Data for Name: whatsapp_messages; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.whatsapp_messages (id, wa_message_id, direction, phone, message, status, appointment_id, sucursal_id, manual, created_at, raw) FROM stdin;
1	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjkxRUJBNTU2NzJFOTFDRDk5MAA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	2	sucursal_1	f	2025-11-19 02:35:29.43663+00	\N
2	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjY4MTM1M0NGMzQ3NzY4QkQyNQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	2	sucursal_1	f	2025-11-19 02:47:15.508554+00	\N
3	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjRERjBGNjJBMDhBMTBEREM1MQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	2	sucursal_1	f	2025-11-19 04:26:05.366245+00	\N
4	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjBFMzIzRUY3MTVFMTlGNzg2RAA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	2	sucursal_1	f	2025-11-19 04:34:29.092016+00	\N
5	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkNFNUZGODI5NEFFOTk3QzI0RAA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	3	sucursal_1	f	2025-11-19 04:50:59.513767+00	\N
6	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkRDMTg1NDc2MDJGNjUwMThGQQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	3	sucursal_1	f	2025-11-19 05:14:47.541177+00	\N
7	\N	incoming	+5216867865454	CONFIRMAR	received	\N	victoria	f	2025-11-19 05:15:01.965455+00	\N
8	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjg0RDE1MEZFQzgyM0Q4QkM0OQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	3	sucursal_1	f	2025-11-19 05:21:36.461098+00	\N
9	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_1	f	2025-11-19 05:21:48.423879+00	\N
10	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjQ1QjAyRUU2NUQ2NDZGMDg4NAA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	3	sucursal_1	f	2025-11-19 05:52:45.779465+00	\N
11	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_1	f	2025-11-19 05:53:08.365787+00	\N
12	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjQyRkNCMUI2Rjc1QUZENkY1NgA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	4	sucursal_2	f	2025-11-19 23:18:14.145117+00	\N
13	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_2	f	2025-11-19 23:18:32.568912+00	\N
14	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjVDODlGNjQyNUQ3MUNGQUE2NAA=	outgoing	6867865454	Hola pedro, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	4	sucursal_2	f	2025-11-19 23:39:46.042608+00	\N
15	\N	incoming	+5216867865454	5	received	\N	sucursal_2	f	2025-11-19 23:40:04.317927+00	\N
16	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjZFNEQ0MTI1OEM5NTJDMkFDNAA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	5	sucursal_2	f	2025-11-19 23:51:47.168682+00	\N
17	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_2	f	2025-11-19 23:51:57.960338+00	\N
18	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkVGQjk3QzBFNTE2MDcxQTgwOQA=	outgoing	6867865454	Hola Antonio Rivera, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	5	sucursal_2	f	2025-11-19 23:52:10.022467+00	\N
19	\N	incoming	+5216867865454	5	received	\N	sucursal_2	f	2025-11-19 23:52:18.823223+00	\N
20	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjI3REEzMTA1OTg3RjQwRUY3RgA=	outgoing	6867865454	Hola Jesus, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	6	sucursal_2	f	2025-11-19 23:57:19.73696+00	\N
21	\N	incoming	+5216867865454	5	received	\N	sucursal_2	f	2025-11-19 23:57:28.78189+00	\N
22	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjMyODUwRjUxNzBFQzcxMzZBMAA=	outgoing	6867865454	Hola Adalberto Flores, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	7	sucursal_2	f	2025-11-20 00:00:26.713875+00	\N
23	\N	incoming	+5216867865454	5	received	\N	sucursal_2	f	2025-11-20 00:00:41.198455+00	\N
24	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkZFNjZDMzNCMUZENjhCQTI1QwA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	8	sucursal_1	f	2025-11-20 06:20:58.379796+00	\N
25	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 06:21:15.035972+00	\N
26	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkM3RDE3MEYwODY2MjIyNTcwMQA=	outgoing	6867865454	Hola roberto Muñoz, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	8	sucursal_1	f	2025-11-20 06:21:44.91256+00	\N
27	\N	incoming	+5216867865454	5	received	\N	sucursal_1	f	2025-11-20 06:21:54.003755+00	\N
28	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjA0MTc5NEQ3ODNEOUI0REEyNgA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	9	sucursal_1	f	2025-11-20 06:36:01.828695+00	\N
29	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 06:36:13.104581+00	\N
30	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkVEMTI4Q0M5REYxRDcwQkUyMgA=	outgoing	6867865454	Hola yaneth, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	9	sucursal_1	f	2025-11-20 06:36:27.716077+00	\N
31	\N	incoming	+5216867865454	5	received	\N	sucursal_1	f	2025-11-20 06:36:35.40465+00	\N
32	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkQ2OTAzMjEyMTI0MjI5NjVERQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	10	sucursal_1	f	2025-11-20 06:38:08.132477+00	\N
33	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 06:38:17.698429+00	\N
34	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkFEODlEOTA0MTkxNEE5NUMyNgA=	outgoing	6867865454	Hola azul, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	10	sucursal_1	f	2025-11-20 06:38:30.818026+00	\N
35	\N	incoming	+5216867865454	2	received	\N	sucursal_1	f	2025-11-20 06:38:38.48367+00	\N
36	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjQ2QzVGMTZDRThEQTBDQjhDRgA=	outgoing	+5216867865454	[faq:brackets] Brackets (ortodoncia)	sent	\N	sucursal_1	f	2025-11-20 08:05:46.010571+00	\N
37	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkVCNDRFQ0UwN0RFQUUxQkIxRQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	11	sucursal_1	f	2025-11-20 09:31:34.173871+00	\N
38	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjZBQjcyNEM0NEQ3QjA2Q0QzOQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	11	sucursal_1	f	2025-11-20 09:45:01.921437+00	\N
39	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkEyRDI4NzAwMDYzRDlENjA0QQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	11	sucursal_1	f	2025-11-20 09:48:32.391724+00	\N
40	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjc5N0FDRjAzMDQxMkJGQkU0RAA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	11	sucursal_1	f	2025-11-20 09:48:50.049069+00	\N
41	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjNFQUJEMDE5NDZGOEM3OTQzQQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 09:50:25.492217+00	\N
42	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjk2REE0RjRFMThFNkJERTA4NQA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 16:00:04.628145+00	\N
43	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjVCRUU2Njg2RTlFMUVFNDYyMwA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 17:42:35.559979+00	\N
44	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEkU3QzY2MTIwNEJFRjEwRkMyQgA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	13	sucursal_1	f	2025-11-20 17:42:36.296046+00	\N
45	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_2	f	2025-11-20 17:42:58.816056+00	\N
46	\N	incoming	+5216867865454	Reprogramar	received	\N	sucursal_2	f	2025-11-20 17:44:25.95305+00	\N
47	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 17:45:19.469328+00	\N
48	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEjlGOEI3QUFCNkYwQjM5RkQ0QQA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	13	sucursal_1	f	2025-11-20 18:14:40.809922+00	\N
49	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 18:14:52.405631+00	\N
50	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjU0NkU5MTc4MTcwNDg1RjYyOAA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 18:16:39.100712+00	\N
51	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEkEzOTZGNUQzN0NDOURDRjE5NwA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	13	sucursal_1	f	2025-11-20 18:16:39.538341+00	\N
52	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 18:16:47.726488+00	\N
53	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_2	f	2025-11-20 18:17:37.440479+00	\N
54	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEkM0NzBCNzYyNjEzNjZCOEQ2MAA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	13	sucursal_1	f	2025-11-20 18:18:38.8321+00	\N
55	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 18:18:48.080227+00	\N
56	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEjJBNzVDNjU2QThEQ0E3NDU2QQA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 18:20:51.163456+00	\N
57	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_2	f	2025-11-20 18:20:58.231785+00	\N
58	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjI5MzYzRDZBNjg2NTU2MjA1QwA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	13	sucursal_1	f	2025-11-20 18:22:58.682849+00	\N
59	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEjY4MjhDQzAwNTU4QTE4NzYyNQA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 18:22:59.228908+00	\N
60	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 18:23:07.364631+00	\N
61	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_2	f	2025-11-20 18:23:16.371637+00	\N
62	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEjg3MjA2NThBNUUxMUEzMTRDNgA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 19:07:29.346302+00	\N
63	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEkYzMUU3NjdFOTIwQjI3QzcyMwA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 19:07:52.287997+00	\N
64	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEjQ4NjYzNDREMkEwRDgwQTQ0NwA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 19:07:56.998476+00	\N
65	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_2	f	2025-11-20 19:08:24.667801+00	\N
66	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEkE1MjYxMTg0OTYzRUJFNUQ4QgA=	outgoing	+5216867865454	[template:confirmacion_cita_dentalux_v2]	sent	13	sucursal_1	f	2025-11-20 19:12:14.165496+00	\N
67	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEjQ5QTNEMTU0RDNDM0M0Qzc5QQA=	outgoing	+5218135518575	[template:confirmacion_cita_dentalux_v2]	sent	12	sucursal_2	f	2025-11-20 19:12:14.763514+00	\N
68	\N	incoming	+5218135518575	CONFIRMAR	received	\N	sucursal_2	f	2025-11-20 19:12:34.846361+00	\N
69	\N	incoming	+5216867865454	CONFIRMAR	received	\N	sucursal_1	f	2025-11-20 19:12:58.384054+00	\N
70	wamid.HBgNNTIxODEzNTUxODU3NRUCABEYEjg0NjA4OUYwQ0FDRUQ5QjQ5NgA=	outgoing	8135518575	Hola Hector Navarrete, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	12	sucursal_2	f	2025-11-20 19:14:12.55722+00	\N
71	wamid.HBgNNTIxNjg2Nzg2NTQ1NBUCABEYEjYyOTE4QTA2NTI5RjQyM0IzMAA=	outgoing	6867865454	Hola Mario Versache, gracias por tu visita a la clínica dental. Del 1 al 5, ¿cómo calificarías tu experiencia de hoy? Responde solo con un número.	sent	13	sucursal_1	f	2025-11-20 19:15:05.693289+00	\N
72	\N	incoming	+5216867865454	4	received	\N	sucursal_1	f	2025-11-20 19:15:25.834243+00	\N
\.


--
-- Data for Name: whatsapp_rule_execs; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.whatsapp_rule_execs (id, rule_id, phone, sucursal_id, executed_at) FROM stdin;
1	bc6cc329720fbab693efadf8	+5216860000000	\N	2025-09-18 07:14:33.18622+00
2	bc6cc329720fbab693efadf8	+5216860000000	\N	2025-09-18 07:18:52.273454+00
3	bc6cc329720fbab693efadf8	+5216867865454	Sucursal_1	2025-09-18 07:22:36.537933+00
4	bc6cc329720fbab693efadf8	+5216860000000	\N	2025-09-18 07:25:21.242336+00
5	bc6cc329720fbab693efadf8	+5216867865454	Sucursal_1	2025-09-18 07:28:57.972975+00
6	3f24452a6768aa8e11ae999e	+5216860000000	\N	2025-09-18 07:40:28.251536+00
7	3f24452a6768aa8e11ae999e	+5216867865454	Sucursal_1	2025-09-18 07:40:56.545979+00
8	429637bb470247eefb3183e1	+5216867865454	Sucursal_1	2025-09-18 07:41:26.703968+00
9	3f24452a6768aa8e11ae999e	+5216860000000	\N	2025-09-18 07:53:19.724092+00
10	3f24452a6768aa8e11ae999e	+5216867865454	Sucursal_1	2025-09-18 07:55:39.240323+00
11	3f24452a6768aa8e11ae999e	+5216860000000	\N	2025-09-18 08:23:21.364015+00
12	3f24452a6768aa8e11ae999e	+5216867865454	Sucursal_1	2025-09-18 08:24:02.683167+00
13	af39649fec9e8fefbf0a9c06	+5216867865454	\N	2025-09-18 08:29:36.019176+00
14	af39649fec9e8fefbf0a9c06	+5216867865454	\N	2025-09-18 08:33:36.917934+00
15	eebdee1d4f581404f6f51296	+5216867865454	Sucursal_1	2025-09-18 08:35:32.107723+00
16	bc6cc329720fbab693efadf8	+5216867865454	Sucursal_1	2025-09-18 08:36:01.383474+00
17	429637bb470247eefb3183e1	+5216867865454	Sucursal_1	2025-09-18 08:36:11.605067+00
18	af39649fec9e8fefbf0a9c06	+5216867865454	\N	2025-09-18 08:48:01.456558+00
19	af39649fec9e8fefbf0a9c06	+5216867865454	\N	2025-09-18 08:50:44.065348+00
20	bc6cc329720fbab693efadf8	+5216860000000	\N	2025-09-18 08:58:39.040967+00
21	bc6cc329720fbab693efadf8	+5216867865454	\N	2025-09-18 08:59:27.715075+00
22	056d8f69b41ee309206b6d7a	+5216860000000	\N	2025-09-18 09:09:15.461915+00
23	056d8f69b41ee309206b6d7a	+5216867865454	Sucursal_1	2025-09-18 09:09:37.076015+00
24	056d8f69b41ee309206b6d7a	+5216867865454	Sucursal_1	2025-09-18 09:09:46.921172+00
25	056d8f69b41ee309206b6d7a	+5216867865454	Sucursal_1	2025-09-18 09:10:55.26733+00
26	b5cc4f5d284d76a954a16fc1	+5216867865454	Sucursal_1	2025-09-18 09:12:41.807073+00
27	b81f01d9a67cd188848139c3	+5216867865454	Sucursal_1	2025-09-18 09:12:56.534927+00
28	b5cc4f5d284d76a954a16fc1	+5216867865454	Sucursal_1	2025-09-18 09:13:53.563799+00
29	b81f01d9a67cd188848139c3	+5216867865454	Sucursal_1	2025-09-18 09:13:57.59857+00
30	b5cc4f5d284d76a954a16fc1	+5216867865454	Sucursal_1	2025-09-18 09:16:22.854089+00
31	b5cc4f5d284d76a954a16fc1	+5216867865454	Sucursal_1	2025-09-18 09:19:49.487277+00
32	b5cc4f5d284d76a954a16fc1	+5216867865454	Sucursal_1	2025-09-18 09:21:11.377836+00
33	bc6cc329720fbab693efadf8	+5216860000000	\N	2025-09-18 09:29:42.737794+00
34	eebdee1d4f581404f6f51296	+5216860000000	\N	2025-09-18 09:29:43.046671+00
35	bc6cc329720fbab693efadf8	+5216867865454	Sucursal_1	2025-09-18 09:29:59.852237+00
36	eebdee1d4f581404f6f51296	+5216867865454	Sucursal_1	2025-09-18 09:30:07.882092+00
37	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 09:30:22.173134+00
38	3227a1f0d7163a557608c6d3	+5216860000000	\N	2025-09-18 10:17:49.488972+00
39	eaa380a70e5e335197c98eda	+5216867865454	Sucursal_1	2025-09-18 10:18:11.872505+00
40	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 10:18:45.792725+00
41	eaa380a70e5e335197c98eda	+5216867865454	Sucursal_1	2025-09-18 10:34:10.224625+00
42	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 10:35:03.830871+00
43	eaa380a70e5e335197c98eda	+5216867865454	Sucursal_1	2025-09-18 10:46:12.468585+00
44	05941c8f3458b54371909133	+5216867865454	Sucursal_1	2025-09-18 11:20:43.159703+00
45	eaa380a70e5e335197c98eda	+5216867865454	Sucursal_1	2025-09-18 11:21:41.699695+00
46	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 11:22:00.784466+00
47	eaa380a70e5e335197c98eda	+5216867865454	Sucursal_1	2025-09-18 11:32:52.004485+00
48	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 11:33:09.991482+00
49	eebdee1d4f581404f6f51296	+5216867865454	Sucursal_1	2025-09-18 11:34:59.463273+00
50	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 11:35:06.470949+00
51	429637bb470247eefb3183e1	+5216867865454	Sucursal_1	2025-09-18 11:35:14.455411+00
52	05941c8f3458b54371909133	+5216867865454	Sucursal_1	2025-09-18 17:11:31.760492+00
53	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 17:11:48.589981+00
54	3227a1f0d7163a557608c6d3	+5216867865454	Sucursal_1	2025-09-18 17:51:25.080509+00
55	eaa380a70e5e335197c98eda	+5216867865454	Sucursal_1	2025-09-18 17:51:31.446107+00
56	eaa380a70e5e335197c98eda	+5216867865454	sucursal_1	2025-09-18 18:21:45.875044+00
57	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-18 19:20:03.389186+00
58	bc6cc329720fbab693efadf8	+5216867865454	sucursal_1	2025-09-18 19:24:34.770221+00
59	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-18 19:25:11.305281+00
60	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-18 19:27:33.975725+00
61	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-18 19:29:19.959393+00
62	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-18 20:27:36.301737+00
63	eaa380a70e5e335197c98eda	+5216867865454	sucursal_1	2025-09-18 20:27:54.024415+00
64	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-18 21:02:54.732316+00
65	3227a1f0d7163a557608c6d3	+5216863039716	sucursal_1	2025-09-18 22:20:19.550689+00
66	eebdee1d4f581404f6f51296	+5216863039716	sucursal_1	2025-09-18 22:20:27.212059+00
67	429637bb470247eefb3183e1	+5216863039716	sucursal_1	2025-09-18 22:20:36.484349+00
68	bc6cc329720fbab693efadf8	+5216863039716	sucursal_1	2025-09-18 22:20:53.174836+00
69	eaa380a70e5e335197c98eda	+5216863039716	sucursal_1	2025-09-18 22:21:31.061666+00
70	3227a1f0d7163a557608c6d3	+5216863039716	sucursal_1	2025-09-18 22:23:17.024408+00
71	3227a1f0d7163a557608c6d3	+5216863039716	sucursal_1	2025-09-18 22:26:49.3885+00
72	3227a1f0d7163a557608c6d3	+5215512345678	Sucursal_1	2025-09-22 06:29:24.869211+00
73	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-22 06:50:24.514307+00
74	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-22 07:05:39.175061+00
75	3227a1f0d7163a557608c6d3	+5216867865454	sucursal_1	2025-09-22 07:08:28.080219+00
76	429637bb470247eefb3183e1	+5216867865454	sucursal_1	2025-09-22 08:28:46.370015+00
77	429637bb470247eefb3183e1	+5216867865454	sucursal_1	2025-09-22 09:08:12.20716+00
78	eebdee1d4f581404f6f51296	+5216867865454	sucursal_1	2025-09-22 09:08:24.055759+00
\.


--
-- Data for Name: whatsapp_rules; Type: TABLE DATA; Schema: public; Owner: dentalux_db_user
--

COPY public.whatsapp_rules (id, name, active, priority, match, action, cooldown_secs, sucursal_id, created_at, updated_at) FROM stdin;
af39649fec9e8fefbf0a9c06	cita-hoy-recordatorio	f	8	{"all": [{"regex": ".*"}, {"has_appointment_today": true}, {"appointment_status_in": ["Pendiente"]}]}	{"body": "Te recuerdo tu cita de hoy. Si necesitas cambiarla, dime por aquí. 🙌", "type": "send_text"}	0	\N	2025-09-18 07:44:04.226618+00	2025-09-18 09:29:09.814532+00
b5cc4f5d284d76a954a16fc1	test-botones	f	3	{"any": [{"regex": ".*"}]}	{"body": "Prueba: ¿Confirmar o reprogramar?", "type": "send_buttons", "buttons": [{"id": "BTN_CONFIRMAR", "title": "Confirmar"}, {"id": "BTN_REPROGRAMAR", "title": "Reprogramar"}]}	60	\N	2025-09-18 08:47:30.467448+00	2025-09-18 09:45:40.269613+00
3f24452a6768aa8e11ae999e	fuera-horario	f	5	{"all": [{"regex": ".*"}, {"day_of_week": [1, 2, 3, 4, 5, 6, 7]}, {"hour_range": [21, 8]}]}	{"body": "Gracias por escribir. Atendemos de 9:00 a 20:00. Te respondemos al abrir.", "type": "send_text"}	600	\N	2025-09-18 07:31:42.88169+00	2025-09-18 08:28:01.533907+00
b81f01d9a67cd188848139c3	test-botones	f	3	{"any": [{"regex": ".*"}]}	{"body": "Prueba: ¿Confirmar o reprogramar?", "type": "send_buttons", "buttons": [{"id": "BTN_CONFIRMAR", "title": "Confirmar"}, {"id": "BTN_REPROGRAMAR", "title": "Reprogramar"}]}	60	\N	2025-09-18 08:48:46.149509+00	2025-09-18 09:45:40.5608+00
edf0491c3bf50d26bbba9efb	cita-manana-botones	t	6	{"all": [{"regex": ".*"}, {"has_appointment_in_days": 1}, {"appointment_status_in": ["Pendiente"]}]}	{"body": "Tienes una cita mañana. ¿Deseas confirmarla o reprogramarla?", "type": "send_buttons", "buttons": [{"id": "BTN_CONFIRMAR", "title": "Confirmar"}, {"id": "BTN_REPROGRAMAR", "title": "Reprogramar"}]}	7200	\N	2025-09-18 08:23:04.259055+00	2025-09-18 09:29:29.840822+00
05941c8f3458b54371909133	cita-hoy-recordatorio	t	8	{"all": [{"regex": ".*"}, {"has_appointment_today": true}, {"appointment_status_in": ["Pendiente"]}]}	{"body": "Te recuerdo tu cita de hoy. Si necesitas cambiarla, dime por aquí. 🙌", "type": "send_text"}	3600	\N	2025-09-18 07:47:54.436362+00	2025-09-18 09:29:29.840822+00
bc6cc329720fbab693efadf8	faq-precios	t	10	{"any": [{"text_contains": ["precio", "precios", "costo", "costos"]}, {"regex": "precios?"}]}	{"body": "Aquí están nuestros precios 👇 https://tu-sitio/precios", "type": "send_text"}	300	\N	2025-09-18 07:14:15.407642+00	2025-09-18 09:29:29.840822+00
056d8f69b41ee309206b6d7a	diag-alive	f	1	{"any": [{"regex": ".*"}]}	{"body": "✅ Motor vivo (diag). Escribe: precios / ubicación / horarios", "type": "send_text"}	0	\N	2025-09-18 09:00:33.782185+00	2025-09-18 09:12:34.818672+00
eebdee1d4f581404f6f51296	faq-ubicacion	t	11	{"any": [{"text_contains": ["ubicación", "ubicacion", "direccion", "dirección", "dónde están", "donde estan", "mapa"]}]}	{"body": "Estamos aquí: https://www.google.com.mx/maps/place/Consultorio+Dentalux+Victoria/@32.6002833,-115.345926,21z/data=!4m6!3m5!1s0x80d775df2742e6d9:0xc759ecd9a92fce2c!8m2!3d32.6002858!4d-115.345992!16s%2Fg%2F11xfgb5rd4?entry=ttu&g_ep=EgoyMDI1MDkxNS4wIKXMDSoASAFQAw%3D%3D", "type": "send_text"}	300	\N	2025-09-18 07:35:03.006941+00	2025-09-18 09:29:29.840822+00
429637bb470247eefb3183e1	faq-horarios	t	12	{"any": [{"text_contains": ["horario", "horarios", "abren", "cierran", "abierto", "cerrado"]}]}	{"body": "Nuestro horario: L–V 8:30–20:00. S 8:30–02:00.  Domingos cerrado.", "type": "send_text"}	300	\N	2025-09-18 07:37:04.970139+00	2025-09-18 09:29:29.840822+00
3227a1f0d7163a557608c6d3	fallback-menu	f	999	{"any": [{"regex": ".*"}]}	{"body": "¿En qué te ayudo?\\\\n• Precios\\\\n• Ubicación\\\\n• Horarios\\\\n• Agendar", "type": "send_text"}	60	\N	2025-09-18 07:31:21.597778+00	2025-09-22 07:37:48.182192+00
eaa380a70e5e335197c98eda	intent-agendar-botones	f	9	{"any": [{"text_contains": ["agendar", "agenda", "cita", "citas", "reservar", "reservacion", "reservación", "agéndame", "agendame", "quiero cita"]}, {"regex": "\\\\\\\\bagenda(r|rme)?\\\\\\\\b|\\\\\\\\bcita(s)?\\\\\\\\b|\\\\\\\\breserv(ar|a)\\\\\\\\b"}]}	{"body": "¿Para cuándo quieres agendar?", "type": "send_buttons", "buttons": [{"id": "AGENDAR_HOY", "title": "Hoy"}, {"id": "AGENDAR_MANANA", "title": "Mañana"}, {"id": "AGENDAR_ASESOR", "title": "Hablar con asesor"}]}	180	\N	2025-09-18 09:33:15.892221+00	2025-09-22 07:37:48.592816+00
\.


--
-- Name: alertas_inventario_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.alertas_inventario_id_seq', 1, false);


--
-- Name: app_state_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.app_state_id_seq', 1, false);


--
-- Name: appointments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.appointments_id_seq', 13, true);


--
-- Name: consentimientos_informados_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.consentimientos_informados_id_seq', 1, true);


--
-- Name: doctors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.doctors_id_seq', 38, true);


--
-- Name: documentos_radiografias_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.documentos_radiografias_id_seq', 1, false);


--
-- Name: expedientes_medicos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.expedientes_medicos_id_seq', 4, true);


--
-- Name: expenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.expenses_id_seq', 84, true);


--
-- Name: factura_conceptos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.factura_conceptos_id_seq', 132, true);


--
-- Name: historia_clinica_dental_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.historia_clinica_dental_id_seq', 1, true);


--
-- Name: inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.inventory_id_seq', 15, true);


--
-- Name: objetivos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.objetivos_id_seq', 114, true);


--
-- Name: odontograma_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.odontograma_id_seq', 3, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.payments_id_seq', 6, true);


--
-- Name: satisfaccion_servicio_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.satisfaccion_servicio_id_seq', 13, true);


--
-- Name: services_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.services_id_seq', 49, true);


--
-- Name: tratamientos_dentales_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.tratamientos_dentales_id_seq', 1, true);


--
-- Name: whatsapp_faqs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.whatsapp_faqs_id_seq', 21, true);


--
-- Name: whatsapp_messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.whatsapp_messages_id_seq', 72, true);


--
-- Name: whatsapp_rule_execs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: dentalux_db_user
--

SELECT pg_catalog.setval('public.whatsapp_rule_execs_id_seq', 78, true);


--
-- Name: Doctor Doctor_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public."Doctor"
    ADD CONSTRAINT "Doctor_pkey" PRIMARY KEY (id);


--
-- Name: Payment Payment_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_pkey" PRIMARY KEY (id);


--
-- Name: User User_email_key; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_email_key" UNIQUE (email);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: alertas_inventario alertas_inventario_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.alertas_inventario
    ADD CONSTRAINT alertas_inventario_pkey PRIMARY KEY (id);


--
-- Name: app_state app_state_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.app_state
    ADD CONSTRAINT app_state_pkey PRIMARY KEY (id);


--
-- Name: app_state app_state_user_id_key; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.app_state
    ADD CONSTRAINT app_state_user_id_key UNIQUE (user_id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id);


--
-- Name: configuracion_sat configuracion_sat_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.configuracion_sat
    ADD CONSTRAINT configuracion_sat_pkey PRIMARY KEY (id);


--
-- Name: configuracion_sat configuracion_sat_sucursal_id_key; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.configuracion_sat
    ADD CONSTRAINT configuracion_sat_sucursal_id_key UNIQUE (sucursal_id);


--
-- Name: consentimientos_informados consentimientos_informados_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.consentimientos_informados
    ADD CONSTRAINT consentimientos_informados_pkey PRIMARY KEY (id);


--
-- Name: doctors doctors_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.doctors
    ADD CONSTRAINT doctors_pkey PRIMARY KEY (id);


--
-- Name: documentos_radiografias documentos_radiografias_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.documentos_radiografias
    ADD CONSTRAINT documentos_radiografias_pkey PRIMARY KEY (id);


--
-- Name: expedientes_medicos expedientes_medicos_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.expedientes_medicos
    ADD CONSTRAINT expedientes_medicos_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: factura_conceptos factura_conceptos_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.factura_conceptos
    ADD CONSTRAINT factura_conceptos_pkey PRIMARY KEY (id);


--
-- Name: facturacion_clientes facturacion_clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.facturacion_clientes
    ADD CONSTRAINT facturacion_clientes_pkey PRIMARY KEY (id);


--
-- Name: facturacion_configuracion facturacion_configuracion_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.facturacion_configuracion
    ADD CONSTRAINT facturacion_configuracion_pkey PRIMARY KEY (sucursal_id);


--
-- Name: facturacion_productos facturacion_productos_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.facturacion_productos
    ADD CONSTRAINT facturacion_productos_pkey PRIMARY KEY (id);


--
-- Name: facturas facturas_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_pkey PRIMARY KEY (id);


--
-- Name: historia_clinica_dental historia_clinica_dental_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.historia_clinica_dental
    ADD CONSTRAINT historia_clinica_dental_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_sku_key; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_sku_key UNIQUE (sku);


--
-- Name: lab_abonos lab_abonos_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.lab_abonos
    ADD CONSTRAINT lab_abonos_pkey PRIMARY KEY (id);


--
-- Name: lab_trabajos lab_trabajos_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.lab_trabajos
    ADD CONSTRAINT lab_trabajos_pkey PRIMARY KEY (id);


--
-- Name: laboratorios laboratorios_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.laboratorios
    ADD CONSTRAINT laboratorios_pkey PRIMARY KEY (id);


--
-- Name: objetivos objetivos_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.objetivos
    ADD CONSTRAINT objetivos_pkey PRIMARY KEY (id);


--
-- Name: odontograma odontograma_expediente_id_diente_numero_key; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.odontograma
    ADD CONSTRAINT odontograma_expediente_id_diente_numero_key UNIQUE (expediente_id, diente_numero);


--
-- Name: odontograma odontograma_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.odontograma
    ADD CONSTRAINT odontograma_pkey PRIMARY KEY (id);


--
-- Name: pagos_laboratorio pagos_laboratorio_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.pagos_laboratorio
    ADD CONSTRAINT pagos_laboratorio_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: productos_sat productos_sat_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.productos_sat
    ADD CONSTRAINT productos_sat_pkey PRIMARY KEY (id);


--
-- Name: satisfaccion_servicio satisfaccion_servicio_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.satisfaccion_servicio
    ADD CONSTRAINT satisfaccion_servicio_pkey PRIMARY KEY (id);


--
-- Name: services services_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.services
    ADD CONSTRAINT services_pkey PRIMARY KEY (id);


--
-- Name: sucursales sucursales_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.sucursales
    ADD CONSTRAINT sucursales_pkey PRIMARY KEY (id);


--
-- Name: tratamientos_dentales tratamientos_dentales_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.tratamientos_dentales
    ADD CONSTRAINT tratamientos_dentales_pkey PRIMARY KEY (id);


--
-- Name: wa_processed wa_processed_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.wa_processed
    ADD CONSTRAINT wa_processed_pkey PRIMARY KEY (wamid);


--
-- Name: whatsapp_faqs whatsapp_faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_faqs
    ADD CONSTRAINT whatsapp_faqs_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_faqs whatsapp_faqs_slug_key; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_faqs
    ADD CONSTRAINT whatsapp_faqs_slug_key UNIQUE (slug);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_rule_execs whatsapp_rule_execs_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_rule_execs
    ADD CONSTRAINT whatsapp_rule_execs_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_rules whatsapp_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_rules
    ADD CONSTRAINT whatsapp_rules_pkey PRIMARY KEY (id);


--
-- Name: idx_alertas_prioridad; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_alertas_prioridad ON public.alertas_inventario USING btree (prioridad);


--
-- Name: idx_alertas_resuelta; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_alertas_resuelta ON public.alertas_inventario USING btree (resuelta);


--
-- Name: idx_alertas_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_alertas_sucursal ON public.alertas_inventario USING btree (sucursal_id);


--
-- Name: idx_alertas_tipo; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_alertas_tipo ON public.alertas_inventario USING btree (tipo);


--
-- Name: idx_appointments_date_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_appointments_date_sucursal ON public.appointments USING btree (date, sucursal_id);


--
-- Name: idx_appointments_doctor; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_appointments_doctor ON public.appointments USING btree (doctor_id);


--
-- Name: idx_appointments_patient; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_appointments_patient ON public.appointments USING btree (lower((patient)::text));


--
-- Name: idx_appointments_service; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_appointments_service ON public.appointments USING btree (service_id);


--
-- Name: idx_appointments_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_appointments_sucursal ON public.appointments USING btree (sucursal_id);


--
-- Name: idx_appointments_sucursal_date; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_appointments_sucursal_date ON public.appointments USING btree (sucursal_id, date);


--
-- Name: idx_clientes_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_clientes_sucursal ON public.clientes USING btree (sucursal_id);


--
-- Name: idx_consentimientos_expediente; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_consentimientos_expediente ON public.consentimientos_informados USING btree (expediente_id, fecha_consentimiento DESC);


--
-- Name: idx_doctors_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_doctors_sucursal ON public.doctors USING btree (sucursal_id);


--
-- Name: idx_documentos_expediente; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_documentos_expediente ON public.documentos_radiografias USING btree (expediente_id, fecha_toma DESC);


--
-- Name: idx_expedientes_nombre; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_expedientes_nombre ON public.expedientes_medicos USING btree (lower(nombre_paciente), sucursal_id);


--
-- Name: idx_expedientes_paciente; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_expedientes_paciente ON public.expedientes_medicos USING btree (paciente_id, sucursal_id);


--
-- Name: idx_expenses_date_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_expenses_date_sucursal ON public.expenses USING btree (date, sucursal_id);


--
-- Name: idx_expenses_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_expenses_sucursal ON public.expenses USING btree (sucursal_id);


--
-- Name: idx_expenses_sucursal_date; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_expenses_sucursal_date ON public.expenses USING btree (sucursal_id, date);


--
-- Name: idx_fact_cli_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_fact_cli_sucursal ON public.facturacion_clientes USING btree (sucursal_id);


--
-- Name: idx_fact_prod_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_fact_prod_sucursal ON public.facturacion_productos USING btree (sucursal_id);


--
-- Name: idx_factura_conceptos_factura; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_factura_conceptos_factura ON public.factura_conceptos USING btree (factura_id);


--
-- Name: idx_facturas_estado; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_facturas_estado ON public.facturas USING btree (estado);


--
-- Name: idx_facturas_fecha; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_facturas_fecha ON public.facturas USING btree (fecha);


--
-- Name: idx_facturas_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_facturas_sucursal ON public.facturas USING btree (sucursal_id);


--
-- Name: idx_faqs_active_priority; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_faqs_active_priority ON public.whatsapp_faqs USING btree (active DESC, priority, id);


--
-- Name: idx_faqs_patterns; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_faqs_patterns ON public.whatsapp_faqs USING gin (patterns);


--
-- Name: idx_faqs_slug; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_faqs_slug ON public.whatsapp_faqs USING btree (slug);


--
-- Name: idx_historia_expediente; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_historia_expediente ON public.historia_clinica_dental USING btree (expediente_id);


--
-- Name: idx_inventory_category; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_inventory_category ON public.inventory USING btree (category);


--
-- Name: idx_inventory_expiration; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_inventory_expiration ON public.inventory USING btree (expiration_date);


--
-- Name: idx_inventory_sku; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_inventory_sku ON public.inventory USING btree (sku);


--
-- Name: idx_inventory_stock; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_inventory_stock ON public.inventory USING btree (stock);


--
-- Name: idx_inventory_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_inventory_sucursal ON public.inventory USING btree (sucursal_id);


--
-- Name: idx_inventory_type; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_inventory_type ON public.inventory USING btree (type);


--
-- Name: idx_lab_abonos_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_lab_abonos_sucursal ON public.lab_abonos USING btree (sucursal_id);


--
-- Name: idx_lab_abonos_trabajo; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_lab_abonos_trabajo ON public.lab_abonos USING btree (trabajo_id);


--
-- Name: idx_lab_trabajos_lab; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_lab_trabajos_lab ON public.lab_trabajos USING btree (laboratorio_id);


--
-- Name: idx_lab_trabajos_serv; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_lab_trabajos_serv ON public.lab_trabajos USING btree (servicio_id);


--
-- Name: idx_lab_trabajos_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_lab_trabajos_sucursal ON public.lab_trabajos USING btree (sucursal_id);


--
-- Name: idx_laboratorios_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_laboratorios_sucursal ON public.laboratorios USING btree (sucursal_id);


--
-- Name: idx_objetivos_doctor; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_objetivos_doctor ON public.objetivos USING btree (doctor_id);


--
-- Name: idx_objetivos_periodo; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_objetivos_periodo ON public.objetivos USING btree (periodo_inicio, periodo_fin);


--
-- Name: idx_objetivos_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_objetivos_sucursal ON public.objetivos USING btree (sucursal_id);


--
-- Name: idx_odontograma_expediente; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_odontograma_expediente ON public.odontograma USING btree (expediente_id, diente_numero);


--
-- Name: idx_pagos_laboratorio_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_pagos_laboratorio_sucursal ON public.pagos_laboratorio USING btree (sucursal_id);


--
-- Name: idx_pagos_laboratorio_trabajo; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_pagos_laboratorio_trabajo ON public.pagos_laboratorio USING btree (trabajo_id);


--
-- Name: idx_payments_appointment; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_payments_appointment ON public.payments USING btree (appointment_id);


--
-- Name: idx_payments_date_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_payments_date_sucursal ON public.payments USING btree (date, sucursal_id);


--
-- Name: idx_payments_doctor; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_payments_doctor ON public.payments USING btree (doctor_id);


--
-- Name: idx_payments_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_payments_sucursal ON public.payments USING btree (sucursal_id);


--
-- Name: idx_payments_sucursal_date; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_payments_sucursal_date ON public.payments USING btree (sucursal_id, date);


--
-- Name: idx_productos_sat_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_productos_sat_sucursal ON public.productos_sat USING btree (sucursal_id);


--
-- Name: idx_satisfaccion_created; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_satisfaccion_created ON public.satisfaccion_servicio USING btree (created_at DESC);


--
-- Name: idx_satisfaccion_service; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_satisfaccion_service ON public.satisfaccion_servicio USING btree (service_id);


--
-- Name: idx_satisfaccion_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_satisfaccion_sucursal ON public.satisfaccion_servicio USING btree (sucursal_id);


--
-- Name: idx_services_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_services_sucursal ON public.services USING btree (sucursal_id);


--
-- Name: idx_tratamientos_expediente; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_tratamientos_expediente ON public.tratamientos_dentales USING btree (expediente_id, fecha DESC);


--
-- Name: idx_wa_messages_phone_created; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_wa_messages_phone_created ON public.whatsapp_messages USING btree (phone, created_at DESC);


--
-- Name: idx_wa_msgs_created; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_wa_msgs_created ON public.whatsapp_messages USING btree (created_at DESC);


--
-- Name: idx_wa_msgs_phone; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_wa_msgs_phone ON public.whatsapp_messages USING btree (phone);


--
-- Name: idx_wa_msgs_sucursal; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_wa_msgs_sucursal ON public.whatsapp_messages USING btree (sucursal_id);


--
-- Name: idx_wa_rule_execs_recent; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_wa_rule_execs_recent ON public.whatsapp_rule_execs USING btree (executed_at DESC);


--
-- Name: idx_wa_rule_execs_rule_phone; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_wa_rule_execs_rule_phone ON public.whatsapp_rule_execs USING btree (rule_id, phone);


--
-- Name: idx_wa_rules_active; Type: INDEX; Schema: public; Owner: dentalux_db_user
--

CREATE INDEX idx_wa_rules_active ON public.whatsapp_rules USING btree (active, priority);


--
-- Name: inventory inventory_alerts_trigger; Type: TRIGGER; Schema: public; Owner: dentalux_db_user
--

CREATE TRIGGER inventory_alerts_trigger AFTER UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.check_inventory_alerts();


--
-- Name: whatsapp_faqs trg_faqs_updated_at; Type: TRIGGER; Schema: public; Owner: dentalux_db_user
--

CREATE TRIGGER trg_faqs_updated_at BEFORE UPDATE ON public.whatsapp_faqs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: Payment Payment_doctorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public."Payment"
    ADD CONSTRAINT "Payment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES public."Doctor"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: alertas_inventario alertas_inventario_producto_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.alertas_inventario
    ADD CONSTRAINT alertas_inventario_producto_id_fkey FOREIGN KEY (producto_id) REFERENCES public.inventory(id);


--
-- Name: appointments appointments_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: appointments appointments_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: consentimientos_informados consentimientos_informados_expediente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.consentimientos_informados
    ADD CONSTRAINT consentimientos_informados_expediente_id_fkey FOREIGN KEY (expediente_id) REFERENCES public.expedientes_medicos(id) ON DELETE CASCADE;


--
-- Name: documentos_radiografias documentos_radiografias_expediente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.documentos_radiografias
    ADD CONSTRAINT documentos_radiografias_expediente_id_fkey FOREIGN KEY (expediente_id) REFERENCES public.expedientes_medicos(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: factura_conceptos factura_conceptos_factura_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.factura_conceptos
    ADD CONSTRAINT factura_conceptos_factura_id_fkey FOREIGN KEY (factura_id) REFERENCES public.facturas(id) ON DELETE CASCADE;


--
-- Name: facturas facturas_receptor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.facturas
    ADD CONSTRAINT facturas_receptor_id_fkey FOREIGN KEY (receptor_id) REFERENCES public.clientes(id);


--
-- Name: historia_clinica_dental historia_clinica_dental_expediente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.historia_clinica_dental
    ADD CONSTRAINT historia_clinica_dental_expediente_id_fkey FOREIGN KEY (expediente_id) REFERENCES public.expedientes_medicos(id) ON DELETE CASCADE;


--
-- Name: lab_abonos lab_abonos_trabajo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.lab_abonos
    ADD CONSTRAINT lab_abonos_trabajo_id_fkey FOREIGN KEY (trabajo_id) REFERENCES public.lab_trabajos(id) ON DELETE CASCADE;


--
-- Name: lab_trabajos lab_trabajos_laboratorio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.lab_trabajos
    ADD CONSTRAINT lab_trabajos_laboratorio_id_fkey FOREIGN KEY (laboratorio_id) REFERENCES public.laboratorios(id) ON DELETE CASCADE;


--
-- Name: odontograma odontograma_expediente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.odontograma
    ADD CONSTRAINT odontograma_expediente_id_fkey FOREIGN KEY (expediente_id) REFERENCES public.expedientes_medicos(id) ON DELETE CASCADE;


--
-- Name: payments payments_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id);


--
-- Name: payments payments_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: payments payments_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: satisfaccion_servicio satisfaccion_servicio_appointment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.satisfaccion_servicio
    ADD CONSTRAINT satisfaccion_servicio_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id) ON DELETE CASCADE;


--
-- Name: satisfaccion_servicio satisfaccion_servicio_doctor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.satisfaccion_servicio
    ADD CONSTRAINT satisfaccion_servicio_doctor_id_fkey FOREIGN KEY (doctor_id) REFERENCES public.doctors(id);


--
-- Name: satisfaccion_servicio satisfaccion_servicio_patient_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.satisfaccion_servicio
    ADD CONSTRAINT satisfaccion_servicio_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES public.clientes(id);


--
-- Name: satisfaccion_servicio satisfaccion_servicio_service_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.satisfaccion_servicio
    ADD CONSTRAINT satisfaccion_servicio_service_id_fkey FOREIGN KEY (service_id) REFERENCES public.services(id);


--
-- Name: tratamientos_dentales tratamientos_dentales_expediente_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.tratamientos_dentales
    ADD CONSTRAINT tratamientos_dentales_expediente_id_fkey FOREIGN KEY (expediente_id) REFERENCES public.expedientes_medicos(id) ON DELETE CASCADE;


--
-- Name: whatsapp_rule_execs whatsapp_rule_execs_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: dentalux_db_user
--

ALTER TABLE ONLY public.whatsapp_rule_execs
    ADD CONSTRAINT whatsapp_rule_execs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.whatsapp_rules(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict OG0seKVXFRamNXgvIGqrJS2jf2YqPzK8sDEJccrnxdMfK5UXmcoawnbJlMSK1ZW

