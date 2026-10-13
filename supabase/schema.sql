-- ==============================================================================
-- DATABASE SCHEMA: MCDONALD'S PWA MAINTENANCE & INVENTORY
-- Engine: PostgreSQL 15+ (Supabase)
-- ==============================================================================

-- 1. EXTENSIONS
-- Nota: PostgreSQL 13+ incluye gen_random_uuid() de forma nativa en pg_catalog.
-- No se requieren extensiones externas (uuid-ossp o pgcrypto) en el esquema public.

-- 2. ENUMS & TYPES
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('technician', 'coordinator', 'admin');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE user_status AS ENUM ('pending', 'approved', 'rejected', 'inactive');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_type') THEN
        CREATE TYPE stock_movement_type AS ENUM ('initial_load', 'add', 'consume', 'adjustment');
    ELSE
        BEGIN
            ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'initial_load';
            ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'add';
            ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'consume';
            ALTER TYPE stock_movement_type ADD VALUE IF NOT EXISTS 'adjustment';
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;
    END IF;
END $$;

-- 3. TABLES

-- Stores (Locales de McDonald's con datos técnicos de medidor)
CREATE TABLE IF NOT EXISTS public.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) UNIQUE NOT NULL CHECK (code = UPPER(code)),
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    meter_model TEXT,
    display_indicator TEXT,
    meter_multiplier NUMERIC(10, 4) CHECK (meter_multiplier IS NULL OR meter_multiplier > 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Profiles (Extensión de auth.users con rol, estado y auditoría)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(120),
    role user_role DEFAULT NULL,
    default_store_id UUID REFERENCES public.stores(id) ON DELETE SET NULL,
    status user_status DEFAULT 'pending' NOT NULL,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    approved_at TIMESTAMPTZ,
    previous_role user_role DEFAULT NULL,
    role_expires_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- User Stores (Asignaciones de técnicos a locales: permanente o temporal)
CREATE TABLE IF NOT EXISTS public.user_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT NOT NULL,
    starts_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    ends_at TIMESTAMPTZ DEFAULT NULL,
    assigned_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    ended_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_user_stores_dates CHECK (ends_at IS NULL OR ends_at > starts_at)
);

-- Role Change History (Auditoría de cambios de rol y vencimientos)
CREATE TABLE IF NOT EXISTS public.role_change_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    changed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    old_role user_role,
    new_role user_role NOT NULL,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- User Status History (Auditoría append-only de modificaciones de estado)
CREATE TABLE IF NOT EXISTS public.user_status_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    changed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    old_status user_status NOT NULL,
    new_status user_status NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Invitations (Tokens de invitación con hash para registro cerrado)
CREATE TABLE IF NOT EXISTS public.invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_hash VARCHAR(255) UNIQUE NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_used BOOLEAN DEFAULT false NOT NULL,
    used_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Part Categories (Categorías dinámicas de repuestos)
CREATE TABLE IF NOT EXISTS public.part_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Spare Parts (Catálogo Maestro Unificado de Repuestos)
CREATE TABLE IF NOT EXISTS public.spare_parts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(150) NOT NULL,
    category_id UUID REFERENCES public.part_categories(id) ON DELETE RESTRICT NOT NULL,
    unit VARCHAR(20) DEFAULT 'unit' NOT NULL CHECK (unit IN ('unit', 'liter')),
    compatibility_notes TEXT,
    minimum_critical_stock NUMERIC(10, 2) DEFAULT 0 NOT NULL CHECK (minimum_critical_stock >= 0),
    is_active BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Part Equivalencies (Sustitutos directos entre repuestos)
CREATE TABLE IF NOT EXISTS public.part_equivalencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part_id UUID REFERENCES public.spare_parts(id) ON DELETE CASCADE NOT NULL,
    equivalent_part_id UUID REFERENCES public.spare_parts(id) ON DELETE CASCADE NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CHECK (part_id <> equivalent_part_id),
    UNIQUE (part_id, equivalent_part_id)
);

-- Meter Readings (Lecturas diarias del medidor eléctrico por local)
CREATE TABLE IF NOT EXISTS public.meter_readings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT NOT NULL,
    reading_date DATE NOT NULL,
    display_value NUMERIC(14, 3) NOT NULL CHECK (display_value >= 0),
    applied_multiplier NUMERIC(10, 4) CHECK (applied_multiplier IS NULL OR applied_multiplier > 0),
    kwh_reading NUMERIC(16, 3) CHECK (kwh_reading IS NULL OR kwh_reading >= 0),
    is_reset BOOLEAN DEFAULT false NOT NULL,
    recorded_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    recalculated_at TIMESTAMPTZ,
    recalculated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    calculated_consumption NUMERIC(14, 3) CHECK (calculated_consumption IS NULL OR calculated_consumption >= 0),
    reading_days INT DEFAULT 1 NOT NULL CHECK (reading_days >= 1),
    is_estimated BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_meter_readings_store_date UNIQUE (store_id, reading_date)
);

-- Meter Reading Edits (Auditoría append-only de modificaciones de lecturas del día)
CREATE TABLE IF NOT EXISTS public.meter_reading_edits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reading_id UUID REFERENCES public.meter_readings(id) ON DELETE RESTRICT NOT NULL,
    edited_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    previous_display_value NUMERIC(14, 3) NOT NULL,
    new_display_value NUMERIC(14, 3) NOT NULL,
    previous_kwh_reading NUMERIC(16, 3),
    new_kwh_reading NUMERIC(16, 3),
    previous_is_reset BOOLEAN NOT NULL,
    new_is_reset BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Store Inventory (Stock distribuido por local)
CREATE TABLE IF NOT EXISTS public.store_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT NOT NULL,
    part_id UUID REFERENCES public.spare_parts(id) ON DELETE CASCADE NOT NULL,
    quantity NUMERIC(12, 2) DEFAULT 0 NOT NULL CHECK (quantity >= 0),
    shelf_location VARCHAR(80),
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (store_id, part_id)
);

-- Stock Movements (Auditoría append-only de movimientos de stock)
CREATE TABLE IF NOT EXISTS public.stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT NOT NULL,
    part_id UUID REFERENCES public.spare_parts(id) ON DELETE RESTRICT NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    movement_type stock_movement_type NOT NULL,
    variation NUMERIC(12, 2) NOT NULL,
    quantity_before NUMERIC(12, 2) NOT NULL CHECK (quantity_before >= 0),
    quantity_after NUMERIC(12, 2) NOT NULL CHECK (quantity_after >= 0),
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Stock Requests (Peticiones de repuestos públicas para todos los locales)
CREATE TABLE IF NOT EXISTS public.stock_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT NOT NULL,
    requester_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    part_id UUID REFERENCES public.spare_parts(id) ON DELETE RESTRICT DEFAULT NULL,
    other_description TEXT DEFAULT NULL,
    quantity NUMERIC(12, 2) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    notes TEXT DEFAULT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT DEFAULT NULL,
    closed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_stock_requests_part_or_desc CHECK (
        (part_id IS NOT NULL) OR 
        (other_description IS NOT NULL AND TRIM(other_description) <> '')
    )
);

-- Stock Request Views (Registro individual de peticiones ya vistas por cada usuario)
CREATE TABLE IF NOT EXISTS public.stock_request_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES public.stock_requests(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    seen_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_stock_request_views UNIQUE (request_id, user_id)
);

-- Announcements (Mensajes unidireccionales de coordinación)
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT NOT NULL,
    title TEXT DEFAULT NULL,
    body TEXT NOT NULL CHECK (char_length(body) <= 1000 AND char_length(TRIM(body)) > 0),
    target_type VARCHAR(20) NOT NULL CHECK (target_type IN ('all', 'store', 'user')),
    target_store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT DEFAULT NULL,
    target_user_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    archived_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT chk_announcements_target_consistency CHECK (
        (target_type = 'all' AND target_store_id IS NULL AND target_user_id IS NULL) OR
        (target_type = 'store' AND target_store_id IS NOT NULL AND target_user_id IS NULL) OR
        (target_type = 'user' AND target_user_id IS NOT NULL AND target_store_id IS NULL)
    )
);

-- Announcement Reads (Marca de lectura de mensajes)
CREATE TABLE IF NOT EXISTS public.announcement_reads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    announcement_id UUID REFERENCES public.announcements(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    read_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_announcement_reads UNIQUE (announcement_id, user_id)
);

-- Store Monthly Targets (Objetivos mensuales por local)
CREATE TABLE IF NOT EXISTS public.store_monthly_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES public.stores(id) ON DELETE RESTRICT NOT NULL,
    year INT NOT NULL CHECK (year >= 2020 AND year <= 2100),
    month INT NOT NULL CHECK (month >= 1 AND month <= 12),
    base_kwh NUMERIC(12, 2) NOT NULL CHECK (base_kwh >= 0),
    reduction_percentage NUMERIC(5, 2) DEFAULT 3.00 NOT NULL CHECK (reduction_percentage >= 0 AND reduction_percentage <= 100),
    month_days INT NOT NULL CHECK (month_days BETWEEN 28 AND 31),
    daily_target_kwh NUMERIC(12, 3) NOT NULL CHECK (daily_target_kwh >= 0),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_store_monthly_targets UNIQUE (store_id, year, month)
);

-- App Config (Configuración general de parámetros clave-valor)
CREATE TABLE IF NOT EXISTS public.app_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT
);

-- 4. HELPER & SECURITY FUNCTIONS

-- Helper: Obtener rol efectivo del usuario autenticado (considera expiración temporal)
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS user_role AS $$
    SELECT 
        CASE 
            WHEN role_expires_at IS NOT NULL AND role_expires_at <= NOW() THEN COALESCE(previous_role, 'technician'::user_role)
            ELSE role
        END
    FROM public.profiles
    WHERE id = auth.uid() AND status = 'approved';
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- Helper: Verificar si el usuario autenticado está aprobado
CREATE OR REPLACE FUNCTION public.is_user_approved()
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND status = 'approved'
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- Helper: Obtener fecha actual en Buenos Aires
CREATE OR REPLACE FUNCTION public.get_buenos_aires_date()
RETURNS DATE AS $$
    SELECT (TIMEZONE('America/Argentina/Buenos_Aires', NOW()))::DATE;
$$ LANGUAGE sql STABLE SET search_path = public, pg_temp;

-- Helper: Verificar acceso activo de un usuario específico a un local
CREATE OR REPLACE FUNCTION public.user_has_store_access(p_user_id UUID, p_store_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    v_role user_role;
    v_status user_status;
    v_has_access BOOLEAN;
BEGIN
    IF p_user_id IS NULL OR p_store_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT 
        status,
        CASE 
            WHEN role_expires_at IS NOT NULL AND role_expires_at <= NOW() THEN COALESCE(previous_role, 'technician'::user_role)
            ELSE role
        END
    INTO v_status, v_role
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_status IS DISTINCT FROM 'approved' THEN
        RETURN FALSE;
    END IF;

    IF v_role IS NOT DISTINCT FROM 'admin' OR v_role IS NOT DISTINCT FROM 'coordinator' THEN
        RETURN TRUE;
    END IF;

    IF v_role IS NOT DISTINCT FROM 'technician' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.user_stores
            WHERE user_id = p_user_id
              AND store_id = p_store_id
              AND starts_at <= NOW()
              AND (ends_at IS NULL OR ends_at > NOW())
        ) INTO v_has_access;
        RETURN COALESCE(v_has_access, FALSE);
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- Helper: Verificar acceso activo del usuario autenticado a un local
CREATE OR REPLACE FUNCTION public.user_has_store_access(p_store_id UUID)
RETURNS BOOLEAN AS $$
    SELECT COALESCE(public.user_has_store_access(auth.uid(), p_store_id), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp;

-- Helper interno: Calcular locales con lectura pendiente para un usuario en fecha/hora dada
CREATE OR REPLACE FUNCTION public.get_pending_readings_for(
    p_user_id UUID,
    p_now TIMESTAMPTZ
)
RETURNS TABLE (
    store_id UUID,
    code VARCHAR(10),
    name VARCHAR(100)
) AS $$
DECLARE
    v_bsas_time TIME;
    v_bsas_date DATE;
    v_user_role user_role;
    v_user_status user_status;
BEGIN
    IF p_user_id IS NULL OR p_now IS NULL THEN
        RETURN;
    END IF;

    v_bsas_time := (TIMEZONE('America/Argentina/Buenos_Aires', p_now))::TIME;
    v_bsas_date := (TIMEZONE('America/Argentina/Buenos_Aires', p_now))::DATE;

    -- Solo si la hora en Buenos Aires es >= 12:00
    IF v_bsas_time < TIME '12:00:00' THEN
        RETURN;
    END IF;

    SELECT 
        status,
        CASE 
            WHEN role_expires_at IS NOT NULL AND role_expires_at <= p_now THEN COALESCE(previous_role, 'technician'::user_role)
            ELSE role
        END
    INTO v_user_status, v_user_role
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_user_status IS DISTINCT FROM 'approved' THEN
        RETURN;
    END IF;

    IF v_user_role IS NOT DISTINCT FROM 'admin' OR v_user_role IS NOT DISTINCT FROM 'coordinator' THEN
        RETURN QUERY
        SELECT s.id, s.code, s.name
        FROM public.stores s
        WHERE s.is_active = true
          AND NOT EXISTS (
              SELECT 1 FROM public.meter_readings mr
              WHERE mr.store_id = s.id
                AND mr.reading_date = v_bsas_date
          )
        ORDER BY s.code;
    ELSIF v_user_role IS NOT DISTINCT FROM 'technician' THEN
        RETURN QUERY
        SELECT DISTINCT s.id, s.code, s.name
        FROM public.stores s
        JOIN public.user_stores us ON us.store_id = s.id
        WHERE s.is_active = true
          AND us.user_id = p_user_id
          AND us.starts_at <= p_now
          AND (us.ends_at IS NULL OR us.ends_at > p_now)
          AND NOT EXISTS (
              SELECT 1 FROM public.meter_readings mr
              WHERE mr.store_id = s.id
                AND mr.reading_date = v_bsas_date
          )
        ORDER BY s.code;
    END IF;
END;
$$ LANGUAGE plpgsql STABLE SET search_path = public, pg_temp;

-- Función pública: Consultar locales con lectura pendiente hoy para el usuario actual
CREATE OR REPLACE FUNCTION public.get_pending_readings_today()
RETURNS TABLE (
    store_id UUID,
    code VARCHAR(10),
    name VARCHAR(100)
) AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL OR NOT public.is_user_approved() THEN
        RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
    END IF;

    RETURN QUERY
    SELECT * FROM public.get_pending_readings_for(v_user_id, NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. VIEWS

-- Vista de directorio de perfiles (ejecutada con permisos del dueño para aislar columnas de tabla base)
CREATE OR REPLACE VIEW public.profiles_directory WITH (security_barrier = true) AS
SELECT 
    p.id,
    p.full_name,
    p.role,
    p.status,
    p.default_store_id,
    CASE 
        WHEN p.id = auth.uid() OR public.get_auth_role() IN ('admin', 'coordinator') THEN p.email
        ELSE NULL 
    END AS email,
    p.created_at,
    p.updated_at
FROM public.profiles p
WHERE 
    public.get_auth_role() IN ('admin', 'coordinator')
    OR (public.is_user_approved() AND p.status = 'approved');

-- 6. TRIGGERS & AUTOMATION

-- Inmutabilidad para tablas append-only de la aplicación (UPDATE / DELETE)
CREATE OR REPLACE FUNCTION public.prevent_mutation_on_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Operación no permitida: esta tabla es de solo agregado (append-only) para la aplicación. No admite UPDATE ni DELETE.';
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stock_movements_readonly ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_readonly
BEFORE UPDATE OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_meter_reading_edits_readonly ON public.meter_reading_edits;
CREATE TRIGGER trg_meter_reading_edits_readonly
BEFORE UPDATE OR DELETE ON public.meter_reading_edits
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_user_status_history_readonly ON public.user_status_history;
CREATE TRIGGER trg_user_status_history_readonly
BEFORE UPDATE OR DELETE ON public.user_status_history
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_stock_requests_readonly_delete ON public.stock_requests;
CREATE TRIGGER trg_stock_requests_readonly_delete
BEFORE DELETE ON public.stock_requests
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_stock_request_views_readonly ON public.stock_request_views;
CREATE TRIGGER trg_stock_request_views_readonly
BEFORE UPDATE OR DELETE ON public.stock_request_views
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_announcements_readonly_delete ON public.announcements;
CREATE TRIGGER trg_announcements_readonly_delete
BEFORE DELETE ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_announcement_reads_readonly ON public.announcement_reads;
CREATE TRIGGER trg_announcement_reads_readonly
BEFORE UPDATE OR DELETE ON public.announcement_reads
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

DROP TRIGGER IF EXISTS trg_user_stores_readonly_delete ON public.user_stores;
CREATE TRIGGER trg_user_stores_readonly_delete
BEFORE DELETE ON public.user_stores
FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation_on_append_only();

-- Protección contra TRUNCATE en tablas append-only y de control
CREATE OR REPLACE FUNCTION public.prevent_truncate_on_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Operación no permitida: esta tabla es de solo agregado (append-only). TRUNCATE bloqueado.';
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stock_movements_no_truncate ON public.stock_movements;
CREATE TRIGGER trg_stock_movements_no_truncate
BEFORE TRUNCATE ON public.stock_movements
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

DROP TRIGGER IF EXISTS trg_meter_reading_edits_no_truncate ON public.meter_reading_edits;
CREATE TRIGGER trg_meter_reading_edits_no_truncate
BEFORE TRUNCATE ON public.meter_reading_edits
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

DROP TRIGGER IF EXISTS trg_user_status_history_no_truncate ON public.user_status_history;
CREATE TRIGGER trg_user_status_history_no_truncate
BEFORE TRUNCATE ON public.user_status_history
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

DROP TRIGGER IF EXISTS trg_stock_requests_no_truncate ON public.stock_requests;
CREATE TRIGGER trg_stock_requests_no_truncate
BEFORE TRUNCATE ON public.stock_requests
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

DROP TRIGGER IF EXISTS trg_stock_request_views_no_truncate ON public.stock_request_views;
CREATE TRIGGER trg_stock_request_views_no_truncate
BEFORE TRUNCATE ON public.stock_request_views
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

DROP TRIGGER IF EXISTS trg_announcements_no_truncate ON public.announcements;
CREATE TRIGGER trg_announcements_no_truncate
BEFORE TRUNCATE ON public.announcements
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

DROP TRIGGER IF EXISTS trg_announcement_reads_no_truncate ON public.announcement_reads;
CREATE TRIGGER trg_announcement_reads_no_truncate
BEFORE TRUNCATE ON public.announcement_reads
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

DROP TRIGGER IF EXISTS trg_user_stores_no_truncate ON public.user_stores;
CREATE TRIGGER trg_user_stores_no_truncate
BEFORE TRUNCATE ON public.user_stores
FOR EACH STATEMENT EXECUTE FUNCTION public.prevent_truncate_on_append_only();

-- updated_at automático
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stores_updated_at ON public.stores;
CREATE TRIGGER trg_stores_updated_at
BEFORE UPDATE ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_spare_parts_updated_at ON public.spare_parts;
CREATE TRIGGER trg_spare_parts_updated_at
BEFORE UPDATE ON public.spare_parts
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_store_inventory_updated_at ON public.store_inventory;
CREATE TRIGGER trg_store_inventory_updated_at
BEFORE UPDATE ON public.store_inventory
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Crear perfil en pending al registrarse en auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, role, status)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        NULL,
        'pending'::user_status
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger: Inserción de lecturas con validaciones de display, autoría forzada, local activo y cálculo de multiplicador
CREATE OR REPLACE FUNCTION public.handle_meter_reading_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_multiplier NUMERIC(10, 4);
    last_display NUMERIC(14, 3);
    v_store_active BOOLEAN;
BEGIN
    -- 1. Validar local activo
    SELECT is_active INTO v_store_active FROM public.stores WHERE id = NEW.store_id;
    IF v_store_active IS NULL OR NOT v_store_active THEN
        RAISE EXCEPTION 'No se pueden registrar lecturas en un local inactivo o inexistente.';
    END IF;

    -- 2. Validar acceso al local (defensa en profundidad)
    IF auth.uid() IS NOT NULL AND NOT public.user_has_store_access(NEW.store_id) THEN
        RAISE EXCEPTION 'Acceso denegado: no posee asignación activa en este local.';
    END IF;

    -- 3. Forzar autoría y fecha del sistema
    IF auth.uid() IS NOT NULL THEN
        NEW.recorded_by := auth.uid();
        NEW.reading_date := public.get_buenos_aires_date();
    ELSE
        IF NEW.recorded_by IS NULL THEN
            RAISE EXCEPTION 'recorded_by no puede ser nulo sin contexto de autoría.';
        END IF;
        IF NEW.reading_date IS NULL THEN
            NEW.reading_date := public.get_buenos_aires_date();
        END IF;
    END IF;

    NEW.created_at := now();
    NEW.updated_at := now();

    -- 4. Fijar valores de sistema por defecto (ignorar valores de cliente)
    NEW.recalculated_at := NULL;
    NEW.recalculated_by := NULL;
    NEW.is_estimated := false;
    NEW.reading_days := 1;
    NEW.calculated_consumption := NULL;

    -- 5. Validación de display frente a la lectura anterior del local (independiente de RLS)
    IF NOT NEW.is_reset THEN
        SELECT display_value INTO last_display
        FROM public.meter_readings
        WHERE store_id = NEW.store_id
          AND reading_date < NEW.reading_date
        ORDER BY reading_date DESC
        LIMIT 1;

        IF last_display IS NOT NULL AND NEW.display_value < last_display THEN
            RAISE EXCEPTION 'El valor del display (%) no puede ser menor que la lectura anterior (%) sin marcar reinicio de medidor.', NEW.display_value, last_display;
        END IF;
    END IF;

    -- 6. Obtener multiplicador configurado en el local
    SELECT meter_multiplier INTO v_multiplier
    FROM public.stores
    WHERE id = NEW.store_id;

    IF v_multiplier IS NOT NULL THEN
        NEW.applied_multiplier := v_multiplier;
        NEW.kwh_reading := ROUND(NEW.display_value * v_multiplier, 3);
    ELSE
        NEW.applied_multiplier := NULL;
        NEW.kwh_reading := NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_meter_reading_insert ON public.meter_readings;
CREATE TRIGGER trg_meter_reading_insert
BEFORE INSERT ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.handle_meter_reading_insert();

-- Trigger: Edición de lecturas y soporte de recálculo de multiplicador
CREATE OR REPLACE FUNCTION public.handle_meter_reading_update()
RETURNS TRIGGER AS $$
DECLARE
    v_is_system_recalc BOOLEAN := COALESCE(current_setting('app.system_recalculating', true) = 'true', false);
    v_multiplier NUMERIC(10, 4);
    last_display NUMERIC(14, 3);
BEGIN
    -- CASO A: Recálculo disparado por el sistema desde handle_store_multiplier_update
    IF v_is_system_recalc THEN
        NEW.store_id := OLD.store_id;
        NEW.reading_date := OLD.reading_date;
        NEW.display_value := OLD.display_value;
        NEW.is_reset := OLD.is_reset;
        NEW.recorded_by := OLD.recorded_by;
        NEW.reading_days := OLD.reading_days;
        NEW.is_estimated := OLD.is_estimated;
        NEW.calculated_consumption := OLD.calculated_consumption;
        NEW.created_at := OLD.created_at;
        NEW.updated_at := now();
        RETURN NEW;
    END IF;

    -- CASO B: Edición regular por usuario
    IF OLD.reading_date <> public.get_buenos_aires_date() THEN
        RAISE EXCEPTION 'Lectura bloqueada: solo se permite corregir lecturas correspondientes a la fecha en curso de Buenos Aires.';
    END IF;

    IF auth.uid() IS NOT NULL AND NOT public.user_has_store_access(OLD.store_id) THEN
        RAISE EXCEPTION 'Acceso denegado: no posee asignación activa en este local.';
    END IF;

    -- El cliente solo puede cambiar display_value e is_reset
    NEW.store_id := OLD.store_id;
    NEW.reading_date := OLD.reading_date;
    NEW.recorded_by := OLD.recorded_by;
    NEW.recalculated_at := OLD.recalculated_at;
    NEW.recalculated_by := OLD.recalculated_by;
    NEW.reading_days := OLD.reading_days;
    NEW.is_estimated := OLD.is_estimated;
    NEW.calculated_consumption := OLD.calculated_consumption;
    NEW.created_at := OLD.created_at;
    NEW.updated_at := now();

    -- Validación de display frente a la lectura anterior
    IF NOT NEW.is_reset THEN
        SELECT display_value INTO last_display
        FROM public.meter_readings
        WHERE store_id = NEW.store_id
          AND reading_date < NEW.reading_date
        ORDER BY reading_date DESC
        LIMIT 1;

        IF last_display IS NOT NULL AND NEW.display_value < last_display THEN
            RAISE EXCEPTION 'El valor del display (%) no puede ser menor que la lectura anterior (%) sin marcar reinicio de medidor.', NEW.display_value, last_display;
        END IF;
    END IF;

    -- Recálculo de kWh según multiplicador
    SELECT meter_multiplier INTO v_multiplier
    FROM public.stores
    WHERE id = NEW.store_id;

    IF v_multiplier IS NOT NULL THEN
        NEW.applied_multiplier := v_multiplier;
        NEW.kwh_reading := ROUND(NEW.display_value * v_multiplier, 3);
    ELSE
        NEW.applied_multiplier := NULL;
        NEW.kwh_reading := NULL;
    END IF;

    -- Registrar auditoría si hubo cambio en display, reset o kWh
    IF (OLD.display_value <> NEW.display_value OR OLD.is_reset <> NEW.is_reset OR OLD.kwh_reading IS DISTINCT FROM NEW.kwh_reading) THEN
        INSERT INTO public.meter_reading_edits (
            reading_id,
            edited_by,
            previous_display_value,
            new_display_value,
            previous_kwh_reading,
            new_kwh_reading,
            previous_is_reset,
            new_is_reset,
            created_at
        ) VALUES (
            OLD.id,
            COALESCE(auth.uid(), OLD.recorded_by),
            OLD.display_value,
            NEW.display_value,
            OLD.kwh_reading,
            NEW.kwh_reading,
            OLD.is_reset,
            NEW.is_reset,
            now()
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_meter_reading_update ON public.meter_readings;
CREATE TRIGGER trg_meter_reading_update
BEFORE UPDATE ON public.meter_readings
FOR EACH ROW EXECUTE FUNCTION public.handle_meter_reading_update();

-- Trigger: Recalcular lecturas pendientes al cargar multiplicador por primera vez en un local
CREATE OR REPLACE FUNCTION public.handle_store_multiplier_update()
RETURNS TRIGGER AS $$
DECLARE
    v_actor_id UUID := auth.uid();
BEGIN
    IF OLD.meter_multiplier IS NULL AND NEW.meter_multiplier IS NOT NULL THEN
        PERFORM set_config('app.system_recalculating', 'true', true);

        UPDATE public.meter_readings
        SET applied_multiplier = NEW.meter_multiplier,
            kwh_reading = ROUND(display_value * NEW.meter_multiplier, 3),
            recalculated_at = now(),
            recalculated_by = v_actor_id
        WHERE store_id = NEW.id
          AND kwh_reading IS NULL;

        PERFORM set_config('app.system_recalculating', 'false', true);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_store_multiplier_update ON public.stores;
CREATE TRIGGER trg_store_multiplier_update
AFTER UPDATE OF meter_multiplier ON public.stores
FOR EACH ROW EXECUTE FUNCTION public.handle_store_multiplier_update();

-- Trigger: Forzar cálculo de month_days y daily_target_kwh en store_monthly_targets
CREATE OR REPLACE FUNCTION public.calculate_monthly_target_daily()
RETURNS TRIGGER AS $$
DECLARE
    v_date DATE;
BEGIN
    v_date := make_date(NEW.year, NEW.month, 1);
    NEW.month_days := ((v_date + INTERVAL '1 month' - INTERVAL '1 day')::DATE - v_date + 1);
    NEW.daily_target_kwh := ROUND((NEW.base_kwh * (1.0 - (NEW.reduction_percentage / 100.0))) / NEW.month_days, 3);
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_calculate_monthly_target_daily ON public.store_monthly_targets;
CREATE TRIGGER trg_calculate_monthly_target_daily
BEFORE INSERT OR UPDATE ON public.store_monthly_targets
FOR EACH ROW EXECUTE FUNCTION public.calculate_monthly_target_daily();

-- Trigger: Autoría en invitations
CREATE OR REPLACE FUNCTION public.handle_invitation_author()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_invitation_author ON public.invitations;
CREATE TRIGGER trg_invitation_author
BEFORE INSERT ON public.invitations
FOR EACH ROW EXECUTE FUNCTION public.handle_invitation_author();

-- Trigger: Autoría en app_config
CREATE OR REPLACE FUNCTION public.handle_app_config_author()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.updated_by := auth.uid();
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_app_config_author ON public.app_config;
CREATE TRIGGER trg_app_config_author
BEFORE INSERT OR UPDATE ON public.app_config
FOR EACH ROW EXECUTE FUNCTION public.handle_app_config_author();

-- Trigger de defensa en profundidad para updates de perfiles
CREATE OR REPLACE FUNCTION public.validate_profile_update()
RETURNS TRIGGER AS $$
DECLARE
    v_is_profile_modifying BOOLEAN := COALESCE(current_setting('app.profile_system_modifying', true) = 'true', false);
    v_actor_role user_role := public.get_auth_role();
    v_admin_count INT;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        -- Si el usuario autenticado no está aprobado, bloquear cualquier modificación
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        -- Si no se invocó desde una función autorizada del sistema, bloquear cambios de rol y estado
        IF NOT v_is_profile_modifying THEN
            IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.previous_role IS DISTINCT FROM NEW.previous_role OR OLD.role_expires_at IS DISTINCT FROM NEW.role_expires_at) THEN
                RAISE EXCEPTION 'Operación no permitida: las modificaciones de rol solo pueden realizarse mediante las funciones autorizadas del sistema.';
            END IF;

            IF (OLD.status IS DISTINCT FROM NEW.status) THEN
                RAISE EXCEPTION 'Operación no permitida: las modificaciones de estado solo pueden realizarse mediante las funciones autorizadas del sistema.';
            END IF;

            -- Técnico solo puede modificar su propio perfil
            IF v_actor_role IS NOT DISTINCT FROM 'technician' AND auth.uid() <> OLD.id THEN
                RAISE EXCEPTION 'Acceso denegado: un técnico solo puede modificar su propio perfil.';
            END IF;
        END IF;

        -- Validar que default_store_id sea accesible para el usuario (si se especifica)
        IF NEW.default_store_id IS NOT NULL AND (OLD.default_store_id IS DISTINCT FROM NEW.default_store_id OR OLD.role IS DISTINCT FROM NEW.role) THEN
            IF NEW.role IS NOT DISTINCT FROM 'technician' THEN
                IF NOT EXISTS (
                    SELECT 1 FROM public.user_stores
                    WHERE user_id = NEW.id
                      AND store_id = NEW.default_store_id
                      AND starts_at <= NOW()
                      AND (ends_at IS NULL OR ends_at > NOW())
                ) THEN
                    RAISE EXCEPTION 'El local asignado por defecto no es accesible para el usuario.';
                END IF;
            END IF;
        END IF;

        -- Protección del último administrador activo
        IF OLD.role IS NOT DISTINCT FROM 'admin' AND OLD.status IS NOT DISTINCT FROM 'approved' AND (
            NEW.role IS DISTINCT FROM 'admin' 
            OR NEW.status IN ('inactive', 'rejected')
            OR (NEW.role_expires_at IS NOT NULL AND NEW.role_expires_at <= NOW())
        ) THEN
            SELECT COUNT(*) INTO v_admin_count
            FROM public.profiles
            WHERE role = 'admin'
              AND status = 'approved'
              AND (role_expires_at IS NULL OR role_expires_at > NOW())
              AND id <> OLD.id;

            IF v_admin_count = 0 THEN
                RAISE EXCEPTION 'Operación no permitida: no se puede degradar, desactivar o rechazar al último administrador activo del sistema.';
            END IF;
        END IF;
    END IF;

    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_validate_profile_update ON public.profiles;
CREATE TRIGGER trg_validate_profile_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.validate_profile_update();

-- Triggers para user_stores: autoría y validación de edición
CREATE OR REPLACE FUNCTION public.handle_user_stores_author()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF auth.uid() IS NOT NULL THEN
            NEW.assigned_by := auth.uid();
        END IF;
        NEW.created_at := now();
    ELSIF TG_OP = 'UPDATE' THEN
        IF auth.uid() IS NOT NULL AND NOT COALESCE(current_setting('app.store_assignment_modifying', true) = 'true', false) THEN
            RAISE EXCEPTION 'Operación no permitida: las asignaciones de locales solo pueden modificarse mediante funciones autorizadas.';
        END IF;
        IF auth.uid() IS NOT NULL AND NEW.ends_at IS NOT NULL AND (OLD.ends_at IS NULL OR OLD.ends_at IS DISTINCT FROM NEW.ends_at) THEN
            NEW.ended_by := auth.uid();
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_user_stores_author ON public.user_stores;
CREATE TRIGGER trg_user_stores_author
BEFORE INSERT OR UPDATE ON public.user_stores
FOR EACH ROW EXECUTE FUNCTION public.handle_user_stores_author();

-- Trigger: Inserción y validación de stock_requests
CREATE OR REPLACE FUNCTION public.handle_stock_request_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_part_active BOOLEAN;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.requester_id := auth.uid();

        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario debe estar aprobado para realizar peticiones.';
        END IF;

        IF NOT public.user_has_store_access(NEW.store_id) THEN
            RAISE EXCEPTION 'Acceso denegado: no posee acceso activo al local para realizar la petición.';
        END IF;
    ELSE
        IF NEW.requester_id IS NULL THEN
            RAISE EXCEPTION 'requester_id no puede ser nulo sin contexto de autenticación.';
        END IF;
    END IF;

    IF NEW.part_id IS NOT NULL THEN
        SELECT is_active INTO v_part_active FROM public.spare_parts WHERE id = NEW.part_id;
        IF v_part_active IS NULL OR NOT v_part_active THEN
            RAISE EXCEPTION 'No se pueden solicitar repuestos inactivos o inexistentes.';
        END IF;
    END IF;

    NEW.status := 'open';
    NEW.closed_by := NULL;
    NEW.closed_at := NULL;
    NEW.created_at := now();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stock_request_insert ON public.stock_requests;
CREATE TRIGGER trg_stock_request_insert
BEFORE INSERT ON public.stock_requests
FOR EACH ROW EXECUTE FUNCTION public.handle_stock_request_insert();

-- Trigger: Bloqueo de UPDATE directo en stock_requests
CREATE OR REPLACE FUNCTION public.validate_stock_request_update()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT COALESCE(current_setting('app.stock_request_modifying', true) = 'true', false) THEN
        RAISE EXCEPTION 'Operación no permitida: las peticiones no admiten UPDATE directo desde la aplicación.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stock_request_update ON public.stock_requests;
CREATE TRIGGER trg_stock_request_update
BEFORE UPDATE ON public.stock_requests
FOR EACH ROW EXECUTE FUNCTION public.validate_stock_request_update();

-- Trigger: Autoría en stock_request_views
CREATE OR REPLACE FUNCTION public.handle_stock_request_view_author()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.user_id := auth.uid();
    END IF;
    NEW.seen_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stock_request_view_author ON public.stock_request_views;
CREATE TRIGGER trg_stock_request_view_author
BEFORE INSERT ON public.stock_request_views
FOR EACH ROW EXECUTE FUNCTION public.handle_stock_request_view_author();

-- Trigger: Inserción y validación de announcements
CREATE OR REPLACE FUNCTION public.handle_announcement_insert()
RETURNS TRIGGER AS $$
DECLARE
    v_store_active BOOLEAN;
    v_target_user_status user_status;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.author_id := auth.uid();

        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF public.get_auth_role() IS DISTINCT FROM 'admin' AND public.get_auth_role() IS DISTINCT FROM 'coordinator' THEN
            RAISE EXCEPTION 'Acceso denegado: solo admin o coordinador pueden publicar anuncios.';
        END IF;
    END IF;

    IF NEW.target_type = 'store' THEN
        SELECT is_active INTO v_store_active FROM public.stores WHERE id = NEW.target_store_id;
        IF v_store_active IS NULL OR NOT v_store_active THEN
            RAISE EXCEPTION 'El local de destino debe ser un local activo.';
        END IF;
    ELSIF NEW.target_type = 'user' THEN
        SELECT status INTO v_target_user_status FROM public.profiles WHERE id = NEW.target_user_id;
        IF v_target_user_status IS DISTINCT FROM 'approved' THEN
            RAISE EXCEPTION 'El usuario de destino debe ser un usuario aprobado.';
        END IF;
    END IF;

    NEW.archived_at := NULL;
    NEW.created_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_announcement_insert ON public.announcements;
CREATE TRIGGER trg_announcement_insert
BEFORE INSERT ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.handle_announcement_insert();

-- Trigger: Bloqueo de UPDATE directo en announcements
CREATE OR REPLACE FUNCTION public.validate_announcement_update()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL AND NOT COALESCE(current_setting('app.announcement_modifying', true) = 'true', false) THEN
        RAISE EXCEPTION 'Operación no permitida: los anuncios no admiten UPDATE directo desde la aplicación.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_announcement_update ON public.announcements;
CREATE TRIGGER trg_announcement_update
BEFORE UPDATE ON public.announcements
FOR EACH ROW EXECUTE FUNCTION public.validate_announcement_update();

-- Trigger: Autoría en announcement_reads
CREATE OR REPLACE FUNCTION public.handle_announcement_read_author()
RETURNS TRIGGER AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.user_id := auth.uid();
    END IF;
    NEW.read_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_announcement_read_author ON public.announcement_reads;
CREATE TRIGGER trg_announcement_read_author
BEFORE INSERT ON public.announcement_reads
FOR EACH ROW EXECUTE FUNCTION public.handle_announcement_read_author();

-- 7. BUSINESS LOGIC STORED PROCEDURES

-- Función transaccional para registrar movimientos de stock (exclusiva para clientes autenticados)
CREATE OR REPLACE FUNCTION public.register_stock_movement(
    p_store_id UUID,
    p_part_id UUID,
    p_movement_type stock_movement_type,
    p_variation NUMERIC(12, 2),
    p_notes TEXT DEFAULT NULL,
    p_shelf_location VARCHAR(80) DEFAULT NULL
)
RETURNS public.stock_movements AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_store_active BOOLEAN;
    v_part_active BOOLEAN;
    v_part_unit VARCHAR(20);
    v_current_qty NUMERIC(12, 2) := 0;
    v_new_qty NUMERIC(12, 2) := 0;
    v_movement public.stock_movements;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Acceso denegado: se requiere usuario autenticado.';
    END IF;

    IF NOT public.is_user_approved() THEN
        RAISE EXCEPTION 'Acceso denegado: el usuario debe estar aprobado para registrar movimientos.';
    END IF;

    IF NOT public.user_has_store_access(p_store_id) THEN
        RAISE EXCEPTION 'Acceso denegado: no posee acceso activo al inventario de este local.';
    END IF;

    -- Validar coherencia entre tipo y variación
    IF p_movement_type IN ('add', 'initial_load') AND p_variation <= 0 THEN
        RAISE EXCEPTION 'El movimiento de tipo % exige una variación estrictamente positiva (> 0).', p_movement_type;
    ELSIF p_movement_type = 'consume' AND p_variation >= 0 THEN
        RAISE EXCEPTION 'El movimiento de tipo consume exige una variación estrictamente negativa (< 0).';
    ELSIF p_movement_type = 'adjustment' THEN
        IF p_variation = 0 THEN
            RAISE EXCEPTION 'El movimiento de tipo adjustment exige una variación distinta de 0.';
        END IF;
        IF p_notes IS NULL OR TRIM(p_notes) = '' THEN
            RAISE EXCEPTION 'El movimiento de tipo adjustment exige una nota explicativa no vacía.';
        END IF;
    END IF;

    -- Validar local activo
    SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_store_id;
    IF v_store_active IS NULL OR NOT v_store_active THEN
        RAISE EXCEPTION 'No se pueden registrar movimientos en un local inactivo o inexistente.';
    END IF;

    -- Validar repuesto activo y unidad
    SELECT is_active, unit INTO v_part_active, v_part_unit FROM public.spare_parts WHERE id = p_part_id;
    IF v_part_active IS NULL OR NOT v_part_active THEN
        RAISE EXCEPTION 'No se pueden registrar movimientos sobre un repuesto inactivo o inexistente.';
    END IF;

    IF v_part_unit = 'unit' AND p_variation <> TRUNC(p_variation) THEN
        RAISE EXCEPTION 'Para repuestos con unidad "unit", la variación debe ser un número entero.';
    END IF;

    -- Bloquear o crear registro en store_inventory
    SELECT quantity INTO v_current_qty
    FROM public.store_inventory
    WHERE store_id = p_store_id AND part_id = p_part_id
    FOR UPDATE;

    IF NOT FOUND THEN
        v_current_qty := 0;
        INSERT INTO public.store_inventory (store_id, part_id, quantity, shelf_location)
        VALUES (p_store_id, p_part_id, 0, p_shelf_location)
        ON CONFLICT (store_id, part_id) DO NOTHING;

        SELECT quantity INTO v_current_qty
        FROM public.store_inventory
        WHERE store_id = p_store_id AND part_id = p_part_id
        FOR UPDATE;
    END IF;

    v_new_qty := v_current_qty + p_variation;

    IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. La cantidad no puede quedar negativa (Stock actual: %, Variación: %)', v_current_qty, p_variation;
    END IF;

    INSERT INTO public.stock_movements (
        store_id,
        part_id,
        user_id,
        movement_type,
        variation,
        quantity_before,
        quantity_after,
        notes
    ) VALUES (
        p_store_id,
        p_part_id,
        v_user_id,
        p_movement_type,
        p_variation,
        v_current_qty,
        v_new_qty,
        p_notes
    ) RETURNING * INTO v_movement;

    UPDATE public.store_inventory
    SET quantity = v_new_qty,
        shelf_location = COALESCE(p_shelf_location, shelf_location),
        updated_at = now()
    WHERE store_id = p_store_id AND part_id = p_part_id;

    RETURN v_movement;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función transaccional para seed y sistema (ejecutable solo sin auth.uid())
CREATE OR REPLACE FUNCTION public.register_stock_movement_system(
    p_store_id UUID,
    p_part_id UUID,
    p_movement_type stock_movement_type,
    p_variation NUMERIC(12, 2),
    p_notes TEXT DEFAULT NULL,
    p_shelf_location VARCHAR(80) DEFAULT NULL,
    p_user_id UUID DEFAULT NULL
)
RETURNS public.stock_movements AS $$
DECLARE
    v_store_active BOOLEAN;
    v_part_active BOOLEAN;
    v_part_unit VARCHAR(20);
    v_current_qty NUMERIC(12, 2) := 0;
    v_new_qty NUMERIC(12, 2) := 0;
    v_movement public.stock_movements;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'register_stock_movement_system solo puede ser ejecutado en contexto de sistema.';
    END IF;

    IF p_movement_type IN ('add', 'initial_load') AND p_variation <= 0 THEN
        RAISE EXCEPTION 'El movimiento de tipo % exige una variación estrictamente positiva (> 0).', p_movement_type;
    ELSIF p_movement_type = 'consume' AND p_variation >= 0 THEN
        RAISE EXCEPTION 'El movimiento de tipo consume exige una variación estrictamente negativa (< 0).';
    ELSIF p_movement_type = 'adjustment' THEN
        IF p_variation = 0 THEN
            RAISE EXCEPTION 'El movimiento de tipo adjustment exige una variación distinta de 0.';
        END IF;
        IF p_notes IS NULL OR TRIM(p_notes) = '' THEN
            RAISE EXCEPTION 'El movimiento de tipo adjustment exige una nota explicativa no vacía.';
        END IF;
    END IF;

    SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_store_id;
    IF v_store_active IS NULL OR NOT v_store_active THEN
        RAISE EXCEPTION 'No se pueden registrar movimientos en un local inactivo o inexistente.';
    END IF;

    SELECT is_active, unit INTO v_part_active, v_part_unit FROM public.spare_parts WHERE id = p_part_id;
    IF v_part_active IS NULL OR NOT v_part_active THEN
        RAISE EXCEPTION 'No se pueden registrar movimientos sobre un repuesto inactivo o inexistente.';
    END IF;

    IF v_part_unit = 'unit' AND p_variation <> TRUNC(p_variation) THEN
        RAISE EXCEPTION 'Para repuestos con unidad "unit", la variación debe ser un número entero.';
    END IF;

    SELECT quantity INTO v_current_qty
    FROM public.store_inventory
    WHERE store_id = p_store_id AND part_id = p_part_id
    FOR UPDATE;

    IF NOT FOUND THEN
        v_current_qty := 0;
        INSERT INTO public.store_inventory (store_id, part_id, quantity, shelf_location)
        VALUES (p_store_id, p_part_id, 0, p_shelf_location)
        ON CONFLICT (store_id, part_id) DO NOTHING;

        SELECT quantity INTO v_current_qty
        FROM public.store_inventory
        WHERE store_id = p_store_id AND part_id = p_part_id
        FOR UPDATE;
    END IF;

    v_new_qty := v_current_qty + p_variation;

    IF v_new_qty < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente. La cantidad no puede quedar negativa (Stock actual: %, Variación: %)', v_current_qty, p_variation;
    END IF;

    INSERT INTO public.stock_movements (
        store_id,
        part_id,
        user_id,
        movement_type,
        variation,
        quantity_before,
        quantity_after,
        notes
    ) VALUES (
        p_store_id,
        p_part_id,
        p_user_id,
        p_movement_type,
        p_variation,
        v_current_qty,
        v_new_qty,
        p_notes
    ) RETURNING * INTO v_movement;

    UPDATE public.store_inventory
    SET quantity = v_new_qty,
        shelf_location = COALESCE(p_shelf_location, shelf_location),
        updated_at = now()
    WHERE store_id = p_store_id AND part_id = p_part_id;

    RETURN v_movement;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para aprobar usuario en estado pending (admin o coordinador)
CREATE OR REPLACE FUNCTION public.approve_user(
    p_target_user_id UUID,
    p_assigned_role user_role,
    p_default_store_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_actor_role user_role := public.get_auth_role();
    v_actor_id UUID := auth.uid();
    v_target_status user_status;
    v_store_active BOOLEAN;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF v_actor_role IS DISTINCT FROM 'admin' AND v_actor_role IS DISTINCT FROM 'coordinator' THEN
            RAISE EXCEPTION 'Acceso denegado: solo admin o coordinador pueden aprobar usuarios.';
        END IF;

        IF p_target_user_id = v_actor_id THEN
            RAISE EXCEPTION 'Operación no permitida: nadie puede auto-aprobarse.';
        END IF;

        IF v_actor_role = 'coordinator' AND p_assigned_role IS DISTINCT FROM 'technician' THEN
            RAISE EXCEPTION 'Un coordinador solo puede aprobar usuarios con rol technician.';
        END IF;
    END IF;

    IF p_assigned_role IS NULL THEN
        RAISE EXCEPTION 'El rol asignado no puede ser nulo.';
    END IF;

    SELECT status INTO v_target_status
    FROM public.profiles
    WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado.';
    END IF;

    IF v_target_status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'approve_user solo opera sobre usuarios en estado pending.';
    END IF;

    -- Para técnicos, default_store_id es obligatorio
    IF p_assigned_role IS NOT DISTINCT FROM 'technician' THEN
        IF p_default_store_id IS NULL THEN
            RAISE EXCEPTION 'Al aprobar un técnico, el local por defecto es obligatorio.';
        END IF;

        SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_default_store_id;
        IF v_store_active IS NULL OR NOT v_store_active THEN
            RAISE EXCEPTION 'El local asignado debe ser un local activo.';
        END IF;
    ELSIF p_default_store_id IS NOT NULL THEN
        SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_default_store_id;
        IF v_store_active IS NULL OR NOT v_store_active THEN
            RAISE EXCEPTION 'El local asignado debe ser un local activo.';
        END IF;
    END IF;

    -- Activar bypass controlado para la transacción
    PERFORM set_config('app.profile_system_modifying', 'true', true);

    -- Si se asigna un local por defecto, crear asignación permanente en user_stores
    IF p_default_store_id IS NOT NULL THEN
        PERFORM set_config('app.store_assignment_modifying', 'true', true);
        INSERT INTO public.user_stores (
            user_id,
            store_id,
            starts_at,
            ends_at,
            assigned_by
        ) VALUES (
            p_target_user_id,
            p_default_store_id,
            NOW() - INTERVAL '1 millisecond',
            NULL,
            COALESCE(v_actor_id, p_target_user_id)
        );
        PERFORM set_config('app.store_assignment_modifying', 'false', true);
    END IF;

    UPDATE public.profiles
    SET status = 'approved',
        role = p_assigned_role,
        default_store_id = p_default_store_id,
        approved_by = COALESCE(v_actor_id, p_target_user_id),
        approved_at = now(),
        updated_at = now()
    WHERE id = p_target_user_id;

    INSERT INTO public.role_change_history (
        user_id,
        changed_by,
        old_role,
        new_role,
        expires_at
    ) VALUES (
        p_target_user_id,
        COALESCE(v_actor_id, p_target_user_id),
        NULL,
        p_assigned_role,
        NULL
    );

    INSERT INTO public.user_status_history (
        user_id,
        changed_by,
        old_status,
        new_status
    ) VALUES (
        p_target_user_id,
        COALESCE(v_actor_id, p_target_user_id),
        'pending',
        'approved'
    );

    PERFORM set_config('app.profile_system_modifying', 'false', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para cambiar estado de usuario (admin o coordinador)
CREATE OR REPLACE FUNCTION public.set_user_status(
    p_target_user_id UUID,
    p_new_status user_status
)
RETURNS VOID AS $$
DECLARE
    v_actor_role user_role := public.get_auth_role();
    v_actor_id UUID := auth.uid();
    v_target_role user_role;
    v_target_status user_status;
    v_admin_count INT;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF v_actor_role IS DISTINCT FROM 'admin' AND v_actor_role IS DISTINCT FROM 'coordinator' THEN
            RAISE EXCEPTION 'Acceso denegado: solo admin o coordinador pueden cambiar el estado de usuarios.';
        END IF;

        IF p_target_user_id = v_actor_id THEN
            RAISE EXCEPTION 'Operación no permitida: nadie puede modificar su propio estado.';
        END IF;
    END IF;

    SELECT status, role INTO v_target_status, v_target_role
    FROM public.profiles
    WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado.';
    END IF;

    -- Restricciones de coordinador
    IF auth.uid() IS NOT NULL AND v_actor_role IS NOT DISTINCT FROM 'coordinator' THEN
        IF v_target_role IS DISTINCT FROM 'technician' THEN
            RAISE EXCEPTION 'Acceso denegado: un coordinador solo puede modificar el estado de usuarios con rol technician.';
        END IF;
    END IF;

    -- Validaciones de transiciones de estado
    IF p_new_status = 'approved' THEN
        IF v_target_status = 'pending' THEN
            RAISE EXCEPTION 'Operación no permitida: usuarios en estado pending solo pueden aprobarse mediante approve_user.';
        END IF;
        IF v_target_role IS NULL THEN
            RAISE EXCEPTION 'Operación no permitida: no se puede aprobar a un usuario sin rol asignado.';
        END IF;
    ELSIF p_new_status NOT IN ('rejected', 'inactive') THEN
        RAISE EXCEPTION 'Estado no permitido en set_user_status. Solo se permite approved, rejected o inactive.';
    END IF;

    -- Protección del último admin activo
    IF v_target_role IS NOT DISTINCT FROM 'admin' AND v_target_status IS NOT DISTINCT FROM 'approved' AND p_new_status IN ('rejected', 'inactive') THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin' 
          AND status = 'approved' 
          AND (role_expires_at IS NULL OR role_expires_at > NOW())
          AND id <> p_target_user_id;

        IF v_admin_count = 0 THEN
            RAISE EXCEPTION 'Operación no permitida: no se puede desactivar o rechazar al último administrador activo del sistema.';
        END IF;
    END IF;

    -- Activar bypass para actualización en profiles
    PERFORM set_config('app.profile_system_modifying', 'true', true);

    UPDATE public.profiles
    SET status = p_new_status,
        approved_by = CASE WHEN p_new_status = 'approved' THEN COALESCE(v_actor_id, approved_by) ELSE approved_by END,
        approved_at = CASE WHEN p_new_status = 'approved' THEN now() ELSE approved_at END,
        updated_at = now()
    WHERE id = p_target_user_id;

    INSERT INTO public.user_status_history (
        user_id,
        changed_by,
        old_status,
        new_status
    ) VALUES (
        p_target_user_id,
        COALESCE(v_actor_id, p_target_user_id),
        v_target_status,
        p_new_status
    );

    PERFORM set_config('app.profile_system_modifying', 'false', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para cambiar rol con vencimiento opcional (solo admin)
CREATE OR REPLACE FUNCTION public.assign_user_role(
    p_target_user_id UUID,
    p_new_role user_role,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_actor_role user_role := public.get_auth_role();
    v_actor_id UUID := auth.uid();
    v_target_status user_status;
    v_current_role user_role;
    v_current_prev_role user_role;
    v_current_expires_at TIMESTAMPTZ;
    v_admin_count INT;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF v_actor_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Acceso denegado: solo un administrador puede cambiar roles.';
        END IF;
    END IF;

    IF p_expires_at IS NOT NULL AND p_expires_at <= NOW() THEN
        RAISE EXCEPTION 'p_expires_at debe ser una fecha y hora futura o nula.';
    END IF;

    SELECT status, role, previous_role, role_expires_at
    INTO v_target_status, v_current_role, v_current_prev_role, v_current_expires_at
    FROM public.profiles
    WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado.';
    END IF;

    IF v_target_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'assign_user_role solo puede aplicarse a usuarios ya aprobados.';
    END IF;

    -- Protección del último administrador activo si se degrada a otro rol
    IF v_current_role IS NOT DISTINCT FROM 'admin' AND p_new_role IS DISTINCT FROM 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.profiles
        WHERE role = 'admin'
          AND status = 'approved'
          AND (role_expires_at IS NULL OR role_expires_at > NOW())
          AND id <> p_target_user_id;

        IF v_admin_count = 0 THEN
            RAISE EXCEPTION 'Operación no permitida: no se puede degradar al último administrador activo del sistema.';
        END IF;
    END IF;

    PERFORM set_config('app.profile_system_modifying', 'true', true);

    UPDATE public.profiles
    SET previous_role = CASE 
            WHEN p_expires_at IS NOT NULL THEN 
                CASE 
                    WHEN v_current_prev_role IS NOT NULL AND v_current_expires_at > NOW() THEN v_current_prev_role
                    ELSE COALESCE(v_current_role, 'technician'::user_role)
                END
            ELSE NULL 
        END,
        role = p_new_role,
        role_expires_at = p_expires_at,
        updated_at = now()
    WHERE id = p_target_user_id;

    INSERT INTO public.role_change_history (
        user_id,
        changed_by,
        old_role,
        new_role,
        expires_at
    ) VALUES (
        p_target_user_id,
        COALESCE(v_actor_id, p_target_user_id),
        v_current_role,
        p_new_role,
        p_expires_at
    );

    PERFORM set_config('app.profile_system_modifying', 'false', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función utilitaria para revertir roles vencidos físicamente (solo service_role o postgres)
CREATE OR REPLACE FUNCTION public.revert_expired_roles()
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
    v_other_admin_count INT;
    r RECORD;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'revert_expired_roles solo puede ser ejecutado por service_role o postgres.';
    END IF;

    PERFORM set_config('app.profile_system_modifying', 'true', true);

    FOR r IN 
        SELECT id, role, previous_role
        FROM public.profiles
        WHERE role_expires_at IS NOT NULL AND role_expires_at <= NOW()
    LOOP
        -- Protección: omitir reversión si dejaría al sistema sin ningún admin activo
        IF r.role IS NOT DISTINCT FROM 'admin' AND COALESCE(r.previous_role, 'technician'::user_role) IS DISTINCT FROM 'admin' THEN
            SELECT COUNT(*) INTO v_other_admin_count
            FROM public.profiles
            WHERE role = 'admin'
              AND status = 'approved'
              AND (role_expires_at IS NULL OR role_expires_at > NOW())
              AND id <> r.id;

            IF v_other_admin_count = 0 THEN
                RAISE WARNING 'Omitiendo reversión de rol para usuario %: dejaría al sistema sin ningún admin activo.', r.id;
                CONTINUE;
            END IF;
        END IF;

        UPDATE public.profiles
        SET role = COALESCE(r.previous_role, 'technician'::user_role),
            previous_role = NULL,
            role_expires_at = NULL,
            updated_at = now()
        WHERE id = r.id;

        INSERT INTO public.role_change_history (
            user_id,
            changed_by,
            old_role,
            new_role,
            expires_at
        ) VALUES (
            r.id,
            r.id,
            r.role,
            COALESCE(r.previous_role, 'technician'::user_role),
            NULL
        );

        v_count := v_count + 1;
    END LOOP;

    PERFORM set_config('app.profile_system_modifying', 'false', true);

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para asignar local a técnico (admin o coordinador)
CREATE OR REPLACE FUNCTION public.assign_store(
    p_user_id UUID,
    p_store_id UUID,
    p_ends_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
    v_actor_role user_role := public.get_auth_role();
    v_target_role user_role;
    v_target_status user_status;
    v_store_active BOOLEAN;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF v_actor_role IS DISTINCT FROM 'admin' AND v_actor_role IS DISTINCT FROM 'coordinator' THEN
            RAISE EXCEPTION 'Acceso denegado: solo admin o coordinador pueden asignar locales.';
        END IF;
    END IF;

    SELECT status, role INTO v_target_status, v_target_role
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado.';
    END IF;

    IF v_target_status IS DISTINCT FROM 'approved' OR v_target_role IS DISTINCT FROM 'technician' THEN
        RAISE EXCEPTION 'Solo se pueden asignar locales a técnicos aprobados.';
    END IF;

    SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_store_id;
    IF v_store_active IS NULL OR NOT v_store_active THEN
        RAISE EXCEPTION 'No se pueden asignar locales inactivos o inexistentes.';
    END IF;

    IF p_ends_at IS NOT NULL AND p_ends_at <= NOW() THEN
        RAISE EXCEPTION 'ends_at debe ser una fecha y hora futura o nula.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_id = p_user_id
          AND store_id = p_store_id
          AND starts_at <= NOW()
          AND (ends_at IS NULL OR ends_at > NOW())
    ) THEN
        RAISE EXCEPTION 'El usuario ya cuenta con una asignación activa para este local.';
    END IF;

    PERFORM set_config('app.store_assignment_modifying', 'true', true);

    INSERT INTO public.user_stores (
        user_id,
        store_id,
        starts_at,
        ends_at,
        assigned_by
    ) VALUES (
        p_user_id,
        p_store_id,
        NOW() - INTERVAL '1 millisecond',
        p_ends_at,
        COALESCE(auth.uid(), p_user_id)
    );

    PERFORM set_config('app.store_assignment_modifying', 'false', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para finalizar asignación de local (admin o coordinador)
CREATE OR REPLACE FUNCTION public.end_store_assignment(p_assignment_id UUID)
RETURNS VOID AS $$
DECLARE
    v_actor_role user_role := public.get_auth_role();
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF v_actor_role IS DISTINCT FROM 'admin' AND v_actor_role IS DISTINCT FROM 'coordinator' THEN
            RAISE EXCEPTION 'Acceso denegado: solo admin o coordinador pueden finalizar asignaciones.';
        END IF;
    END IF;

    PERFORM set_config('app.store_assignment_modifying', 'true', true);

    UPDATE public.user_stores
    SET ends_at = NOW(),
        ended_by = COALESCE(auth.uid(), assigned_by)
    WHERE id = p_assignment_id
      AND (ends_at IS NULL OR ends_at > NOW());

    IF NOT FOUND THEN
        PERFORM set_config('app.store_assignment_modifying', 'false', true);
        RAISE EXCEPTION 'Asignación no encontrada o ya finalizada.';
    END IF;

    PERFORM set_config('app.store_assignment_modifying', 'false', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para mover un técnico de un local permanente a otro (admin o coordinador)
CREATE OR REPLACE FUNCTION public.move_user_store(
    p_user_id UUID,
    p_from_store_id UUID,
    p_to_store_id UUID
)
RETURNS VOID AS $$
DECLARE
    v_actor_role user_role := public.get_auth_role();
    v_actor_id UUID := auth.uid();
    v_target_status user_status;
    v_target_role user_role;
    v_default_store_id UUID;
    v_store_active BOOLEAN;
    v_perm_assignment_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF v_actor_role IS DISTINCT FROM 'admin' AND v_actor_role IS DISTINCT FROM 'coordinator' THEN
            RAISE EXCEPTION 'Acceso denegado: solo admin o coordinador pueden mover usuarios entre locales.';
        END IF;

        IF p_user_id = v_actor_id THEN
            RAISE EXCEPTION 'Operación no permitida: un usuario no puede mover sus propias asignaciones.';
        END IF;
    END IF;

    SELECT status, role, default_store_id INTO v_target_status, v_target_role, v_default_store_id
    FROM public.profiles
    WHERE id = p_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Usuario no encontrado.';
    END IF;

    IF v_target_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'El usuario debe estar aprobado.';
    END IF;

    IF v_target_role IS DISTINCT FROM 'technician' THEN
        RAISE EXCEPTION 'Solo se pueden mover técnicos entre locales (admin y coordinador tienen acceso por rol).';
    END IF;

    IF p_from_store_id = p_to_store_id THEN
        RAISE EXCEPTION 'El local de destino debe ser distinto al de origen.';
    END IF;

    SELECT is_active INTO v_store_active FROM public.stores WHERE id = p_to_store_id;
    IF v_store_active IS NULL OR NOT v_store_active THEN
        RAISE EXCEPTION 'El local de destino debe ser un local activo.';
    END IF;

    -- Validar que el técnico tenga una asignación activa permanente en el local origen
    SELECT id INTO v_perm_assignment_id
    FROM public.user_stores
    WHERE user_id = p_user_id
      AND store_id = p_from_store_id
      AND starts_at <= NOW()
      AND ends_at IS NULL
    LIMIT 1;

    IF v_perm_assignment_id IS NULL THEN
        RAISE EXCEPTION 'El usuario no posee una asignación permanente activa en el local de origen.';
    END IF;

    -- Validar que no tenga ya asignación activa en destino
    IF EXISTS (
        SELECT 1 FROM public.user_stores
        WHERE user_id = p_user_id
          AND store_id = p_to_store_id
          AND starts_at <= NOW()
          AND (ends_at IS NULL OR ends_at > NOW())
    ) THEN
        RAISE EXCEPTION 'El usuario ya cuenta con una asignación activa en el local de destino.';
    END IF;

    PERFORM set_config('app.store_assignment_modifying', 'true', true);

    -- 1. Cerrar asignación de origen
    UPDATE public.user_stores
    SET ends_at = NOW(),
        ended_by = COALESCE(v_actor_id, p_user_id)
    WHERE id = v_perm_assignment_id;

    -- 2. Crear asignación permanente nueva en destino
    INSERT INTO public.user_stores (
        user_id,
        store_id,
        starts_at,
        ends_at,
        assigned_by
    ) VALUES (
        p_user_id,
        p_to_store_id,
        NOW() - INTERVAL '1 millisecond',
        NULL,
        COALESCE(v_actor_id, p_user_id)
    );

    PERFORM set_config('app.store_assignment_modifying', 'false', true);

    -- 3. Si profiles.default_store_id era el local de origen, pasa al de destino
    IF v_default_store_id = p_from_store_id THEN
        PERFORM set_config('app.profile_system_modifying', 'true', true);
        UPDATE public.profiles
        SET default_store_id = p_to_store_id,
            updated_at = now()
        WHERE id = p_user_id;
        PERFORM set_config('app.profile_system_modifying', 'false', true);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para cerrar petición de repuesto
CREATE OR REPLACE FUNCTION public.close_stock_request(p_request_id UUID)
RETURNS VOID AS $$
DECLARE
    v_requester_id UUID;
    v_status VARCHAR(20);
    v_actor_id UUID := auth.uid();
    v_actor_role user_role := public.get_auth_role();
BEGIN
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Acceso denegado: se requiere usuario autenticado.';
    END IF;

    IF NOT public.is_user_approved() THEN
        RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
    END IF;

    SELECT requester_id, status INTO v_requester_id, v_status
    FROM public.stock_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Petición no encontrada.';
    END IF;

    IF v_status = 'closed' THEN
        RAISE EXCEPTION 'La petición ya se encuentra cerrada.';
    END IF;

    IF v_actor_id <> v_requester_id AND v_actor_role IS DISTINCT FROM 'admin' AND v_actor_role IS DISTINCT FROM 'coordinator' THEN
        RAISE EXCEPTION 'Acceso denegado: solo el creador, el coordinador o el admin pueden cerrar la petición.';
    END IF;

    PERFORM set_config('app.stock_request_modifying', 'true', true);

    UPDATE public.stock_requests
    SET status = 'closed',
        closed_by = v_actor_id,
        closed_at = now()
    WHERE id = p_request_id;

    PERFORM set_config('app.stock_request_modifying', 'false', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para archivar anuncio (admin o coordinador)
CREATE OR REPLACE FUNCTION public.archive_announcement(p_id UUID)
RETURNS VOID AS $$
DECLARE
    v_actor_role user_role := public.get_auth_role();
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NOT public.is_user_approved() THEN
            RAISE EXCEPTION 'Acceso denegado: el usuario no está aprobado.';
        END IF;

        IF v_actor_role IS DISTINCT FROM 'admin' AND v_actor_role IS DISTINCT FROM 'coordinator' THEN
            RAISE EXCEPTION 'Acceso denegado: solo admin o coordinador pueden archivar anuncios.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Acceso denegado: se requiere usuario autenticado.';
    END IF;

    PERFORM set_config('app.announcement_modifying', 'true', true);

    UPDATE public.announcements
    SET archived_at = now()
    WHERE id = p_id AND archived_at IS NULL;

    IF NOT FOUND THEN
        PERFORM set_config('app.announcement_modifying', 'false', true);
        RAISE EXCEPTION 'Anuncio no encontrado o ya archivado.';
    END IF;

    PERFORM set_config('app.announcement_modifying', 'false', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Función para marcar anuncio como leído
CREATE OR REPLACE FUNCTION public.mark_announcement_read(p_id UUID)
RETURNS VOID AS $$
DECLARE
    v_actor_id UUID := auth.uid();
    v_actor_role user_role := public.get_auth_role();
    v_target_type VARCHAR(20);
    v_target_store_id UUID;
    v_target_user_id UUID;
    v_archived_at TIMESTAMPTZ;
    v_can_view BOOLEAN := false;
BEGIN
    IF v_actor_id IS NULL OR NOT public.is_user_approved() THEN
        RAISE EXCEPTION 'Acceso denegado: el usuario no está autenticado y aprobado.';
    END IF;

    SELECT target_type, target_store_id, target_user_id, archived_at
    INTO v_target_type, v_target_store_id, v_target_user_id, v_archived_at
    FROM public.announcements
    WHERE id = p_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Anuncio no encontrado.';
    END IF;

    IF v_actor_role IS NOT DISTINCT FROM 'admin' OR v_actor_role IS NOT DISTINCT FROM 'coordinator' THEN
        v_can_view := true;
    ELSIF v_archived_at IS NULL THEN
        IF v_target_type = 'all' THEN
            v_can_view := true;
        ELSIF v_target_type = 'store' AND public.user_has_store_access(v_target_store_id) THEN
            v_can_view := true;
        ELSIF v_target_type = 'user' AND v_target_user_id = v_actor_id THEN
            v_can_view := true;
        END IF;
    END IF;

    IF NOT v_can_view THEN
        RAISE EXCEPTION 'Acceso denegado: el anuncio no es visible para el usuario.';
    END IF;

    INSERT INTO public.announcement_reads (announcement_id, user_id, read_at)
    VALUES (p_id, v_actor_id, now())
    ON CONFLICT (announcement_id, user_id) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 8. ROW LEVEL SECURITY (RLS) & PRIVILEGES

ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_change_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.part_equivalencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meter_reading_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_request_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_monthly_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Revocar todos los permisos de anon sobre todas las tablas, vistas y secuencias de public
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;

-- Revocaciones de mutación sobre tablas protegidas y append-only
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.stock_movements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.meter_reading_edits FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.store_inventory FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_status_history FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_stores FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.stock_requests FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.stock_request_views FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.announcements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.announcement_reads FROM anon, authenticated;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;

-- Permisos por columna en profiles: solo full_name y default_store_id
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT UPDATE (full_name, default_store_id) ON public.profiles TO authenticated;

-- Permisos sobre tablas con mutaciones permitidas desde la app
GRANT SELECT, INSERT ON public.stock_requests TO authenticated;
GRANT SELECT, INSERT ON public.stock_request_views TO authenticated;
GRANT SELECT, INSERT ON public.announcements TO authenticated;
GRANT SELECT ON public.announcement_reads TO authenticated;
GRANT SELECT ON public.user_stores TO authenticated;
GRANT SELECT ON public.user_status_history TO authenticated;

-- Permisos sobre la vista profiles_directory (A2: revocación total y solo SELECT a authenticated)
REVOKE ALL ON public.profiles_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles_directory TO authenticated;

-- Revocación de privilegios por defecto en funciones para PUBLIC, anon, authenticated y service_role (A3)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- Otorgar EXECUTE exclusivo a service_role en funciones de sistema
GRANT EXECUTE ON FUNCTION public.register_stock_movement_system(UUID, UUID, stock_movement_type, NUMERIC, TEXT, VARCHAR, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.revert_expired_roles() TO service_role;

-- authenticated conserva EXECUTE solo en la lista autorizada
GRANT EXECUTE ON FUNCTION public.get_auth_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_approved() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_buenos_aires_date() TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_store_access(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_stock_movement(UUID, UUID, stock_movement_type, NUMERIC, TEXT, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_user(UUID, user_role, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_status(UUID, user_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_user_role(UUID, user_role, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_store(UUID, UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.end_store_assignment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_user_store(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_stock_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_announcement_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_announcement(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_readings_today() TO authenticated;

-- 8.1 POLICIES: stores (sin DELETE para roles de app)
DROP POLICY IF EXISTS "Stores select for approved users" ON public.stores;
CREATE POLICY "Stores select for approved users"
ON public.stores FOR SELECT
TO authenticated
USING (public.is_user_approved());

DROP POLICY IF EXISTS "Stores insert policy" ON public.stores;
CREATE POLICY "Stores insert policy"
ON public.stores FOR INSERT
TO authenticated
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "Stores update policy" ON public.stores;
CREATE POLICY "Stores update policy"
ON public.stores FOR UPDATE
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'))
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.2 POLICIES: profiles
DROP POLICY IF EXISTS "Profiles select policy" ON public.profiles;
CREATE POLICY "Profiles select policy"
ON public.profiles FOR SELECT
TO authenticated
USING (
    id = auth.uid() OR public.get_auth_role() IN ('admin', 'coordinator')
);

DROP POLICY IF EXISTS "Profiles update policy" ON public.profiles;
CREATE POLICY "Profiles update policy"
ON public.profiles FOR UPDATE
TO authenticated
USING (
    id = auth.uid() OR public.get_auth_role() IN ('admin', 'coordinator')
)
WITH CHECK (
    id = auth.uid() OR public.get_auth_role() IN ('admin', 'coordinator')
);

-- 8.3 POLICIES: user_stores
DROP POLICY IF EXISTS "User stores select policy" ON public.user_stores;
CREATE POLICY "User stores select policy"
ON public.user_stores FOR SELECT
TO authenticated
USING (
    user_id = auth.uid() OR public.get_auth_role() IN ('admin', 'coordinator')
);

-- 8.4 POLICIES: role_change_history
DROP POLICY IF EXISTS "Role history visible to admin" ON public.role_change_history;
CREATE POLICY "Role history visible to admin"
ON public.role_change_history FOR SELECT
TO authenticated
USING (public.get_auth_role() = 'admin');

-- 8.5 POLICIES: user_status_history
DROP POLICY IF EXISTS "User status history select policy" ON public.user_status_history;
CREATE POLICY "User status history select policy"
ON public.user_status_history FOR SELECT
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.6 POLICIES: invitations (SELECT, INSERT, UPDATE, sin DELETE)
DROP POLICY IF EXISTS "Invitations manage by admin and coordinator" ON public.invitations;
DROP POLICY IF EXISTS "Invitations select policy" ON public.invitations;
CREATE POLICY "Invitations select policy"
ON public.invitations FOR SELECT
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "Invitations insert policy" ON public.invitations;
CREATE POLICY "Invitations insert policy"
ON public.invitations FOR INSERT
TO authenticated
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "Invitations update policy" ON public.invitations;
CREATE POLICY "Invitations update policy"
ON public.invitations FOR UPDATE
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'))
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.7 POLICIES: part_categories (sin DELETE para roles de app)
DROP POLICY IF EXISTS "Categories select for approved users" ON public.part_categories;
CREATE POLICY "Categories select for approved users"
ON public.part_categories FOR SELECT
TO authenticated
USING (public.is_user_approved());

DROP POLICY IF EXISTS "Categories insert policy" ON public.part_categories;
CREATE POLICY "Categories insert policy"
ON public.part_categories FOR INSERT
TO authenticated
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "Categories update policy" ON public.part_categories;
CREATE POLICY "Categories update policy"
ON public.part_categories FOR UPDATE
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'))
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.8 POLICIES: spare_parts (sin DELETE para roles de app)
DROP POLICY IF EXISTS "Spare parts select for approved users" ON public.spare_parts;
CREATE POLICY "Spare parts select for approved users"
ON public.spare_parts FOR SELECT
TO authenticated
USING (public.is_user_approved());

DROP POLICY IF EXISTS "Spare parts insert policy" ON public.spare_parts;
CREATE POLICY "Spare parts insert policy"
ON public.spare_parts FOR INSERT
TO authenticated
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "Spare parts update policy" ON public.spare_parts;
CREATE POLICY "Spare parts update policy"
ON public.spare_parts FOR UPDATE
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'))
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.9 POLICIES: part_equivalencies
DROP POLICY IF EXISTS "Equivalencies select for approved users" ON public.part_equivalencies;
CREATE POLICY "Equivalencies select for approved users"
ON public.part_equivalencies FOR SELECT
TO authenticated
USING (public.is_user_approved());

DROP POLICY IF EXISTS "Equivalencies manage by admin or coordinator" ON public.part_equivalencies;
CREATE POLICY "Equivalencies manage by admin or coordinator"
ON public.part_equivalencies FOR ALL
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'))
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.10 POLICIES: meter_readings
DROP POLICY IF EXISTS "Meter readings select policy" ON public.meter_readings;
CREATE POLICY "Meter readings select policy"
ON public.meter_readings FOR SELECT
TO authenticated
USING (
    public.is_user_approved() AND (
        public.get_auth_role() IN ('admin', 'coordinator')
        OR (
            reading_date = public.get_buenos_aires_date()
            AND public.user_has_store_access(store_id)
        )
    )
);

DROP POLICY IF EXISTS "Meter readings insert policy" ON public.meter_readings;
CREATE POLICY "Meter readings insert policy"
ON public.meter_readings FOR INSERT
TO authenticated
WITH CHECK (
    public.is_user_approved() 
    AND reading_date = public.get_buenos_aires_date()
    AND public.user_has_store_access(store_id)
);

DROP POLICY IF EXISTS "Meter readings update policy" ON public.meter_readings;
CREATE POLICY "Meter readings update policy"
ON public.meter_readings FOR UPDATE
TO authenticated
USING (
    public.is_user_approved() 
    AND reading_date = public.get_buenos_aires_date()
    AND public.user_has_store_access(store_id)
)
WITH CHECK (
    public.is_user_approved() 
    AND reading_date = public.get_buenos_aires_date()
    AND public.user_has_store_access(store_id)
);

-- 8.11 POLICIES: meter_reading_edits
DROP POLICY IF EXISTS "Meter reading edits select policy" ON public.meter_reading_edits;
CREATE POLICY "Meter reading edits select policy"
ON public.meter_reading_edits FOR SELECT
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.12 POLICIES: store_inventory (solo locales con acceso activo)
DROP POLICY IF EXISTS "Inventory select for approved users" ON public.store_inventory;
CREATE POLICY "Inventory select for approved users"
ON public.store_inventory FOR SELECT
TO authenticated
USING (public.user_has_store_access(store_id));

-- 8.13 POLICIES: stock_movements (solo locales con acceso activo)
DROP POLICY IF EXISTS "Stock movements select for approved users" ON public.stock_movements;
CREATE POLICY "Stock movements select for approved users"
ON public.stock_movements FOR SELECT
TO authenticated
USING (public.user_has_store_access(store_id));

-- 8.14 POLICIES: stock_requests
DROP POLICY IF EXISTS "Stock requests select policy" ON public.stock_requests;
CREATE POLICY "Stock requests select policy"
ON public.stock_requests FOR SELECT
TO authenticated
USING (public.is_user_approved());

DROP POLICY IF EXISTS "Stock requests insert policy" ON public.stock_requests;
CREATE POLICY "Stock requests insert policy"
ON public.stock_requests FOR INSERT
TO authenticated
WITH CHECK (
    public.is_user_approved()
    AND public.user_has_store_access(store_id)
);

-- 8.15 POLICIES: stock_request_views
DROP POLICY IF EXISTS "Stock request views select policy" ON public.stock_request_views;
CREATE POLICY "Stock request views select policy"
ON public.stock_request_views FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Stock request views insert policy" ON public.stock_request_views;
CREATE POLICY "Stock request views insert policy"
ON public.stock_request_views FOR INSERT
TO authenticated
WITH CHECK (
    user_id = auth.uid()
    AND public.is_user_approved()
);

-- 8.16 POLICIES: announcements
DROP POLICY IF EXISTS "Announcements select policy" ON public.announcements;
CREATE POLICY "Announcements select policy"
ON public.announcements FOR SELECT
TO authenticated
USING (
    public.get_auth_role() IN ('admin', 'coordinator')
    OR (
        public.is_user_approved()
        AND archived_at IS NULL
        AND (
            target_type = 'all'
            OR (target_type = 'store' AND public.user_has_store_access(target_store_id))
            OR (target_type = 'user' AND target_user_id = auth.uid())
        )
    )
);

DROP POLICY IF EXISTS "Announcements insert policy" ON public.announcements;
CREATE POLICY "Announcements insert policy"
ON public.announcements FOR INSERT
TO authenticated
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.17 POLICIES: announcement_reads
DROP POLICY IF EXISTS "Announcement reads select policy" ON public.announcement_reads;
CREATE POLICY "Announcement reads select policy"
ON public.announcement_reads FOR SELECT
TO authenticated
USING (
    user_id = auth.uid()
    OR public.get_auth_role() IN ('admin', 'coordinator')
);

-- 8.18 POLICIES: store_monthly_targets (SELECT, INSERT, UPDATE, sin DELETE)
DROP POLICY IF EXISTS "Monthly targets select for approved users" ON public.store_monthly_targets;
CREATE POLICY "Monthly targets select for approved users"
ON public.store_monthly_targets FOR SELECT
TO authenticated
USING (public.is_user_approved());

DROP POLICY IF EXISTS "Monthly targets manage by admin or coordinator" ON public.store_monthly_targets;
DROP POLICY IF EXISTS "Monthly targets insert policy" ON public.store_monthly_targets;
CREATE POLICY "Monthly targets insert policy"
ON public.store_monthly_targets FOR INSERT
TO authenticated
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "Monthly targets update policy" ON public.store_monthly_targets;
CREATE POLICY "Monthly targets update policy"
ON public.store_monthly_targets FOR UPDATE
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'))
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 8.19 POLICIES: app_config (SELECT, INSERT, UPDATE, sin DELETE)
DROP POLICY IF EXISTS "App config select for approved users" ON public.app_config;
CREATE POLICY "App config select for approved users"
ON public.app_config FOR SELECT
TO authenticated
USING (public.is_user_approved());

DROP POLICY IF EXISTS "App config manage by admin or coordinator" ON public.app_config;
DROP POLICY IF EXISTS "App config insert policy" ON public.app_config;
CREATE POLICY "App config insert policy"
ON public.app_config FOR INSERT
TO authenticated
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

DROP POLICY IF EXISTS "App config update policy" ON public.app_config;
CREATE POLICY "App config update policy"
ON public.app_config FOR UPDATE
TO authenticated
USING (public.get_auth_role() IN ('admin', 'coordinator'))
WITH CHECK (public.get_auth_role() IN ('admin', 'coordinator'));

-- 9. REALTIME PUBLICATION
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_requests;
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE public.announcements;
        EXCEPTION WHEN duplicate_object THEN
            NULL;
        END;
    END IF;
END $$;
