-- ==============================================================================
-- MCDONALD'S PWA MAINTENANCE & INVENTORY - AUTOMATED TEST SUITE
-- Engine: PostgreSQL 15+ (Supabase)
-- ==============================================================================
-- ADVERTENCIA OBLIGATORIA:
-- Esta suite de pruebas debe ejecutarse EXCLUSIVAMENTE en una base de datos
-- de pruebas o entorno de desarrollo / CI. NUNCA en producción.
--
-- Reglas de diseño:
-- 1. Sin WHEN OTHERS genérico: errores verificados por SQLSTATE y mensaje exacto/patrón.
-- 2. Separación estricta entre ejecución y aserción (sin RAISE dentro de WHEN OTHERS).
-- 3. Verificación de no-mutación de estado en fallas + controles positivos.
-- 4. Validación estricta de sesión simulada (current_user = 'authenticated' y auth.uid()).
-- 5. Usuarios creados únicamente vía auth.users con perfil generado por trigger.
-- 6. No destructiva: cada prueba aislada en BEGIN ... ROLLBACK sin tocar datos externos.
-- 7. Los helpers viven en esquema test_support sin EXECUTE para authenticated y se eliminan al final.
-- 8. Salida con PASS/FAIL por prueba y resumen final con totales.
-- 9. Violación de clave foránea espera SQLSTATE 23503.
-- ==============================================================================

SET client_min_messages TO notice;

-- ==============================================================================
-- 0. INFRAESTRUCTURA DE PRUEBAS Y HELPERS (ESQUEMA test_support)
-- ==============================================================================

DROP SCHEMA IF EXISTS test_support CASCADE;
CREATE SCHEMA test_support;

CREATE SEQUENCE test_support.test_pass_seq;
CREATE SEQUENCE test_support.test_fail_seq;

DO $$
BEGIN
    PERFORM setval('test_support.test_pass_seq', 1, false);
    PERFORM setval('test_support.test_fail_seq', 1, false);
END $$;

-- Helper: Registro de PASS
CREATE OR REPLACE FUNCTION test_support.record_pass(p_test_name TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = test_support, pg_temp AS $$
BEGIN
    PERFORM nextval('test_support.test_pass_seq');
    RAISE NOTICE 'PASS - %', p_test_name;
END;
$$;

-- Helper: Registro de FAIL
CREATE OR REPLACE FUNCTION test_support.record_fail(p_test_name TEXT, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = test_support, pg_temp AS $$
BEGIN
    PERFORM nextval('test_support.test_fail_seq');
    RAISE NOTICE 'FAIL - %: %', p_test_name, p_reason;
END;
$$;

-- Helper: Crear usuario de prueba vía auth.users
CREATE OR REPLACE FUNCTION test_support.create_user(
    p_email TEXT,
    p_role public.user_role DEFAULT NULL,
    p_status public.user_status DEFAULT 'pending',
    p_store_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_user_id UUID := gen_random_uuid();
BEGIN
    INSERT INTO auth.users (id, email) VALUES (v_user_id, p_email);

    IF p_status <> 'pending' OR p_role IS NOT NULL OR p_store_id IS NOT NULL THEN
        PERFORM set_config('app.profile_system_modifying', 'true', true);

        IF p_store_id IS NOT NULL THEN
            PERFORM set_config('app.store_assignment_modifying', 'true', true);
            INSERT INTO public.user_stores (user_id, store_id, starts_at, ends_at, assigned_by)
            VALUES (v_user_id, p_store_id, NOW() - INTERVAL '1 day', NULL, v_user_id)
            ON CONFLICT DO NOTHING;
            PERFORM set_config('app.store_assignment_modifying', 'false', true);
        END IF;

        UPDATE public.profiles
        SET status = p_status,
            role = p_role,
            default_store_id = p_store_id,
            approved_by = CASE WHEN p_status = 'approved' THEN v_user_id ELSE NULL END,
            approved_at = CASE WHEN p_status = 'approved' THEN NOW() ELSE NULL END
        WHERE id = v_user_id;

        PERFORM set_config('app.profile_system_modifying', 'false', true);
    END IF;

    RETURN v_user_id;
END;
$$;

-- Helper: Crear local de prueba
CREATE OR REPLACE FUNCTION test_support.create_store(
    p_code TEXT,
    p_name TEXT,
    p_multiplier NUMERIC DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_id UUID := gen_random_uuid();
BEGIN
    INSERT INTO public.stores (id, code, name, meter_multiplier, is_active)
    VALUES (v_id, UPPER(p_code), p_name, p_multiplier, p_is_active);
    RETURN v_id;
END;
$$;

-- Helper: Crear repuesto de prueba en categoría aislada
CREATE OR REPLACE FUNCTION test_support.create_part(
    p_name TEXT,
    p_unit TEXT DEFAULT 'unit',
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    v_cat_id UUID;
    v_part_id UUID := gen_random_uuid();
BEGIN
    INSERT INTO public.part_categories (name, description)
    VALUES ('Cat ' || gen_random_uuid(), 'Categoría de prueba')
    RETURNING id INTO v_cat_id;

    INSERT INTO public.spare_parts (id, name, category_id, unit, is_active)
    VALUES (v_part_id, p_name, v_cat_id, p_unit, p_is_active);

    RETURN v_part_id;
END;
$$;


-- Helper: Ejecutar sentencia esperando un error específico bajo un usuario autenticado
CREATE OR REPLACE FUNCTION test_support.expect_error_as(
    p_user_id UUID,
    p_sql TEXT,
    p_expected_sqlstate TEXT DEFAULT NULL,
    p_expected_msg_pattern TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_sqlstate TEXT;
    v_sqlerrm TEXT;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);

    IF current_user <> 'authenticated' THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: current_user (%) no es "authenticated"', current_user;
    END IF;

    IF auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: auth.uid() (%) <> p_user_id (%)', auth.uid(), p_user_id;
    END IF;

    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
            v_sqlstate = RETURNED_SQLSTATE,
            v_sqlerrm = MESSAGE_TEXT;
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claim.sub', '', true);
        PERFORM set_config('request.jwt.claim.role', '', true);
        PERFORM set_config('request.jwt.claims', '', true);

        IF p_expected_sqlstate IS NOT NULL AND v_sqlstate <> p_expected_sqlstate THEN
            RAISE EXCEPTION 'SQLSTATE inesperado: esperado %, obtenido % (Mensaje: %)', 
                p_expected_sqlstate, v_sqlstate, v_sqlerrm;
        END IF;

        IF p_expected_msg_pattern IS NOT NULL AND v_sqlerrm NOT ILIKE '%' || p_expected_msg_pattern || '%' THEN
            RAISE EXCEPTION 'Mensaje inesperado: esperado "%", obtenido "%" (SQLSTATE %)', 
                p_expected_msg_pattern, v_sqlerrm, v_sqlstate;
        END IF;

        RETURN TRUE;
    END;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN FALSE;
END;
$$;

-- Helper: Ejecutar sentencia esperando un error específico bajo rol anon
CREATE OR REPLACE FUNCTION test_support.expect_error_as_anon(
    p_sql TEXT,
    p_expected_sqlstate TEXT DEFAULT NULL,
    p_expected_msg_pattern TEXT DEFAULT NULL
)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_sqlstate TEXT;
    v_sqlerrm TEXT;
BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

    IF current_user <> 'anon' THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: current_user (%) no es "anon"', current_user;
    END IF;

    IF auth.uid() IS NOT NULL THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: auth.uid() no es NULL';
    END IF;

    BEGIN
        EXECUTE p_sql;
    EXCEPTION WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS
            v_sqlstate = RETURNED_SQLSTATE,
            v_sqlerrm = MESSAGE_TEXT;
        EXECUTE 'RESET ROLE';
        PERFORM set_config('request.jwt.claim.sub', '', true);
        PERFORM set_config('request.jwt.claim.role', '', true);
        PERFORM set_config('request.jwt.claims', '', true);

        IF p_expected_sqlstate IS NOT NULL AND v_sqlstate <> p_expected_sqlstate THEN
            RAISE EXCEPTION 'SQLSTATE inesperado: esperado %, obtenido % (Mensaje: %)', 
                p_expected_sqlstate, v_sqlstate, v_sqlerrm;
        END IF;

        IF p_expected_msg_pattern IS NOT NULL AND v_sqlerrm NOT ILIKE '%' || p_expected_msg_pattern || '%' THEN
            RAISE EXCEPTION 'Mensaje inesperado: esperado "%", obtenido "%" (SQLSTATE %)', 
                p_expected_msg_pattern, v_sqlerrm, v_sqlstate;
        END IF;

        RETURN TRUE;
    END;

    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN FALSE;
END;
$$;

-- Helper: Ejecutar acción autorizada bajo un usuario autenticado (Control positivo)
CREATE OR REPLACE FUNCTION test_support.run_as(
    p_user_id UUID,
    p_sql TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);

    IF current_user <> 'authenticated' THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: current_user (%) no es "authenticated"', current_user;
    END IF;

    IF auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: auth.uid() (%) <> p_user_id (%)', auth.uid(), p_user_id;
    END IF;

    EXECUTE p_sql;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

-- Helper: Contar filas visibles bajo un usuario autenticado
CREATE OR REPLACE FUNCTION test_support.count_as(
    p_user_id UUID,
    p_query TEXT
)
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_count INT;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);

    IF current_user <> 'authenticated' THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: current_user (%) no es "authenticated"', current_user;
    END IF;

    IF auth.uid() IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: auth.uid() (%) <> p_user_id (%)', auth.uid(), p_user_id;
    END IF;

    EXECUTE p_query INTO v_count;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN v_count;
END;
$$;

-- Helper: Contar filas visibles bajo rol anon
CREATE OR REPLACE FUNCTION test_support.count_as_anon(
    p_query TEXT
)
RETURNS INT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_count INT;
BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', 'anon', true);
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);

    IF current_user <> 'anon' THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: current_user (%) no es "anon"', current_user;
    END IF;

    EXECUTE p_query INTO v_count;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN v_count;
END;
$$;

-- Helper: Obtener texto escalar bajo un usuario autenticado
CREATE OR REPLACE FUNCTION test_support.scalar_text_as(
    p_user_id UUID,
    p_query TEXT
)
RETURNS TEXT LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_res TEXT;
BEGIN
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
    PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text, true);

    IF current_user <> 'authenticated' THEN
        RAISE EXCEPTION 'Verificación de sesión fallida: current_user (%) no es "authenticated"', current_user;
    END IF;

    EXECUTE p_query INTO v_res;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claim.sub', '', true);
    PERFORM set_config('request.jwt.claim.role', '', true);
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN v_res;
END;
$$;

-- Aislamiento estricto: revocar todo acceso al esquema test_support
REVOKE ALL ON SCHEMA test_support FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA test_support FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA test_support FROM PUBLIC, anon, authenticated;

-- ==============================================================================
-- 1. PENDIENTE: AISLAMIENTO TOTAL Y BLOQUEO DE AUTO-APROBACIÓN
-- ==============================================================================

-- 1.1: Pendiente: aislamiento total (no lee otras tablas ni perfiles ajenos)
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Pendiente: aislamiento total de datos';
    v_pending_id UUID;
    v_store_id UUID;
    v_part_id UUID;
    v_count INT;
BEGIN
    v_store_id := test_support.create_store('P01', 'Store P1', 40.0);
    v_part_id := test_support.create_part('Part P1', 'unit');
    v_pending_id := test_support.create_user('pend_iso@mcd.com', NULL, 'pending');

    v_count := test_support.count_as(v_pending_id, format('SELECT COUNT(*) FROM public.stores WHERE id = %L', v_store_id));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Pendiente vio % stores', v_count; END IF;

    v_count := test_support.count_as(v_pending_id, format('SELECT COUNT(*) FROM public.spare_parts WHERE id = %L', v_part_id));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Pendiente vio % spare_parts', v_count; END IF;

    v_count := test_support.count_as(v_pending_id, format('SELECT COUNT(*) FROM public.store_inventory WHERE store_id = %L', v_store_id));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Pendiente vio % store_inventory', v_count; END IF;

    v_count := test_support.count_as(v_pending_id, format('SELECT COUNT(*) FROM public.profiles_directory WHERE id = %L', v_pending_id));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Pendiente vio % profiles_directory', v_count; END IF;

    v_count := test_support.count_as(v_pending_id, format('SELECT COUNT(*) FROM public.profiles WHERE id = %L', v_pending_id));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Pendiente no pudo leer exactamente su propio perfil (count: %)', v_count; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 1.2: Pendiente: no puede auto-aprobarse mediante UPDATE directo sobre profiles
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Pendiente: rechazo de auto-aprobación por UPDATE directo';
    v_pending_id UUID;
    v_admin_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
    v_role public.user_role;
BEGIN
    v_store_id := test_support.create_store('P02', 'Store P2', 40.0);
    v_admin_id := test_support.create_user('admin_p02@mcd.com', 'admin', 'approved');
    v_pending_id := test_support.create_user('pend_upd@mcd.com', NULL, 'pending');

    v_blocked := test_support.expect_error_as(
        v_pending_id,
        format('UPDATE public.profiles SET status = ''approved'', role = ''technician'' WHERE id = %L', v_pending_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Pendiente actualizó profiles directamente'; END IF;

    SELECT status, role INTO v_status, v_role FROM public.profiles WHERE id = v_pending_id;
    IF v_status <> 'pending' OR v_role IS NOT NULL THEN
        RAISE EXCEPTION 'Estado alterado: status=%, role=%', v_status, v_role;
    END IF;

    -- Control positivo: admin aprueba al usuario
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_pending_id, v_store_id)
    );

    SELECT status, role INTO v_status, v_role FROM public.profiles WHERE id = v_pending_id;
    IF v_status <> 'approved' OR v_role <> 'technician' THEN
        RAISE EXCEPTION 'Control positivo falló: admin no pudo aprobar usuario';
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 1.3: Pendiente: no puede auto-aprobarse mediante approve_user
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Pendiente: rechazo de auto-aprobación por approve_user';
    v_pending_id UUID;
    v_admin_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
    v_role public.user_role;
BEGIN
    v_store_id := test_support.create_store('P03', 'Store P3', 40.0);
    v_admin_id := test_support.create_user('admin_p03@mcd.com', 'admin', 'approved');
    v_pending_id := test_support.create_user('pend_app@mcd.com', NULL, 'pending');

    v_blocked := test_support.expect_error_as(
        v_pending_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_pending_id, v_store_id),
        'P0001',
        'Acceso denegado'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Pendiente llamó approve_user'; END IF;

    SELECT status, role INTO v_status, v_role FROM public.profiles WHERE id = v_pending_id;
    IF v_status <> 'pending' OR v_role IS NOT NULL THEN
        RAISE EXCEPTION 'Estado alterado: status=%, role=%', v_status, v_role;
    END IF;

    -- Control positivo: admin sí aprueba
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_pending_id, v_store_id)
    );

    SELECT status, role INTO v_status, v_role FROM public.profiles WHERE id = v_pending_id;
    IF v_status <> 'approved' OR v_role <> 'technician' THEN
        RAISE EXCEPTION 'Control positivo falló: admin no pudo aprobar usuario';
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 2. ROLES: SEGREGACIÓN ESTRICTA (TÉCNICO, COORDINADOR, ADMIN)
-- ==============================================================================

-- 2.1: Roles: técnico no puede llamar a approve_user
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Roles: técnico no puede llamar a approve_user';
    v_tech_id UUID;
    v_target_id UUID;
    v_admin_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
BEGIN
    v_store_id := test_support.create_store('R01', 'Store R1', 40.0);
    v_tech_id := test_support.create_user('tech_r01@mcd.com', 'technician', 'approved', v_store_id);
    v_target_id := test_support.create_user('target_r01@mcd.com', NULL, 'pending');
    v_admin_id := test_support.create_user('admin_r01@mcd.com', 'admin', 'approved');

    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_target_id, v_store_id),
        'P0001',
        'Acceso denegado: solo admin o coordinador pueden aprobar usuarios'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico ejecutó approve_user'; END IF;

    SELECT status INTO v_status FROM public.profiles WHERE id = v_target_id;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'Estado alterado: target no quedó pending'; END IF;

    -- Control positivo: admin aprueba
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_target_id, v_store_id)
    );

    SELECT status INTO v_status FROM public.profiles WHERE id = v_target_id;
    IF v_status <> 'approved' THEN RAISE EXCEPTION 'Control positivo falló: admin no pudo aprobar'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 2.2: Roles: técnico no puede llamar a assign_user_role
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Roles: técnico no puede llamar a assign_user_role';
    v_tech_id UUID;
    v_target_id UUID;
    v_admin_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_role public.user_role;
BEGIN
    v_store_id := test_support.create_store('R02', 'Store R2', 40.0);
    v_tech_id := test_support.create_user('tech_r02@mcd.com', 'technician', 'approved', v_store_id);
    v_target_id := test_support.create_user('target_r02@mcd.com', 'technician', 'approved', v_store_id);
    v_admin_id := test_support.create_user('admin_r02@mcd.com', 'admin', 'approved');

    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.assign_user_role(%L, ''coordinator''::public.user_role)', v_target_id),
        'P0001',
        'Acceso denegado: solo un administrador puede cambiar roles'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico llamó assign_user_role'; END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = v_target_id;
    IF v_role <> 'technician' THEN RAISE EXCEPTION 'Rol alterado: target no es technician'; END IF;

    -- Control positivo: admin sí asigna rol
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.assign_user_role(%L, ''coordinator''::public.user_role)', v_target_id)
    );

    SELECT role INTO v_role FROM public.profiles WHERE id = v_target_id;
    IF v_role <> 'coordinator' THEN RAISE EXCEPTION 'Control positivo falló: admin no pudo cambiar rol'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 2.3: Roles: técnico no puede llamar a set_user_status
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Roles: técnico no puede llamar a set_user_status';
    v_tech_id UUID;
    v_target_id UUID;
    v_admin_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
BEGIN
    v_store_id := test_support.create_store('R03', 'Store R3', 40.0);
    v_tech_id := test_support.create_user('tech_r03@mcd.com', 'technician', 'approved', v_store_id);
    v_target_id := test_support.create_user('target_r03@mcd.com', 'technician', 'approved', v_store_id);
    v_admin_id := test_support.create_user('admin_r03@mcd.com', 'admin', 'approved');

    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_target_id),
        'P0001',
        'Acceso denegado: solo admin o coordinador pueden cambiar el estado'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico llamó set_user_status'; END IF;

    SELECT status INTO v_status FROM public.profiles WHERE id = v_target_id;
    IF v_status <> 'approved' THEN RAISE EXCEPTION 'Estado alterado: target no es approved'; END IF;

    -- Control positivo: admin desactiva usuario
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_target_id)
    );

    SELECT status INTO v_status FROM public.profiles WHERE id = v_target_id;
    IF v_status <> 'inactive' THEN RAISE EXCEPTION 'Control positivo falló: admin no pudo cambiar estado'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 2.4: Roles: coordinador no puede aprobar a un usuario como admin
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Roles: coordinador no puede aprobar como admin';
    v_coord_id UUID;
    v_target_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
    v_role public.user_role;
BEGIN
    v_store_id := test_support.create_store('R04', 'Store R4', 40.0);
    v_coord_id := test_support.create_user('coord_r04@mcd.com', 'coordinator', 'approved');
    v_target_id := test_support.create_user('target_r04@mcd.com', NULL, 'pending');

    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.approve_user(%L, ''admin''::public.user_role, %L)', v_target_id, v_store_id),
        'P0001',
        'Un coordinador solo puede aprobar usuarios con rol technician'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Coordinador aprobó a un admin'; END IF;

    SELECT status, role INTO v_status, v_role FROM public.profiles WHERE id = v_target_id;
    IF v_status <> 'pending' OR v_role IS NOT NULL THEN
        RAISE EXCEPTION 'Estado alterado: status=%, role=%', v_status, v_role;
    END IF;

    -- Control positivo: coordinador sí aprueba como technician
    PERFORM test_support.run_as(
        v_coord_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_target_id, v_store_id)
    );

    SELECT status, role INTO v_status, v_role FROM public.profiles WHERE id = v_target_id;
    IF v_status <> 'approved' OR v_role <> 'technician' THEN
        RAISE EXCEPTION 'Control positivo falló: coordinador no pudo aprobar como technician';
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 2.5: Roles: coordinador aprueba técnico con local obligatorio y asignación permanente creada
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Roles: técnico con local obligatorio al aprobar y asignación permanente';
    v_coord_id UUID;
    v_target_id UUID;
    v_target_id2 UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_has_access BOOLEAN;
    v_assigned_by UUID;
    v_ends_at TIMESTAMPTZ;
BEGIN
    v_store_id := test_support.create_store('R05', 'Store R5', 40.0);
    v_coord_id := test_support.create_user('coord_r05@mcd.com', 'coordinator', 'approved');
    v_target_id := test_support.create_user('target_r05_1@mcd.com', NULL, 'pending');
    v_target_id2 := test_support.create_user('target_r05_2@mcd.com', NULL, 'pending');

    -- Rechazo si no se especifica local por defecto
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, NULL)', v_target_id),
        'P0001',
        'Al aprobar un técnico, el local por defecto es obligatorio'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Coordinador aprobó técnico sin local'; END IF;

    -- Control positivo: aprueba con local
    PERFORM test_support.run_as(
        v_coord_id,
        format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_target_id2, v_store_id)
    );

    SELECT user_id IS NOT NULL, assigned_by, ends_at
    INTO v_has_access, v_assigned_by, v_ends_at
    FROM public.user_stores
    WHERE user_id = v_target_id2 AND store_id = v_store_id;

    IF NOT v_has_access OR v_ends_at IS NOT NULL OR v_assigned_by <> v_coord_id THEN
        RAISE EXCEPTION 'Asignación permanente inválida: access=%, ends_at=%, assigned_by=%', v_has_access, v_ends_at, v_assigned_by;
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 2.6: Roles: coordinador no puede cambiar roles de usuarios aprobados (assign_user_role)
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Roles: coordinador no puede llamar a assign_user_role';
    v_coord_id UUID;
    v_target_id UUID;
    v_admin_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_role public.user_role;
BEGIN
    v_store_id := test_support.create_store('R06', 'Store R6', 40.0);
    v_coord_id := test_support.create_user('coord_r06@mcd.com', 'coordinator', 'approved');
    v_target_id := test_support.create_user('target_r06@mcd.com', 'technician', 'approved', v_store_id);
    v_admin_id := test_support.create_user('admin_r06@mcd.com', 'admin', 'approved');

    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.assign_user_role(%L, ''coordinator''::public.user_role)', v_target_id),
        'P0001',
        'Acceso denegado: solo un administrador puede cambiar roles'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Coordinador llamó assign_user_role'; END IF;

    SELECT role INTO v_role FROM public.profiles WHERE id = v_target_id;
    IF v_role <> 'technician' THEN RAISE EXCEPTION 'Rol alterado: target no es technician'; END IF;

    -- Control positivo: admin sí cambia rol
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.assign_user_role(%L, ''coordinator''::public.user_role)', v_target_id)
    );

    SELECT role INTO v_role FROM public.profiles WHERE id = v_target_id;
    IF v_role <> 'coordinator' THEN RAISE EXCEPTION 'Control positivo falló: admin no cambió rol'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 3. VENCIMIENTO DE ROL TEMPORAL
-- ==============================================================================

-- 3.1: Rol temporal antes y después del vencimiento, historial y reversión física vía revert_expired_roles
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Rol temporal: expiración, historial y reversión física';
    v_admin_id UUID;
    v_target_id UUID;
    v_store_id UUID;
    v_effective_role public.user_role;
    v_db_role public.user_role;
    v_hist_count INT;
    v_reverted INT;
BEGIN
    v_store_id := test_support.create_store('T01', 'Store T1', 40.0);
    v_admin_id := test_support.create_user('admin_t01@mcd.com', 'admin', 'approved');
    v_target_id := test_support.create_user('target_t01@mcd.com', 'technician', 'approved', v_store_id);

    -- 1. Admin asigna rol temporal de coordinador con vencimiento futuro
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.assign_user_role(%L, ''coordinator''::public.user_role, NOW() + INTERVAL ''2 hours'')', v_target_id)
    );

    v_effective_role := test_support.scalar_text_as(v_target_id, 'SELECT public.get_auth_role()::text')::public.user_role;
    IF v_effective_role <> 'coordinator' THEN
        RAISE EXCEPTION 'Rol temporal falló: efectivo es %, esperado coordinator', v_effective_role;
    END IF;

    -- 2. Simular expiración temporal en la base
    PERFORM set_config('app.profile_system_modifying', 'true', true);
    UPDATE public.profiles
    SET role_expires_at = NOW() - INTERVAL '1 minute'
    WHERE id = v_target_id;
    PERFORM set_config('app.profile_system_modifying', 'false', true);

    v_effective_role := test_support.scalar_text_as(v_target_id, 'SELECT public.get_auth_role()::text')::public.user_role;
    IF v_effective_role <> 'technician' THEN
        RAISE EXCEPTION 'Expiración lógica falló: efectivo es %, esperado technician', v_effective_role;
    END IF;

    -- 3. Reversión física ejecutada por el sistema (postgres)
    v_reverted := public.revert_expired_roles();
    IF v_reverted < 1 THEN
        RAISE EXCEPTION 'revert_expired_roles devolvió %, esperado >= 1', v_reverted;
    END IF;

    SELECT role INTO v_db_role FROM public.profiles WHERE id = v_target_id;
    IF v_db_role <> 'technician' THEN
        RAISE EXCEPTION 'Reversión física en tabla profiles falló: role=%', v_db_role;
    END IF;

    -- 4. Verificar auditoría en role_change_history
    SELECT COUNT(*) INTO v_hist_count
    FROM public.role_change_history
    WHERE user_id = v_target_id;

    IF v_hist_count < 2 THEN
        RAISE EXCEPTION 'Historial incompleto: registros=%', v_hist_count;
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 4. SET_USER_STATUS Y AUDITORÍA
-- ==============================================================================

-- 4.1: set_user_status: coordinador solo modifica técnicos y no admin ni coordinador
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'set_user_status: restricciones de rol del coordinador';
    v_coord_id UUID;
    v_admin_id UUID;
    v_tech_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
BEGIN
    v_store_id := test_support.create_store('S01', 'Store S1', 40.0);
    v_coord_id := test_support.create_user('coord_s01@mcd.com', 'coordinator', 'approved');
    v_admin_id := test_support.create_user('admin_s01@mcd.com', 'admin', 'approved');
    v_tech_id := test_support.create_user('tech_s01@mcd.com', 'technician', 'approved', v_store_id);

    -- Coordinador intenta desactivar admin -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_admin_id),
        'P0001',
        'un coordinador solo puede modificar el estado de usuarios con rol technician'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Coordinador cambió estado de admin'; END IF;

    SELECT status INTO v_status FROM public.profiles WHERE id = v_admin_id;
    IF v_status <> 'approved' THEN RAISE EXCEPTION 'Estado alterado en admin'; END IF;

    -- Control positivo: coordinador desactiva técnico
    PERFORM test_support.run_as(
        v_coord_id,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_tech_id)
    );

    SELECT status INTO v_status FROM public.profiles WHERE id = v_tech_id;
    IF v_status <> 'inactive' THEN RAISE EXCEPTION 'Control positivo falló: coordinador no pudo desactivar técnico'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 4.2: set_user_status: transición pending a approved rechazada
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'set_user_status: pending a approved rechazado';
    v_admin_id UUID;
    v_pending_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
BEGIN
    v_admin_id := test_support.create_user('admin_s02@mcd.com', 'admin', 'approved');
    v_pending_id := test_support.create_user('pend_s02@mcd.com', NULL, 'pending');

    v_blocked := test_support.expect_error_as(
        v_admin_id,
        format('SELECT public.set_user_status(%L, ''approved''::public.user_status)', v_pending_id),
        'P0001',
        'usuarios en estado pending solo pueden aprobarse mediante approve_user'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: pending a approved permitido por set_user_status'; END IF;

    SELECT status INTO v_status FROM public.profiles WHERE id = v_pending_id;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'Estado alterado: target no es pending'; END IF;

    -- Control positivo: admin rechaza usuario pending mediante set_user_status
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.set_user_status(%L, ''rejected''::public.user_status)', v_pending_id)
    );

    SELECT status INTO v_status FROM public.profiles WHERE id = v_pending_id;
    IF v_status <> 'rejected' THEN RAISE EXCEPTION 'Control positivo falló: no se pudo rechazar usuario'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 4.3: set_user_status: nadie puede modificar su propio estado
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'set_user_status: nadie cambia su propio estado';
    v_admin_id UUID;
    v_other_tech_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
BEGIN
    v_store_id := test_support.create_store('S03', 'Store S3', 40.0);
    v_admin_id := test_support.create_user('admin_s03@mcd.com', 'admin', 'approved');
    v_other_tech_id := test_support.create_user('tech_s03@mcd.com', 'technician', 'approved', v_store_id);

    v_blocked := test_support.expect_error_as(
        v_admin_id,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_admin_id),
        'P0001',
        'nadie puede modificar su propio estado'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Admin modificó su propio estado'; END IF;

    SELECT status INTO v_status FROM public.profiles WHERE id = v_admin_id;
    IF v_status <> 'approved' THEN RAISE EXCEPTION 'Estado de admin alterado'; END IF;

    -- Control positivo: admin modifica estado de otro
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_other_tech_id)
    );

    SELECT status INTO v_status FROM public.profiles WHERE id = v_other_tech_id;
    IF v_status <> 'inactive' THEN RAISE EXCEPTION 'Control positivo falló'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 4.4: set_user_status: protección estricta del último administrador activo
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'set_user_status: protección del último admin activo';
    v_sole_admin_id UUID;
    v_admin_id1 UUID;
    v_admin_id2 UUID;
    v_blocked BOOLEAN;
    v_status public.user_status;
BEGIN
    -- Asegurar que solo haya 1 admin activo
    PERFORM set_config('app.profile_system_modifying', 'true', true);
    UPDATE public.profiles SET status = 'inactive' WHERE role = 'admin' AND status = 'approved';
    PERFORM set_config('app.profile_system_modifying', 'false', true);

    v_sole_admin_id := test_support.create_user('sole_admin@mcd.com', 'admin', 'approved');

    -- Se intenta desactivar al único admin activo (directamente como postgres)
    v_blocked := false;
    BEGIN
        PERFORM public.set_user_status(v_sole_admin_id, 'inactive'::public.user_status);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'P0001' AND SQLERRM ILIKE '%último administrador activo%' THEN
            v_blocked := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Se permitió desactivar al único admin'; END IF;

    SELECT status INTO v_status FROM public.profiles WHERE id = v_sole_admin_id;
    IF v_status <> 'approved' THEN RAISE EXCEPTION 'Estado del único admin alterado'; END IF;

    -- Control positivo: habiendo dos admins, uno sí puede desactivar al otro
    v_admin_id2 := test_support.create_user('admin_extra@mcd.com', 'admin', 'approved');
    PERFORM test_support.run_as(
        v_admin_id2,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_sole_admin_id)
    );

    SELECT status INTO v_status FROM public.profiles WHERE id = v_sole_admin_id;
    IF v_status <> 'inactive' THEN RAISE EXCEPTION 'Control positivo falló'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 4.5: set_user_status: auditoría append-only en user_status_history
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'set_user_status: auditoría en user_status_history';
    v_admin_id UUID;
    v_tech_id UUID;
    v_store_id UUID;
    v_hist_count INT;
    v_old_status public.user_status;
    v_new_status public.user_status;
    v_changed_by UUID;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('S05', 'Store S5', 40.0);
    v_admin_id := test_support.create_user('admin_s05@mcd.com', 'admin', 'approved');
    v_tech_id := test_support.create_user('tech_s05@mcd.com', 'technician', 'approved', v_store_id);

    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_tech_id)
    );

    SELECT old_status, new_status, changed_by INTO v_old_status, v_new_status, v_changed_by
    FROM public.user_status_history
    WHERE user_id = v_tech_id
    ORDER BY created_at DESC LIMIT 1;

    IF v_old_status <> 'approved' OR v_new_status <> 'inactive' OR v_changed_by <> v_admin_id THEN
        RAISE EXCEPTION 'Auditoría errónea: old=%, new=%, by=%', v_old_status, v_new_status, v_changed_by;
    END IF;

    -- Intento de mutación directa sobre user_status_history
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        'DELETE FROM public.user_status_history',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: DELETE sobre user_status_history permitido'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 5. EMAILS Y PRIVACIDAD DE PERFILES
-- ==============================================================================

-- 5.1: Emails: técnico no ve emails ajenos ni por tabla ni por vista; admin y coordinador ven todos
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Emails: privacidad estricta y visualización autorizada';
    v_tech_a UUID;
    v_tech_b UUID;
    v_admin_id UUID;
    v_coord_id UUID;
    v_store_id UUID;
    v_email TEXT;
    v_count INT;
BEGIN
    v_store_id := test_support.create_store('E01', 'Store E1', 40.0);
    v_tech_a := test_support.create_user('tech_a@mcd.com', 'technician', 'approved', v_store_id);
    v_tech_b := test_support.create_user('tech_b@mcd.com', 'technician', 'approved', v_store_id);
    v_admin_id := test_support.create_user('admin_e@mcd.com', 'admin', 'approved');
    v_coord_id := test_support.create_user('coord_e@mcd.com', 'coordinator', 'approved');

    -- 1. Técnico A intentando leer profiles de Técnico B -> 0 filas por RLS
    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.profiles WHERE id = %L', v_tech_b));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Técnico A pudo leer fila de perfil ajena en profiles'; END IF;

    -- 2. Técnico A en profiles_directory para Técnico B -> email enmascarado en NULL
    v_email := test_support.scalar_text_as(v_tech_a, format('SELECT email FROM public.profiles_directory WHERE id = %L', v_tech_b));
    IF v_email IS NOT NULL THEN RAISE EXCEPTION 'Técnico A vio email ajeno en profiles_directory: %', v_email; END IF;

    -- 3. Técnico A lee su propio email -> Correcto
    v_email := test_support.scalar_text_as(v_tech_a, format('SELECT email FROM public.profiles_directory WHERE id = %L', v_tech_a));
    IF v_email <> 'tech_a@mcd.com' THEN RAISE EXCEPTION 'Técnico A no pudo ver su propio email: %', v_email; END IF;

    -- 4. Admin y Coordinador ven email de Técnico B -> Correcto
    v_email := test_support.scalar_text_as(v_admin_id, format('SELECT email FROM public.profiles_directory WHERE id = %L', v_tech_b));
    IF v_email <> 'tech_b@mcd.com' THEN RAISE EXCEPTION 'Admin no vio email de Técnico B'; END IF;

    v_email := test_support.scalar_text_as(v_coord_id, format('SELECT email FROM public.profiles_directory WHERE id = %L', v_tech_b));
    IF v_email <> 'tech_b@mcd.com' THEN RAISE EXCEPTION 'Coordinador no vio email de Técnico B'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 6. ROL ANON
-- ==============================================================================

-- 6.1: Rol anon: denegación total de lectura en tablas y vistas (42501)
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Anon: denegación total de lectura (42501)';
    v_blocked BOOLEAN;
    v_tbl TEXT;
    v_tables TEXT[] := ARRAY['stores', 'spare_parts', 'meter_readings', 'store_inventory', 'stock_requests', 'announcements', 'profiles_directory'];
BEGIN
    FOREACH v_tbl IN ARRAY v_tables LOOP
        v_blocked := test_support.expect_error_as_anon(
            format('SELECT COUNT(*) FROM public.%I', v_tbl),
            '42501',
            'permission denied'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Anon pudo leer la tabla %', v_tbl; END IF;
    END LOOP;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 6.2: Rol anon: denegación total de ejecución de funciones públicas (42501)
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Anon: denegación total de funciones públicas';
    v_blocked BOOLEAN;
BEGIN
    v_blocked := test_support.expect_error_as_anon(
        'SELECT public.get_auth_role()',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Anon ejecutó get_auth_role'; END IF;

    v_blocked := test_support.expect_error_as_anon(
        'SELECT public.is_user_approved()',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Anon ejecutó is_user_approved'; END IF;

    v_blocked := test_support.expect_error_as_anon(
        'SELECT public.register_stock_movement(gen_random_uuid(), gen_random_uuid(), ''add''::public.stock_movement_type, 1.0)',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Anon ejecutó register_stock_movement'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 7. PRIVILEGIOS DE AUTHENTICATED Y EDICIÓN DE PERFILES
-- ==============================================================================

-- 7.1: Authenticated: funciones de sistema y triggers bloqueadas (42501)
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Authenticated: funciones de sistema bloqueadas';
    v_tech_id UUID;
    v_store_id UUID;
    v_part_id UUID;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('AU1', 'Store AU1', 40.0);
    v_part_id := test_support.create_part('Part AU1', 'unit');
    v_tech_id := test_support.create_user('tech_au1@mcd.com', 'technician', 'approved', v_store_id);

    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.register_stock_movement_system(%L, %L, ''add''::public.stock_movement_type, 10.0)', v_store_id, v_part_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Authenticated ejecutó register_stock_movement_system'; END IF;

    v_blocked := test_support.expect_error_as(
        v_tech_id,
        'SELECT public.revert_expired_roles()',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Authenticated ejecutó revert_expired_roles'; END IF;

    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT * FROM public.get_pending_readings_for(%L, NOW())', v_tech_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Authenticated ejecutó get_pending_readings_for'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 7.2: Authenticated: UPDATE directo de role o status en profiles rechazado para todos los roles
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Authenticated: UPDATE directo de role o status rechazado';
    v_admin_id UUID;
    v_coord_id UUID;
    v_target_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
    v_role public.user_role;
BEGIN
    v_store_id := test_support.create_store('AU2', 'Store AU2', 40.0);
    v_admin_id := test_support.create_user('admin_au2@mcd.com', 'admin', 'approved');
    v_coord_id := test_support.create_user('coord_au2@mcd.com', 'coordinator', 'approved');
    v_target_id := test_support.create_user('target_au2@mcd.com', 'technician', 'approved', v_store_id);

    -- Admin intenta UPDATE directo de role -> Bloqueado por permisos de columna
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        format('UPDATE public.profiles SET role = ''admin'' WHERE id = %L', v_target_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Admin hizo UPDATE directo de role'; END IF;

    -- Coordinador intenta UPDATE directo de status -> Bloqueado por permisos de columna
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('UPDATE public.profiles SET status = ''inactive'' WHERE id = %L', v_target_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Coordinador hizo UPDATE directo de status'; END IF;

    SELECT role FROM public.profiles WHERE id = v_target_id INTO v_role;
    IF v_role <> 'technician' THEN RAISE EXCEPTION 'Rol alterado indebidamente'; END IF;

    -- Control positivo: función autorizada assign_user_role sí funciona
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.assign_user_role(%L, ''coordinator''::public.user_role)', v_target_id)
    );

    SELECT role FROM public.profiles WHERE id = v_target_id INTO v_role;
    IF v_role <> 'coordinator' THEN RAISE EXCEPTION 'Control positivo falló'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 7.3: Authenticated: técnico actualiza su full_name pero no el ajeno; default_store_id no asignado rechazado
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Authenticated: auto-actualización de full_name y validación de default_store_id';
    v_tech_a UUID;
    v_tech_b UUID;
    v_store_a UUID;
    v_store_b UUID;
    v_blocked BOOLEAN;
    v_name TEXT;
    v_def_store UUID;
BEGIN
    v_store_a := test_support.create_store('AU3A', 'Store AU3A', 40.0);
    v_store_b := test_support.create_store('AU3B', 'Store AU3B', 40.0);
    v_tech_a := test_support.create_user('tech_a_au3@mcd.com', 'technician', 'approved', v_store_a);
    v_tech_b := test_support.create_user('tech_b_au3@mcd.com', 'technician', 'approved', v_store_b);

    -- 1. Técnico A actualiza su propio full_name -> Permitido
    PERFORM test_support.run_as(
        v_tech_a,
        format('UPDATE public.profiles SET full_name = ''Nuevo Nombre A'' WHERE id = %L', v_tech_a)
    );

    SELECT full_name INTO v_name FROM public.profiles WHERE id = v_tech_a;
    IF v_name <> 'Nuevo Nombre A' THEN RAISE EXCEPTION 'Actualización legítima falló'; END IF;

    -- 2. Técnico A intenta actualizar full_name de Técnico B -> 0 filas actualizadas por RLS
    PERFORM test_support.run_as(
        v_tech_a,
        format('UPDATE public.profiles SET full_name = ''Nombre Hack'' WHERE id = %L', v_tech_b)
    );

    SELECT full_name INTO v_name FROM public.profiles WHERE id = v_tech_b;
    IF v_name = 'Nombre Hack' THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico A actualizó perfil ajeno'; END IF;

    -- 3. Técnico A intenta setear default_store_id a store_b (donde no tiene acceso) -> Rechazado por trigger
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        format('UPDATE public.profiles SET default_store_id = %L WHERE id = %L', v_store_b, v_tech_a),
        'P0001',
        'El local asignado por defecto no es accesible para el usuario'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: default_store_id no asignado aceptado'; END IF;

    SELECT default_store_id INTO v_def_store FROM public.profiles WHERE id = v_tech_a;
    IF v_def_store = v_store_b THEN RAISE EXCEPTION 'default_store_id alterado indebidamente'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 8. LOCALES Y REPUESTOS INACTIVOS & DELETE DIRECTOS
-- ==============================================================================

-- 8.1: Inactivos: movimientos y lecturas en local o repuesto inactivo rechazados
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Inactivos: rechazo de movimientos y lecturas';
    v_admin_id UUID;
    v_active_store UUID;
    v_inactive_store UUID;
    v_active_part UUID;
    v_inactive_part UUID;
    v_blocked BOOLEAN;
BEGIN
    v_active_store := test_support.create_store('IN1', 'Active Store', 40.0, true);
    v_inactive_store := test_support.create_store('IN2', 'Inactive Store', 40.0, false);
    v_active_part := test_support.create_part('Active Part', 'unit', true);
    v_inactive_part := test_support.create_part('Inactive Part', 'unit', false);
    v_admin_id := test_support.create_user('admin_in@mcd.com', 'admin', 'approved');

    -- Movimiento en local inactivo
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 5.0)', v_inactive_store, v_active_part),
        'P0001',
        'No se pueden registrar movimientos en un local inactivo o inexistente'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Movimiento en local inactivo aceptado'; END IF;

    -- Movimiento con repuesto inactivo
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 5.0)', v_active_store, v_inactive_part),
        'P0001',
        'No se pueden registrar movimientos sobre un repuesto inactivo o inexistente'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Movimiento con repuesto inactivo aceptado'; END IF;

    -- Lectura en local inactivo
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        format('INSERT INTO public.meter_readings (store_id, display_value) VALUES (%L, 100.0)', v_inactive_store),
        'P0001',
        'No se pueden registrar lecturas en un local inactivo o inexistente'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Lectura en local inactivo aceptada'; END IF;

    -- Control positivo: movimiento en local y repuesto activos
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 5.0)', v_active_store, v_active_part)
    );

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 8.2: Integridad: DELETE directo sobre stores, spare_parts y part_categories bloqueado sin cambios
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Integridad: DELETE directo bloqueado sin borrado';
    v_admin_id UUID;
    v_store_id UUID;
    v_part_id UUID;
    v_cat_id UUID;
    v_blocked BOOLEAN;
    v_count INT;
BEGIN
    v_store_id := test_support.create_store('DEL1', 'Store Del', 40.0);
    v_part_id := test_support.create_part('Part Del', 'unit');
    SELECT category_id INTO v_cat_id FROM public.spare_parts WHERE id = v_part_id;
    v_admin_id := test_support.create_user('admin_del@mcd.com', 'admin', 'approved');

    -- Admin intenta DELETE FROM stores -> 0 filas borradas por ausencia de policy DELETE
    PERFORM test_support.run_as(v_admin_id, format('DELETE FROM public.stores WHERE id = %L', v_store_id));
    SELECT COUNT(*) INTO v_count FROM public.stores WHERE id = v_store_id;
    IF v_count = 0 THEN RAISE EXCEPTION 'Vulnerabilidad: store fue borrado directamente'; END IF;

    -- Admin intenta DELETE FROM spare_parts
    PERFORM test_support.run_as(v_admin_id, format('DELETE FROM public.spare_parts WHERE id = %L', v_part_id));
    SELECT COUNT(*) INTO v_count FROM public.spare_parts WHERE id = v_part_id;
    IF v_count = 0 THEN RAISE EXCEPTION 'Vulnerabilidad: spare_part fue borrado directamente'; END IF;

    -- Admin intenta DELETE FROM part_categories
    PERFORM test_support.run_as(v_admin_id, format('DELETE FROM public.part_categories WHERE id = %L', v_cat_id));
    SELECT COUNT(*) INTO v_count FROM public.part_categories WHERE id = v_cat_id;
    IF v_count = 0 THEN RAISE EXCEPTION 'Vulnerabilidad: part_category fue borrado directamente'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 9. VISIBILIDAD POR LOCAL (INVENTARIO Y MOVIMIENTOS)
-- ==============================================================================

-- 9.1: Visibilidad: técnico en local A ve stock y movimientos de A y no de B; registrar movimiento en B rechazado
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Visibilidad: técnico aislado en local asignado y rechazo en local ajeno';
    v_store_a UUID;
    v_store_b UUID;
    v_part_id UUID;
    v_tech_a UUID;
    v_admin_id UUID;
    v_count INT;
    v_blocked BOOLEAN;
BEGIN
    v_store_a := test_support.create_store('VIS1A', 'Store A', 40.0);
    v_store_b := test_support.create_store('VIS1B', 'Store B', 40.0);
    v_part_id := test_support.create_part('Part Vis', 'unit');
    v_admin_id := test_support.create_user('admin_vis@mcd.com', 'admin', 'approved');

    -- Crear stock en ambos locales vía admin
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 10.0)', v_store_a, v_part_id)
    );
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 20.0)', v_store_b, v_part_id)
    );

    -- Crear técnico asignado solo a Store A
    v_tech_a := test_support.create_user('tech_a_vis@mcd.com', 'technician', 'approved', v_store_a);

    -- Técnico A ve inventario de Store A
    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.store_inventory WHERE store_id = %L', v_store_a));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Técnico no vio inventario de local propio A'; END IF;

    -- Técnico A NO ve inventario de Store B
    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.store_inventory WHERE store_id = %L', v_store_b));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico vio inventario de local ajeno B'; END IF;

    -- Técnico A intenta registrar movimiento en Store B -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 5.0)', v_store_b, v_part_id),
        'P0001',
        'Acceso denegado: no posee acceso activo al inventario de este local'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico registró movimiento en local B no asignado'; END IF;

    -- Control positivo: técnico registra movimiento en Store A con éxito
    PERFORM test_support.run_as(
        v_tech_a,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 5.0)', v_store_a, v_part_id)
    );

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 9.2: Visibilidad: técnico con asignaciones a A y B ve ambos; técnico sin asignaciones no ve inventario; admin/coord ven todo
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Visibilidad: multiasignación y acceso total de coordinación';
    v_store_a UUID;
    v_store_b UUID;
    v_part_id UUID;
    v_admin_id UUID;
    v_coord_id UUID;
    v_tech_multi UUID;
    v_tech_none UUID;
    v_count INT;
BEGIN
    v_store_a := test_support.create_store('VIS2A', 'Store A', 40.0);
    v_store_b := test_support.create_store('VIS2B', 'Store B', 40.0);
    v_part_id := test_support.create_part('Part Vis2', 'unit');
    v_admin_id := test_support.create_user('admin_vis2@mcd.com', 'admin', 'approved');
    v_coord_id := test_support.create_user('coord_vis2@mcd.com', 'coordinator', 'approved');

    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 10.0)', v_store_a, v_part_id)
    );
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 20.0)', v_store_b, v_part_id)
    );

    -- Técnico con A permanente y B adicional
    v_tech_multi := test_support.create_user('tech_multi@mcd.com', 'technician', 'approved', v_store_a);
    PERFORM test_support.run_as(
        v_admin_id,
        format('SELECT public.assign_store(%L, %L)', v_tech_multi, v_store_b)
    );

    -- Técnico aprobado sin locales asignados
    v_tech_none := test_support.create_user('tech_none@mcd.com', 'technician', 'approved');

    -- Multi ve ambos
    v_count := test_support.count_as(v_tech_multi, format('SELECT COUNT(*) FROM public.store_inventory WHERE store_id IN (%L, %L)', v_store_a, v_store_b));
    IF v_count <> 2 THEN RAISE EXCEPTION 'Técnico multiasignado no vio ambos locales (count=%)', v_count; END IF;

    -- None no ve ninguno
    v_count := test_support.count_as(v_tech_none, format('SELECT COUNT(*) FROM public.store_inventory WHERE store_id IN (%L, %L)', v_store_a, v_store_b));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Técnico sin asignaciones vio inventario (count=%)', v_count; END IF;

    -- Coordinador y Admin ven todo
    v_count := test_support.count_as(v_coord_id, format('SELECT COUNT(*) FROM public.store_inventory WHERE store_id IN (%L, %L)', v_store_a, v_store_b));
    IF v_count <> 2 THEN RAISE EXCEPTION 'Coordinador no vio todos los inventarios'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 10. GESTIÓN DE ASIGNACIONES (user_stores)
-- ==============================================================================

-- 10.1: Asignaciones: temporal inactiva (futura o expirada) no da acceso; activa sí
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Asignaciones: vigencia temporal estricta';
    v_store_id UUID;
    v_tech_id UUID;
    v_has_access BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('AS1', 'Store AS1', 40.0);
    v_tech_id := test_support.create_user('tech_as1@mcd.com', 'technician', 'approved');

    -- 1. Asignación vencida en el pasado
    PERFORM set_config('app.store_assignment_modifying', 'true', true);
    INSERT INTO public.user_stores (user_id, store_id, starts_at, ends_at, assigned_by)
    VALUES (v_tech_id, v_store_id, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 hour', v_tech_id);
    PERFORM set_config('app.store_assignment_modifying', 'false', true);

    v_has_access := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_id))::boolean;
    IF v_has_access THEN RAISE EXCEPTION 'Asignación expirada dio acceso'; END IF;

    -- 2. Asignación futura que no ha comenzado
    PERFORM set_config('app.store_assignment_modifying', 'true', true);
    UPDATE public.user_stores
    SET starts_at = NOW() + INTERVAL '1 hour', ends_at = NOW() + INTERVAL '2 days'
    WHERE user_id = v_tech_id AND store_id = v_store_id;
    PERFORM set_config('app.store_assignment_modifying', 'false', true);

    v_has_access := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_id))::boolean;
    IF v_has_access THEN RAISE EXCEPTION 'Asignación futura dio acceso antes de iniciar'; END IF;

    -- 3. Asignación activa en curso
    PERFORM set_config('app.store_assignment_modifying', 'true', true);
    UPDATE public.user_stores
    SET starts_at = NOW() - INTERVAL '1 hour', ends_at = NOW() + INTERVAL '1 hour'
    WHERE user_id = v_tech_id AND store_id = v_store_id;
    PERFORM set_config('app.store_assignment_modifying', 'false', true);

    v_has_access := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_id))::boolean;
    IF NOT v_has_access THEN RAISE EXCEPTION 'Asignación activa no dio acceso'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 10.2: Asignaciones: solo admin y coordinador asignan; técnico no puede auto-asignarse ni por INSERT ni por función
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Asignaciones: rechazo de auto-asignación por técnico';
    v_store_id UUID;
    v_tech_id UUID;
    v_coord_id UUID;
    v_blocked BOOLEAN;
    v_count INT;
BEGIN
    v_store_id := test_support.create_store('AS2', 'Store AS2', 40.0);
    v_tech_id := test_support.create_user('tech_as2@mcd.com', 'technician', 'approved');
    v_coord_id := test_support.create_user('coord_as2@mcd.com', 'coordinator', 'approved');

    -- Técnico intenta llamar assign_store
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.assign_store(%L, %L)', v_tech_id, v_store_id),
        'P0001',
        'Acceso denegado: solo admin o coordinador pueden asignar locales'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico llamó assign_store'; END IF;

    -- Técnico intenta INSERT directo sobre user_stores
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('INSERT INTO public.user_stores (user_id, store_id) VALUES (%L, %L)', v_tech_id, v_store_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico hizo INSERT directo en user_stores'; END IF;

    SELECT COUNT(*) INTO v_count FROM public.user_stores WHERE user_id = v_tech_id AND store_id = v_store_id;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Asignación espuria creada'; END IF;

    -- Control positivo: coordinador asigna local
    PERFORM test_support.run_as(
        v_coord_id,
        format('SELECT public.assign_store(%L, %L)', v_tech_id, v_store_id)
    );

    SELECT COUNT(*) INTO v_count FROM public.user_stores WHERE user_id = v_tech_id AND store_id = v_store_id;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Control positivo falló: coordinador no pudo asignar'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 10.3: Asignaciones: end_store_assignment revoca acceso y se rechazan solapamientos activos
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Asignaciones: cierre de asignación y rechazo de solapamiento';
    v_store_id UUID;
    v_tech_id UUID;
    v_coord_id UUID;
    v_assignment_id UUID;
    v_blocked BOOLEAN;
    v_has_access BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('AS3', 'Store AS3', 40.0);
    v_tech_id := test_support.create_user('tech_as3@mcd.com', 'technician', 'approved');
    v_coord_id := test_support.create_user('coord_as3@mcd.com', 'coordinator', 'approved');

    PERFORM test_support.run_as(v_coord_id, format('SELECT public.assign_store(%L, %L)', v_tech_id, v_store_id));
    SELECT id INTO v_assignment_id FROM public.user_stores WHERE user_id = v_tech_id AND store_id = v_store_id;

    -- Intentar re-asignar mientras sigue activa -> Rechazado por solapamiento
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.assign_store(%L, %L)', v_tech_id, v_store_id),
        'P0001',
        'El usuario ya cuenta con una asignación activa para este local'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Se permitió solapar asignaciones activas'; END IF;

    -- Finalizar la asignación con end_store_assignment
    PERFORM test_support.run_as(v_coord_id, format('SELECT public.end_store_assignment(%L)', v_assignment_id));

    v_has_access := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_id))::boolean;
    IF v_has_access THEN RAISE EXCEPTION 'end_store_assignment no revocó el acceso'; END IF;

    -- Tras finalizarla, se puede asignar de nuevo con éxito
    PERFORM test_support.run_as(v_coord_id, format('SELECT public.assign_store(%L, %L)', v_tech_id, v_store_id));

    v_has_access := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_id))::boolean;
    IF NOT v_has_access THEN RAISE EXCEPTION 'Re-asignación posterior falló'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 11. MOVER TÉCNICOS ENTRE LOCALES (move_user_store)
-- ==============================================================================

-- 11.1: move_user_store: coordinador y admin mueven técnico entre locales, actualizando accesos, default_store_id y auditoría
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'move_user_store: flujo exitoso, actualización de default y auditoría';
    v_store_from UUID;
    v_store_to UUID;
    v_store_temp UUID;
    v_coord_id UUID;
    v_tech_id UUID;
    v_def_store UUID;
    v_access_from BOOLEAN;
    v_access_to BOOLEAN;
    v_access_temp BOOLEAN;
    v_ended_by UUID;
    v_assigned_by UUID;
BEGIN
    v_store_from := test_support.create_store('MV1A', 'Store Origen', 40.0);
    v_store_to := test_support.create_store('MV1B', 'Store Destino', 40.0);
    v_store_temp := test_support.create_store('MV1C', 'Store Temporal', 40.0);
    v_coord_id := test_support.create_user('coord_mv1@mcd.com', 'coordinator', 'approved');

    -- Técnico con local permanente en store_from (default_store_id) y temporal en store_temp
    v_tech_id := test_support.create_user('tech_mv1@mcd.com', 'technician', 'approved', v_store_from);
    PERFORM test_support.run_as(v_coord_id, format('SELECT public.assign_store(%L, %L, NOW() + INTERVAL ''5 days'')', v_tech_id, v_store_temp));

    -- Coordinador ejecuta movimiento de store_from a store_to
    PERFORM test_support.run_as(
        v_coord_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_tech_id, v_store_from, v_store_to)
    );

    -- 1. Pierde acceso al origen y lo gana en el destino de inmediato
    v_access_from := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_from))::boolean;
    v_access_to := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_to))::boolean;
    v_access_temp := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_temp))::boolean;

    IF v_access_from THEN RAISE EXCEPTION 'Técnico conserva acceso al origen tras movimiento'; END IF;
    IF NOT v_access_to THEN RAISE EXCEPTION 'Técnico no ganó acceso al destino tras movimiento'; END IF;
    IF NOT v_access_temp THEN RAISE EXCEPTION 'Asignación temporal en otro local se vio alterada indebidamente'; END IF;

    -- 2. default_store_id se actualizó al destino
    SELECT default_store_id INTO v_def_store FROM public.profiles WHERE id = v_tech_id;
    IF v_def_store <> v_store_to THEN RAISE EXCEPTION 'default_store_id no pasó al destino (es %)', v_def_store; END IF;

    -- 3. Auditoría de ended_by y assigned_by con el coordinador
    SELECT ended_by INTO v_ended_by FROM public.user_stores WHERE user_id = v_tech_id AND store_id = v_store_from;
    SELECT assigned_by INTO v_assigned_by FROM public.user_stores WHERE user_id = v_tech_id AND store_id = v_store_to;

    IF v_ended_by <> v_coord_id OR v_assigned_by <> v_coord_id THEN
        RAISE EXCEPTION 'Auditoría errónea: ended_by=%, assigned_by=%', v_ended_by, v_assigned_by;
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 11.2: move_user_store: rechazos por reglas de negocio y preservación atómica del estado
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'move_user_store: validaciones estrictas y atomicidad';
    v_store_from UUID;
    v_store_to UUID;
    v_store_inactive UUID;
    v_coord_id UUID;
    v_admin_id UUID;
    v_tech_id UUID;
    v_pending_id UUID;
    v_blocked BOOLEAN;
    v_access_from BOOLEAN;
BEGIN
    v_store_from := test_support.create_store('MV2A', 'Store Origen', 40.0);
    v_store_to := test_support.create_store('MV2B', 'Store Destino', 40.0);
    v_store_inactive := test_support.create_store('MV2I', 'Store Inactivo', 40.0, false);
    v_coord_id := test_support.create_user('coord_mv2@mcd.com', 'coordinator', 'approved');
    v_admin_id := test_support.create_user('admin_mv2@mcd.com', 'admin', 'approved');
    v_tech_id := test_support.create_user('tech_mv2@mcd.com', 'technician', 'approved', v_store_from);
    v_pending_id := test_support.create_user('pend_mv2@mcd.com', NULL, 'pending');

    -- 1. Técnico llamando a move_user_store
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_tech_id, v_store_from, v_store_to),
        'P0001',
        'solo admin o coordinador pueden mover usuarios'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo llamar move_user_store'; END IF;

    -- 2. Mover a un admin o coordinador
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_admin_id, v_store_from, v_store_to),
        'P0001',
        'Solo se pueden mover técnicos entre locales'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Se permitió mover a un admin'; END IF;

    -- 3. Origen sin asignación permanente activa
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_tech_id, v_store_to, v_store_from),
        'P0001',
        'El usuario no posee una asignación permanente activa en el local de origen'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Se permitió mover desde local no asignado'; END IF;

    -- 4. Destino igual al origen
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_tech_id, v_store_from, v_store_from),
        'P0001',
        'El local de destino debe ser distinto al de origen'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Se permitió mover con origen igual a destino'; END IF;

    -- 5. Destino donde ya tiene acceso activo
    PERFORM test_support.run_as(v_coord_id, format('SELECT public.assign_store(%L, %L, NOW() + INTERVAL ''1 day'')', v_tech_id, v_store_to));
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_tech_id, v_store_from, v_store_to),
        'P0001',
        'El usuario ya cuenta con una asignación activa en el local de destino'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Se permitió mover a destino con acceso existente'; END IF;

    -- 6. Destino inactivo
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_tech_id, v_store_from, v_store_inactive),
        'P0001',
        'El local de destino debe ser un local activo'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Se permitió mover a local inactivo'; END IF;

    -- 7. Usuario no aprobado
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.move_user_store(%L, %L, %L)', v_pending_id, v_store_from, v_store_to),
        'P0001',
        'El usuario debe estar aprobado'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Se permitió mover usuario no aprobado'; END IF;

    -- 8. Verificación de atomicidad: asignación de origen sigue intacta
    v_access_from := test_support.scalar_text_as(v_tech_id, format('SELECT public.user_has_store_access(%L)::text', v_store_from))::boolean;
    IF NOT v_access_from THEN RAISE EXCEPTION 'Atomicidad violada: asignación de origen se perdió tras errores'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 12. LECTURAS DE MEDIDOR
-- ==============================================================================

-- 12.1: Lecturas: autoría forzada y campos protegidos de sistema inmutables
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Lecturas: autoría forzada y campos inmutables';
    v_store_id UUID;
    v_tech_id UUID;
    v_other_tech_id UUID;
    v_reading_id UUID;
    v_recorded_by UUID;
    v_reading_days INT;
    v_is_estimated BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('RD1', 'Store RD1', 40.0);
    v_tech_id := test_support.create_user('tech_rd1@mcd.com', 'technician', 'approved', v_store_id);
    v_other_tech_id := test_support.create_user('tech_rd2@mcd.com', 'technician', 'approved', v_store_id);

    -- Insertar lectura intentando falsear recorded_by y campos de sistema
    PERFORM test_support.run_as(
        v_tech_id,
        format('INSERT INTO public.meter_readings (store_id, display_value, recorded_by, reading_days, is_estimated)
                VALUES (%L, 1000.0, %L, 5, true)', v_store_id, v_other_tech_id)
    );

    SELECT id, recorded_by, reading_days, is_estimated
    INTO v_reading_id, v_recorded_by, v_reading_days, v_is_estimated
    FROM public.meter_readings WHERE store_id = v_store_id;

    IF v_recorded_by <> v_tech_id THEN RAISE EXCEPTION 'Autoría forzada falló: recorded_by=%', v_recorded_by; END IF;
    IF v_reading_days <> 1 OR v_is_estimated <> false THEN
        RAISE EXCEPTION 'Campos de sistema no fueron forzados a valores iniciales';
    END IF;

    -- Intentar modificar campos de sistema en UPDATE
    PERFORM test_support.run_as(
        v_tech_id,
        format('UPDATE public.meter_readings SET recorded_by = %L, reading_days = 10, is_estimated = true WHERE id = %L', v_other_tech_id, v_reading_id)
    );

    SELECT recorded_by, reading_days, is_estimated INTO v_recorded_by, v_reading_days, v_is_estimated
    FROM public.meter_readings WHERE id = v_reading_id;

    IF v_recorded_by <> v_tech_id OR v_reading_days <> 1 OR v_is_estimated <> false THEN
        RAISE EXCEPTION 'Campos protegidos fueron alterados indebidamente';
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 12.2: Lecturas: display decreciente rechazado sin reset y aceptado con reset; duplicado por día rechazado
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Lecturas: validación de display no decreciente y unicidad diaria';
    v_store_id UUID;
    v_tech_id UUID;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('RD2', 'Store RD2', 40.0);
    v_tech_id := test_support.create_user('tech_rd2@mcd.com', 'technician', 'approved', v_store_id);

    -- Simular lectura histórica previa de ayer con display 2000.0
    INSERT INTO public.meter_readings (store_id, reading_date, display_value, recorded_by)
    VALUES (v_store_id, public.get_buenos_aires_date() - 1, 2000.0, v_tech_id);

    -- Lectura menor sin reset -> Rechazada
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('INSERT INTO public.meter_readings (store_id, display_value, is_reset) VALUES (%L, 1500.0, false)', v_store_id),
        'P0001',
        'no puede ser menor que la lectura anterior'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Display menor sin reset aceptado'; END IF;

    -- Lectura menor CON reset -> Aceptada
    PERFORM test_support.run_as(
        v_tech_id,
        format('INSERT INTO public.meter_readings (store_id, display_value, is_reset) VALUES (%L, 1500.0, true)', v_store_id)
    );

    -- Duplicado en el mismo local y día -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('INSERT INTO public.meter_readings (store_id, display_value) VALUES (%L, 2500.0)', v_store_id),
        '23505',
        'uq_meter_readings_store_date'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Lectura duplicada para el mismo día aceptada'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 12.3: Lecturas: local sin multiplicador genera lectura con kWh pendiente
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Lecturas: local sin multiplicador deja kWh pendiente';
    v_store_id UUID;
    v_tech_id UUID;
    v_mult NUMERIC;
    v_kwh NUMERIC;
BEGIN
    v_store_id := test_support.create_store('RD3', 'Store Sin Mult', NULL);
    v_tech_id := test_support.create_user('tech_rd3@mcd.com', 'technician', 'approved', v_store_id);

    PERFORM test_support.run_as(
        v_tech_id,
        format('INSERT INTO public.meter_readings (store_id, display_value) VALUES (%L, 100.0)', v_store_id)
    );

    SELECT applied_multiplier, kwh_reading INTO v_mult, v_kwh
    FROM public.meter_readings WHERE store_id = v_store_id;

    IF v_mult IS NOT NULL OR v_kwh IS NOT NULL THEN
        RAISE EXCEPTION 'Lectura sin multiplicador calculó kWh indebidamente: mult=%, kwh=%', v_mult, v_kwh;
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 12.4: Lecturas: edición del mismo día audita en meter_reading_edits; edición de día anterior rechazada
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Lecturas: auditoría de edición de hoy y bloqueo en días pasados';
    v_store_id UUID;
    v_tech_id UUID;
    v_reading_today UUID;
    v_reading_past UUID;
    v_blocked BOOLEAN;
    v_edit_count INT;
BEGIN
    v_store_id := test_support.create_store('RD4', 'Store RD4', 40.0);
    v_tech_id := test_support.create_user('tech_rd4@mcd.com', 'technician', 'approved', v_store_id);

    -- Cargar lectura de hoy
    PERFORM test_support.run_as(v_tech_id, format('INSERT INTO public.meter_readings (store_id, display_value) VALUES (%L, 100.0)', v_store_id));
    SELECT id INTO v_reading_today FROM public.meter_readings WHERE store_id = v_store_id;

    -- Cargar lectura del pasado directamente
    INSERT INTO public.meter_readings (store_id, reading_date, display_value, recorded_by)
    VALUES (v_store_id, public.get_buenos_aires_date() - 5, 50.0, v_tech_id)
    RETURNING id INTO v_reading_past;

    -- 1. Edición de hoy -> Éxito y auditoría
    PERFORM test_support.run_as(
        v_tech_id,
        format('UPDATE public.meter_readings SET display_value = 105.0 WHERE id = %L', v_reading_today)
    );

    SELECT COUNT(*) INTO v_edit_count FROM public.meter_reading_edits WHERE reading_id = v_reading_today;
    IF v_edit_count <> 1 THEN RAISE EXCEPTION 'Auditoría en meter_reading_edits no registrada'; END IF;

    -- 2. Edición de lectura pasada -> Bloqueada (0 filas actualizadas por RLS)
    PERFORM test_support.run_as(
        v_tech_id,
        format('UPDATE public.meter_readings SET display_value = 55.0 WHERE id = %L', v_reading_past)
    );

    SELECT display_value INTO v_edit_count FROM public.meter_readings WHERE id = v_reading_past;
    IF v_edit_count = 55.0 THEN RAISE EXCEPTION 'Vulnerabilidad: Se permitió corregir lectura pasada'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 12.5: Lecturas: técnico restringido a lecturas de hoy de sus locales asignados; admin/coord ven todo el historial
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Lecturas: visibilidad por local y fecha para técnicos vs coordinación';
    v_store_a UUID;
    v_store_b UUID;
    v_tech_a UUID;
    v_admin_id UUID;
    v_count INT;
    v_blocked BOOLEAN;
BEGIN
    v_store_a := test_support.create_store('RD5A', 'Store A', 40.0);
    v_store_b := test_support.create_store('RD5B', 'Store B', 40.0);
    v_tech_a := test_support.create_user('tech_rd5a@mcd.com', 'technician', 'approved', v_store_a);
    v_admin_id := test_support.create_user('admin_rd5@mcd.com', 'admin', 'approved');

    -- Insertar lecturas de hoy y pasadas en A y B
    INSERT INTO public.meter_readings (store_id, reading_date, display_value, recorded_by) VALUES
    (v_store_a, public.get_buenos_aires_date(), 100.0, v_tech_a),
    (v_store_a, public.get_buenos_aires_date() - 1, 90.0, v_tech_a),
    (v_store_b, public.get_buenos_aires_date(), 200.0, v_admin_id),
    (v_store_b, public.get_buenos_aires_date() - 1, 190.0, v_admin_id);

    -- Técnico A solo ve la lectura de HOY de Store A (1 fila)
    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.meter_readings WHERE store_id IN (%L, %L)', v_store_a, v_store_b));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Técnico vio % lecturas, esperado exactamente 1 (hoy en Store A)', v_count; END IF;

    -- Técnico A intenta insertar lectura en Store B no asignado -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        format('INSERT INTO public.meter_readings (store_id, display_value) VALUES (%L, 210.0)', v_store_b),
        'P0001',
        'no posee asignación activa en este local'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico insertó lectura en local ajeno'; END IF;

    -- Admin ve todas las 4 lecturas
    v_count := test_support.count_as(v_admin_id, format('SELECT COUNT(*) FROM public.meter_readings WHERE store_id IN (%L, %L)', v_store_a, v_store_b));
    IF v_count <> 4 THEN RAISE EXCEPTION 'Admin vio % lecturas, esperado 4', v_count; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 13. MULTIPLICADOR DE MEDIDOR
-- ==============================================================================

-- 13.1: Multiplicador: primera carga recalcula pendientes sin auditoría; cambio posterior inmutable; solo admin/coord editan
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Multiplicador: recálculo inicial único, inmutabilidad posterior y permisos';
    v_store_id UUID;
    v_admin_id UUID;
    v_tech_id UUID;
    v_reading_past UUID;
    v_kwh NUMERIC;
    v_recalc_by UUID;
    v_edit_count INT;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('MU1', 'Store Mult', NULL);
    v_admin_id := test_support.create_user('admin_mu@mcd.com', 'admin', 'approved');
    v_tech_id := test_support.create_user('tech_mu@mcd.com', 'technician', 'approved', v_store_id);

    -- Cargar lectura histórica pendiente sin multiplicador
    INSERT INTO public.meter_readings (store_id, reading_date, display_value, recorded_by, applied_multiplier, kwh_reading)
    VALUES (v_store_id, public.get_buenos_aires_date() - 2, 100.0, v_admin_id, NULL, NULL)
    RETURNING id INTO v_reading_past;

    -- Técnico intenta modificar multiplicador -> 0 filas o rechazado
    PERFORM test_support.run_as(
        v_tech_id,
        format('UPDATE public.stores SET meter_multiplier = 40.0 WHERE id = %L', v_store_id)
    );
    SELECT meter_multiplier INTO v_kwh FROM public.stores WHERE id = v_store_id;
    IF v_kwh IS NOT NULL THEN RAISE EXCEPTION 'Vulnerabilidad: Técnico modificó multiplicador'; END IF;

    -- 1. Primera carga por admin (NULL -> 40.0)
    PERFORM test_support.run_as(
        v_admin_id,
        format('UPDATE public.stores SET meter_multiplier = 40.0 WHERE id = %L', v_store_id)
    );

    SELECT kwh_reading, recalculated_by INTO v_kwh, v_recalc_by
    FROM public.meter_readings WHERE id = v_reading_past;

    IF v_kwh <> 4000.0 OR v_recalc_by <> v_admin_id THEN
        RAISE EXCEPTION 'Recálculo inicial falló: kwh=%, by=%', v_kwh, v_recalc_by;
    END IF;

    -- No debe generar entradas en meter_reading_edits
    SELECT COUNT(*) INTO v_edit_count FROM public.meter_reading_edits WHERE reading_id = v_reading_past;
    IF v_edit_count <> 0 THEN RAISE EXCEPTION 'Recálculo generó ediciones indebidamente'; END IF;

    -- 2. Cambio posterior de multiplicador (40.0 -> 80.0) NO altera lecturas ya calculadas
    PERFORM test_support.run_as(
        v_admin_id,
        format('UPDATE public.stores SET meter_multiplier = 80.0 WHERE id = %L', v_store_id)
    );

    SELECT kwh_reading INTO v_kwh FROM public.meter_readings WHERE id = v_reading_past;
    IF v_kwh <> 4000.0 THEN
        RAISE EXCEPTION 'Inmutabilidad violada: kwh pasó a % tras cambio de multiplicador', v_kwh;
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 14. STOCK E INMUTABILIDAD
-- ==============================================================================

-- 14.1: Stock: coherencia de signo, nota en adjustment, rechazo de decimales en unidades y stock negativo
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Stock: validaciones de signo, notas, decimales y stock no negativo';
    v_store_id UUID;
    v_unit_part UUID;
    v_liter_part UUID;
    v_tech_id UUID;
    v_blocked BOOLEAN;
    v_mov public.stock_movements;
BEGIN
    v_store_id := test_support.create_store('ST1', 'Store ST1', 40.0);
    v_unit_part := test_support.create_part('Part Unit', 'unit');
    v_liter_part := test_support.create_part('Part Liter', 'liter');
    v_tech_id := test_support.create_user('tech_st1@mcd.com', 'technician', 'approved', v_store_id);

    -- Cargar stock inicial
    INSERT INTO public.store_inventory (store_id, part_id, quantity) VALUES (v_store_id, v_unit_part, 10.0);
    INSERT INTO public.store_inventory (store_id, part_id, quantity) VALUES (v_store_id, v_liter_part, 10.0);

    -- 1. add con signo negativo -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, -2.0)', v_store_id, v_unit_part),
        'P0001',
        'exige una variación estrictamente positiva'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'add con negativo aceptado'; END IF;

    -- 2. consume con signo positivo -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.register_stock_movement(%L, %L, ''consume''::public.stock_movement_type, 2.0)', v_store_id, v_unit_part),
        'P0001',
        'exige una variación estrictamente negativa'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'consume con positivo aceptado'; END IF;

    -- 3. adjustment sin nota -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.register_stock_movement(%L, %L, ''adjustment''::public.stock_movement_type, 1.0, NULL)', v_store_id, v_unit_part),
        'P0001',
        'exige una nota explicativa no vacía'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'adjustment sin nota aceptado'; END IF;

    -- 4. Decimales en unidad 'unit' -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 1.5)', v_store_id, v_unit_part),
        'P0001',
        'debe ser un número entero'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Decimales en unit aceptados'; END IF;

    -- 5. Stock negativo -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('SELECT public.register_stock_movement(%L, %L, ''consume''::public.stock_movement_type, -50.0)', v_store_id, v_unit_part),
        'P0001',
        'Stock insuficiente'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Stock negativo permitido'; END IF;

    -- 6. Decimales en 'liter' -> Aceptados con user_id forzado a auth.uid()
    PERFORM test_support.run_as(
        v_tech_id,
        format('SELECT public.register_stock_movement(%L, %L, ''add''::public.stock_movement_type, 2.75)', v_store_id, v_liter_part)
    );

    SELECT * INTO v_mov FROM public.stock_movements WHERE store_id = v_store_id AND part_id = v_liter_part;
    IF v_mov.user_id <> v_tech_id OR v_mov.variation <> 2.75 THEN
        RAISE EXCEPTION 'Movimiento válido falló: user_id=%, var=%', v_mov.user_id, v_mov.variation;
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 14.2: Stock: inmutabilidad de store_inventory, stock_movements y meter_reading_edits (UPDATE/DELETE/TRUNCATE rechazados)
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Stock: inmutabilidad contra mutaciones directas de inventario y auditoría';
    v_store_id UUID;
    v_part_id UUID;
    v_admin_id UUID;
    v_blocked BOOLEAN;
    v_qty NUMERIC;
BEGIN
    v_store_id := test_support.create_store('ST2', 'Store ST2', 40.0);
    v_part_id := test_support.create_part('Part Inm', 'unit');
    v_admin_id := test_support.create_user('admin_st2@mcd.com', 'admin', 'approved');

    INSERT INTO public.store_inventory (store_id, part_id, quantity) VALUES (v_store_id, v_part_id, 10.0);

    -- 1. UPDATE directo sobre fila existente de store_inventory -> 42501
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        format('UPDATE public.store_inventory SET quantity = 999.0 WHERE store_id = %L', v_store_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'UPDATE directo sobre store_inventory aceptado'; END IF;

    SELECT quantity INTO v_qty FROM public.store_inventory WHERE store_id = v_store_id;
    IF v_qty <> 10.0 THEN RAISE EXCEPTION 'Cantidad alterada indebidamente'; END IF;

    -- 2. UPDATE sobre stock_movements -> 42501
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        'UPDATE public.stock_movements SET variation = 999.0',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'UPDATE sobre stock_movements aceptado'; END IF;

    -- 3. DELETE sobre meter_reading_edits -> 42501
    v_blocked := test_support.expect_error_as(
        v_admin_id,
        'DELETE FROM public.meter_reading_edits',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'DELETE sobre meter_reading_edits aceptado'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 15. PETICIONES (stock_requests)
-- ==============================================================================

-- 15.1: Peticiones: creación válida en local propio y rechazo en local ajeno; visibilidad general y autoría forzada
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Peticiones: creación en local propio, rechazo en ajeno y visibilidad global';
    v_store_a UUID;
    v_store_b UUID;
    v_part_id UUID;
    v_tech_a UUID;
    v_tech_b UUID;
    v_pending_id UUID;
    v_req_id UUID;
    v_requester UUID;
    v_count INT;
    v_blocked BOOLEAN;
BEGIN
    v_store_a := test_support.create_store('REQ1A', 'Store A', 40.0);
    v_store_b := test_support.create_store('REQ1B', 'Store B', 40.0);
    v_part_id := test_support.create_part('Part Req', 'unit');
    v_tech_a := test_support.create_user('tech_a_req@mcd.com', 'technician', 'approved', v_store_a);
    v_tech_b := test_support.create_user('tech_b_req@mcd.com', 'technician', 'approved', v_store_b);
    v_pending_id := test_support.create_user('pend_req@mcd.com', NULL, 'pending');

    -- Técnico A intenta pedir en Store B ajeno -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        format('INSERT INTO public.stock_requests (store_id, part_id, quantity) VALUES (%L, %L, 2.0)', v_store_b, v_part_id),
        'P0001',
        'no posee acceso activo al local para realizar la petición'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Vulnerabilidad: Petición en local ajeno aceptada'; END IF;

    -- Técnico A pide en Store A propio intentando falsear requester_id
    PERFORM test_support.run_as(
        v_tech_a,
        format('INSERT INTO public.stock_requests (store_id, requester_id, part_id, quantity) VALUES (%L, %L, %L, 2.0)', v_store_a, v_tech_b, v_part_id)
    );

    SELECT id, requester_id INTO v_req_id, v_requester FROM public.stock_requests WHERE store_id = v_store_a;
    IF v_requester <> v_tech_a THEN RAISE EXCEPTION 'requester_id no fue forzado a auth.uid()'; END IF;

    -- Técnico B ve la petición de Técnico A (llega a todos los aprobados)
    v_count := test_support.count_as(v_tech_b, format('SELECT COUNT(*) FROM public.stock_requests WHERE id = %L', v_req_id));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Técnico B no pudo ver la petición de Técnico A'; END IF;

    -- Usuario pendiente NO ve la petición
    v_count := test_support.count_as(v_pending_id, format('SELECT COUNT(*) FROM public.stock_requests WHERE id = %L', v_req_id));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Vulnerabilidad: Pendiente vio la petición'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 15.2: Peticiones: validación de descripción obligatoria para "Otro" y rechazo de repuestos inactivos
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Peticiones: validación de descripción obligatoria y repuesto activo';
    v_store_id UUID;
    v_tech_id UUID;
    v_inactive_part UUID;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('REQ2', 'Store Req2', 40.0);
    v_tech_id := test_support.create_user('tech_req2@mcd.com', 'technician', 'approved', v_store_id);
    v_inactive_part := test_support.create_part('Part Inactiva', 'unit', false);

    -- 1. Petición sin repuesto y con descripción vacía/nula -> Rechazada
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('INSERT INTO public.stock_requests (store_id, part_id, other_description) VALUES (%L, NULL, ''   '')', v_store_id),
        '23514',
        'chk_stock_requests_part_or_desc'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Petición "Otro" sin descripción aceptada'; END IF;

    -- 2. Petición con repuesto inactivo -> Rechazada
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('INSERT INTO public.stock_requests (store_id, part_id) VALUES (%L, %L)', v_store_id, v_inactive_part),
        'P0001',
        'No se pueden solicitar repuestos inactivos o inexistentes'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Petición con repuesto inactivo aceptada'; END IF;

    -- Control positivo: "Otro" con descripción no vacía -> Aceptada
    PERFORM test_support.run_as(
        v_tech_id,
        format('INSERT INTO public.stock_requests (store_id, part_id, other_description) VALUES (%L, NULL, ''Manguera especial'')', v_store_id)
    );

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 15.3: Peticiones: cierre permitido a creador, coordinador y admin; prohibido a otro técnico y sin cierre duplicado
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Peticiones: cierre autorizado y rechazo de doble cierre';
    v_store_a UUID;
    v_store_b UUID;
    v_part_id UUID;
    v_creator_id UUID;
    v_other_tech_id UUID;
    v_coord_id UUID;
    v_req_id UUID;
    v_blocked BOOLEAN;
    v_status TEXT;
    v_closed_by UUID;
BEGIN
    v_store_a := test_support.create_store('REQ3A', 'Store A', 40.0);
    v_store_b := test_support.create_store('REQ3B', 'Store B', 40.0);
    v_part_id := test_support.create_part('Part Req3', 'unit');
    v_creator_id := test_support.create_user('tech_creator@mcd.com', 'technician', 'approved', v_store_a);
    v_other_tech_id := test_support.create_user('tech_other@mcd.com', 'technician', 'approved', v_store_b);
    v_coord_id := test_support.create_user('coord_req3@mcd.com', 'coordinator', 'approved');

    PERFORM test_support.run_as(v_creator_id, format('INSERT INTO public.stock_requests (store_id, part_id) VALUES (%L, %L)', v_store_a, v_part_id));
    SELECT id INTO v_req_id FROM public.stock_requests WHERE store_id = v_store_a;

    -- Otro técnico intenta cerrar la petición -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_other_tech_id,
        format('SELECT public.close_stock_request(%L)', v_req_id),
        'P0001',
        'solo el creador, el coordinador o el admin pueden cerrar la petición'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Otro técnico pudo cerrar la petición'; END IF;

    -- Creador cierra la petición -> Éxito
    PERFORM test_support.run_as(v_creator_id, format('SELECT public.close_stock_request(%L)', v_req_id));

    SELECT status, closed_by INTO v_status, v_closed_by FROM public.stock_requests WHERE id = v_req_id;
    IF v_status <> 'closed' OR v_closed_by <> v_creator_id THEN
        RAISE EXCEPTION 'Cierre legítimo falló: status=%, by=%', v_status, v_closed_by;
    END IF;

    -- Intentar cerrar de nuevo -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('SELECT public.close_stock_request(%L)', v_req_id),
        'P0001',
        'La petición ya se encuentra cerrada'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Se permitió cerrar una petición ya cerrada'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 15.4: Peticiones: inmutabilidad (UPDATE/DELETE rechazados) y aislamiento de vistas en stock_request_views
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Peticiones: inmutabilidad directa y vistas individuales';
    v_store_id UUID;
    v_part_id UUID;
    v_tech_a UUID;
    v_tech_b UUID;
    v_req_id UUID;
    v_count INT;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('REQ4', 'Store Req4', 40.0);
    v_part_id := test_support.create_part('Part Req4', 'unit');
    v_tech_a := test_support.create_user('tech_a_v@mcd.com', 'technician', 'approved', v_store_id);
    v_tech_b := test_support.create_user('tech_b_v@mcd.com', 'technician', 'approved', v_store_id);

    PERFORM test_support.run_as(v_tech_a, format('INSERT INTO public.stock_requests (store_id, part_id) VALUES (%L, %L)', v_store_id, v_part_id));
    SELECT id INTO v_req_id FROM public.stock_requests WHERE store_id = v_store_id;

    -- UPDATE directo sobre stock_requests -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        format('UPDATE public.stock_requests SET status = ''closed'' WHERE id = %L', v_req_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'UPDATE directo sobre stock_requests permitido'; END IF;

    -- DELETE sobre stock_requests -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        format('DELETE FROM public.stock_requests WHERE id = %L', v_req_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'DELETE sobre stock_requests permitido'; END IF;

    -- Marcar vista por Técnico A
    PERFORM test_support.run_as(
        v_tech_a,
        format('INSERT INTO public.stock_request_views (request_id) VALUES (%L)', v_req_id)
    );

    -- Técnico A ve 1 fila en stock_request_views
    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.stock_request_views WHERE request_id = %L', v_req_id));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Técnico A no vio su marca de vista'; END IF;

    -- Técnico B ve 0 filas en stock_request_views
    v_count := test_support.count_as(v_tech_b, format('SELECT COUNT(*) FROM public.stock_request_views WHERE request_id = %L', v_req_id));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Técnico B vio la marca de vista de Técnico A'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 16. MENSAJES DEL COORDINADOR (announcements)
-- ==============================================================================

-- 16.1: Anuncios: creación exclusiva por admin/coord, filtrado por destino ('all', 'store', 'user') y ocultamiento al archivar
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Anuncios: creación autorizada, segmentación y archivado';
    v_store_a UUID;
    v_store_b UUID;
    v_coord_id UUID;
    v_tech_a UUID;
    v_tech_b UUID;
    v_ann_all UUID;
    v_ann_store UUID;
    v_ann_user UUID;
    v_count INT;
    v_blocked BOOLEAN;
BEGIN
    v_store_a := test_support.create_store('ANN1A', 'Store A', 40.0);
    v_store_b := test_support.create_store('ANN1B', 'Store B', 40.0);
    v_coord_id := test_support.create_user('coord_ann@mcd.com', 'coordinator', 'approved');
    v_tech_a := test_support.create_user('tech_ann_a@mcd.com', 'technician', 'approved', v_store_a);
    v_tech_b := test_support.create_user('tech_ann_b@mcd.com', 'technician', 'approved', v_store_b);

    -- Técnico intenta crear anuncio -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        'INSERT INTO public.announcements (body, target_type) VALUES (''Aviso test'', ''all'')',
        'P0001',
        'solo admin o coordinador pueden publicar anuncios'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo crear anuncio'; END IF;

    -- Coordinador crea anuncios: all, store_a, user_b
    PERFORM test_support.run_as(v_coord_id, 'INSERT INTO public.announcements (body, target_type) VALUES (''Para todos'', ''all'')');
    SELECT id INTO v_ann_all FROM public.announcements WHERE target_type = 'all';

    PERFORM test_support.run_as(v_coord_id, format('INSERT INTO public.announcements (body, target_type, target_store_id) VALUES (''Para Store A'', ''store'', %L)', v_store_a));
    SELECT id INTO v_ann_store FROM public.announcements WHERE target_type = 'store';

    PERFORM test_support.run_as(v_coord_id, format('INSERT INTO public.announcements (body, target_type, target_user_id) VALUES (''Para Tech B'', ''user'', %L)', v_tech_b));
    SELECT id INTO v_ann_user FROM public.announcements WHERE target_type = 'user';

    -- Técnico A ve 'all' y 'store_a' (2 filas); NO ve 'user_b'
    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.announcements WHERE id IN (%L, %L, %L)', v_ann_all, v_ann_store, v_ann_user));
    IF v_count <> 2 THEN RAISE EXCEPTION 'Técnico A vio % anuncios, esperado 2', v_count; END IF;

    -- Técnico B ve 'all' y 'user_b' (2 filas); NO ve 'store_a'
    v_count := test_support.count_as(v_tech_b, format('SELECT COUNT(*) FROM public.announcements WHERE id IN (%L, %L, %L)', v_ann_all, v_ann_store, v_ann_user));
    IF v_count <> 2 THEN RAISE EXCEPTION 'Técnico B vio % anuncios, esperado 2', v_count; END IF;

    -- Coordinador archiva anuncio 'all' -> Técnico A ya no lo ve
    PERFORM test_support.run_as(v_coord_id, format('SELECT public.archive_announcement(%L)', v_ann_all));

    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.announcements WHERE id = %L', v_ann_all));
    IF v_count <> 0 THEN RAISE EXCEPTION 'Anuncio archivado sigue visible para Técnico A'; END IF;

    -- Coordinador sigue viendo el archivado
    v_count := test_support.count_as(v_coord_id, format('SELECT COUNT(*) FROM public.announcements WHERE id = %L', v_ann_all));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Coordinador no vio anuncio archivado'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 16.2: Anuncios: lectura idempotente, rechazo sobre anuncios no visibles, auditoría de leídos y bloqueo de mutaciones directas
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Anuncios: lectura idempotente, validación de visibilidad y auditoría';
    v_store_a UUID;
    v_store_b UUID;
    v_coord_id UUID;
    v_tech_a UUID;
    v_tech_b UUID;
    v_ann_b UUID;
    v_ann_all UUID;
    v_count INT;
    v_blocked BOOLEAN;
BEGIN
    v_store_a := test_support.create_store('ANN2A', 'Store A', 40.0);
    v_store_b := test_support.create_store('ANN2B', 'Store B', 40.0);
    v_coord_id := test_support.create_user('coord_ann2@mcd.com', 'coordinator', 'approved');
    v_tech_a := test_support.create_user('tech_ann2_a@mcd.com', 'technician', 'approved', v_store_a);
    v_tech_b := test_support.create_user('tech_ann2_b@mcd.com', 'technician', 'approved', v_store_b);

    PERFORM test_support.run_as(v_coord_id, format('INSERT INTO public.announcements (body, target_type, target_store_id) VALUES (''Para Store B'', ''store'', %L)', v_store_b));
    SELECT id INTO v_ann_b FROM public.announcements WHERE target_type = 'store';

    PERFORM test_support.run_as(v_coord_id, 'INSERT INTO public.announcements (body, target_type) VALUES (''Para todos'', ''all'')');
    SELECT id INTO v_ann_all FROM public.announcements WHERE target_type = 'all';

    -- 1. Técnico A intenta marcar como leído un anuncio de Store B (no visible para él) -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_tech_a,
        format('SELECT public.mark_announcement_read(%L)', v_ann_b),
        'P0001',
        'el anuncio no es visible para el usuario'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo marcar anuncio no visible'; END IF;

    -- 2. Técnico A marca anuncio visible 'all' como leído (idempotente)
    PERFORM test_support.run_as(v_tech_a, format('SELECT public.mark_announcement_read(%L)', v_ann_all));
    PERFORM test_support.run_as(v_tech_a, format('SELECT public.mark_announcement_read(%L)', v_ann_all));

    -- Técnico A solo ve su propia lectura
    v_count := test_support.count_as(v_tech_a, format('SELECT COUNT(*) FROM public.announcement_reads WHERE announcement_id = %L', v_ann_all));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Técnico A no vio su lectura única'; END IF;

    -- Coordinador ve quién leyó
    v_count := test_support.count_as(v_coord_id, format('SELECT COUNT(*) FROM public.announcement_reads WHERE announcement_id = %L', v_ann_all));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Coordinador no vio la lectura'; END IF;

    -- 3. UPDATE directo sobre announcements -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('UPDATE public.announcements SET body = ''Hack'' WHERE id = %L', v_ann_all),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'UPDATE directo sobre announcements permitido'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 17. AVISO DE LECTURA PENDIENTE
-- ==============================================================================

-- 17.1: Aviso pendiente: get_pending_readings_for con control horario, descarte de locales con lectura y filtrado por rol
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Aviso pendiente: control horario, lectura existente y filtro de locales';
    v_store_a UUID;
    v_store_b UUID;
    v_tech_a UUID;
    v_coord_id UUID;
    v_count INT;
    v_bsas_date DATE := public.get_buenos_aires_date();
    v_time_before TIMESTAMPTZ;
    v_time_after TIMESTAMPTZ;
BEGIN
    v_store_a := test_support.create_store('PND1A', 'Store A', 40.0);
    v_store_b := test_support.create_store('PND1B', 'Store B', 40.0);
    v_tech_a := test_support.create_user('tech_pnd_a@mcd.com', 'technician', 'approved', v_store_a);
    v_coord_id := test_support.create_user('coord_pnd@mcd.com', 'coordinator', 'approved');

    v_time_before := (v_bsas_date || ' 10:00:00 America/Argentina/Buenos_Aires')::TIMESTAMPTZ;
    v_time_after  := (v_bsas_date || ' 14:00:00 America/Argentina/Buenos_Aires')::TIMESTAMPTZ;

    -- 1. Antes de las 12:00 -> Devuelve vacío (0 filas)
    SELECT COUNT(*) INTO v_count FROM public.get_pending_readings_for(v_tech_a, v_time_before) WHERE store_id = v_store_a;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Antes de las 12:00 devolvió % locales, esperado 0', v_count; END IF;

    -- 2. Después de las 12:00 -> Técnico A ve solo Store A (1 fila)
    SELECT COUNT(*) INTO v_count FROM public.get_pending_readings_for(v_tech_a, v_time_after) WHERE store_id = v_store_a;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Técnico A vio % locales pendientes, esperado 1 (Store A)', v_count; END IF;

    -- Coordinador ve Store A y Store B (filtrado por los dos locales creados)
    SELECT COUNT(*) INTO v_count FROM public.get_pending_readings_for(v_coord_id, v_time_after) WHERE store_id IN (v_store_a, v_store_b);
    IF v_count <> 2 THEN RAISE EXCEPTION 'Coordinador vio % locales pendientes, esperado 2', v_count; END IF;

    -- 3. Se registra lectura de hoy en Store A -> Store A desaparece de la lista
    INSERT INTO public.meter_readings (store_id, reading_date, display_value, recorded_by)
    VALUES (v_store_a, v_bsas_date, 500.0, v_tech_a);

    SELECT COUNT(*) INTO v_count FROM public.get_pending_readings_for(v_tech_a, v_time_after) WHERE store_id = v_store_a;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Store A no desapareció tras registrar lectura de hoy'; END IF;

    SELECT COUNT(*) INTO v_count FROM public.get_pending_readings_for(v_coord_id, v_time_after) WHERE store_id IN (v_store_a, v_store_b);
    IF v_count <> 1 THEN RAISE EXCEPTION 'Coordinador vio % locales tras lectura de Store A, esperado 1 (Store B)', v_count; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- 17.2: Aviso pendiente: get_pending_readings_today exige usuario aprobado
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Aviso pendiente: get_pending_readings_today exige usuario aprobado';
    v_pending_id UUID;
    v_tech_id UUID;
    v_store_id UUID;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('PND2', 'Store PND2', 40.0);
    v_pending_id := test_support.create_user('pend_pnd2@mcd.com', NULL, 'pending');
    v_tech_id := test_support.create_user('tech_pnd2@mcd.com', 'technician', 'approved', v_store_id);

    -- Usuario pendiente llama a get_pending_readings_today -> Rechazado
    v_blocked := test_support.expect_error_as(
        v_pending_id,
        'SELECT * FROM public.get_pending_readings_today()',
        'P0001',
        'el usuario no está aprobado'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Usuario pendiente pudo ejecutar get_pending_readings_today'; END IF;

    -- Control positivo: técnico aprobado ejecuta con éxito
    PERFORM test_support.run_as(v_tech_id, 'SELECT * FROM public.get_pending_readings_today()');

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 18. INTEGRIDAD REFERENCIAL
-- ==============================================================================

-- 18.1: Integridad: eliminación de local con lecturas existentes rechazada por clave foránea (23503)
BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'Integridad: borrado de local con lecturas rechazado (FK 23503)';
    v_store_id UUID;
    v_tech_id UUID;
    v_empty_store_id UUID;
    v_blocked BOOLEAN;
    v_count INT;
BEGIN
    v_store_id := test_support.create_store('INT1', 'Store Con Lectura', 40.0);
    v_empty_store_id := test_support.create_store('INT2', 'Store Vacio', 40.0);
    v_tech_id := test_support.create_user('tech_int@mcd.com', 'technician', 'approved', v_store_id);

    -- Insertar lectura en Store INT1
    INSERT INTO public.meter_readings (store_id, reading_date, display_value, recorded_by)
    VALUES (v_store_id, public.get_buenos_aires_date(), 100.0, v_tech_id);

    -- Intento de borrado de local con lecturas -> Error 23503 / 23001
    BEGIN
        DELETE FROM public.stores WHERE id = v_store_id;
        v_blocked := false;
    EXCEPTION 
        WHEN foreign_key_violation THEN
            v_blocked := true;
        WHEN restrict_violation THEN
            v_blocked := true;
    END;

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Vulnerabilidad: Se permitió eliminar local con lecturas';
    END IF;

    -- Releer como postgres: el local sigue existiendo intacto
    SELECT COUNT(*) INTO v_count FROM public.stores WHERE id = v_store_id;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Estado modificado: store fue eliminado'; END IF;

    -- Control positivo: local sin referencias sí se puede borrar
    DELETE FROM public.stores WHERE id = v_empty_store_id;
    SELECT COUNT(*) INTO v_count FROM public.stores WHERE id = v_empty_store_id;
    IF v_count <> 0 THEN RAISE EXCEPTION 'Control positivo falló: local vacío no fue borrado'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 20. B2: MATRIZ DE LLAMANTES NO APROBADOS (pending, rejected, inactive)
-- ==============================================================================

BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'B2: Matriz llamantes no aprobados: denegación total e integridad de estado';
    v_statuses TEXT[] := ARRAY['pending', 'rejected', 'inactive'];
    v_st TEXT;
    v_store_a UUID;
    v_store_b UUID;
    v_part_id UUID;
    v_admin_id UUID;
    v_target_user_id UUID;
    v_caller_id UUID;
    v_req_id UUID;
    v_ann_id UUID;
    v_assign_id UUID;
    v_blocked BOOLEAN;
    v_count INT;
    v_chk_role public.user_role;
    v_chk_status public.user_status;
    v_chk_closed_by UUID;
    v_chk_archived BOOLEAN;
BEGIN
    v_store_a := test_support.create_store('B2A', 'Store B2 A', 40.0);
    v_store_b := test_support.create_store('B2B', 'Store B2 B', 40.0);
    v_part_id := test_support.create_part('Repuesto B2', 'unit');
    v_admin_id := test_support.create_user('admin_b2@mcd.com', 'admin', 'approved');

    FOREACH v_st IN ARRAY v_statuses LOOP
        -- Crear el llamador no aprobado
        IF v_st = 'pending' THEN
            v_caller_id := test_support.create_user('caller_' || v_st || '@mcd.com', NULL, 'pending');
        ELSIF v_st = 'rejected' THEN
            v_caller_id := test_support.create_user('caller_' || v_st || '@mcd.com', NULL, 'rejected');
        ELSE -- inactive
            -- Caso especial: Inactivo que antes fue aprobado y tenía asignaciones
            v_caller_id := test_support.create_user('caller_' || v_st || '@mcd.com', 'technician', 'approved', v_store_a);
            UPDATE public.profiles SET status = 'inactive' WHERE id = v_caller_id;
        END IF;

        -- Target legítimo y objetos de prueba para comprobar que su estado no es mutado
        v_target_user_id := test_support.create_user('target_' || v_st || '@mcd.com', 'technician', 'approved', v_store_a);
        SELECT id INTO v_assign_id FROM public.user_stores WHERE user_id = v_target_user_id AND ends_at IS NULL LIMIT 1;

        -- Petición de repuesto abierta creada por admin
        INSERT INTO public.stock_requests (store_id, part_id, requester_id)
        VALUES (v_store_a, v_part_id, v_admin_id) RETURNING id INTO v_req_id;

        -- Anuncio activo creado por admin
        INSERT INTO public.announcements (body, target_type, author_id)
        VALUES ('Anuncio B2 ' || v_st, 'all', v_admin_id) RETURNING id INTO v_ann_id;

        -- 1. approve_user -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.approve_user(%L, ''technician''::public.user_role, %L)', v_target_user_id, v_store_a),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar approve_user', v_st; END IF;

        -- 2. set_user_status -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.set_user_status(%L, ''inactive''::public.user_status)', v_target_user_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar set_user_status', v_st; END IF;

        -- 3. assign_user_role -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.assign_user_role(%L, ''coordinator''::public.user_role)', v_target_user_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar assign_user_role', v_st; END IF;

        -- 4. assign_store -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.assign_store(%L, %L, NULL)', v_target_user_id, v_store_b),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar assign_store', v_st; END IF;

        -- 5. end_store_assignment -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.end_store_assignment(%L)', v_assign_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar end_store_assignment', v_st; END IF;

        -- 6. move_user_store -> P0001 (incluye inactivo que intenta mover a otro técnico)
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.move_user_store(%L, %L, %L)', v_target_user_id, v_store_a, v_store_b),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar move_user_store', v_st; END IF;

        -- 7. close_stock_request -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.close_stock_request(%L)', v_req_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar close_stock_request', v_st; END IF;

        -- 8. archive_announcement -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.archive_announcement(%L)', v_ann_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar archive_announcement', v_st; END IF;

        -- 9. mark_announcement_read -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.mark_announcement_read(%L)', v_ann_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar mark_announcement_read', v_st; END IF;

        -- 10. register_stock_movement -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('SELECT public.register_stock_movement(%L, %L, ''adjustment''::public.stock_movement_type, 1.0, ''intento'')', v_store_a, v_part_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar register_stock_movement', v_st; END IF;

        -- 11. get_pending_readings_today -> P0001
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            'SELECT * FROM public.get_pending_readings_today()',
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo llamar get_pending_readings_today', v_st; END IF;

        -- 12. INSERT en stock_requests -> P0001 (Trigger valida aprobación)
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('INSERT INTO public.stock_requests (store_id, part_id) VALUES (%L, %L)', v_store_a, v_part_id),
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo hacer INSERT en stock_requests', v_st; END IF;

        -- 13. INSERT en announcements -> P0001 (Trigger valida aprobación)
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            'INSERT INTO public.announcements (body, target_type) VALUES (''Hack'', ''all'')',
            'P0001',
            'aprobado'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo hacer INSERT en announcements', v_st; END IF;

        -- 14. INSERT en stock_request_views -> 42501 (RLS deniega inserción)
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('INSERT INTO public.stock_request_views (request_id) VALUES (%L)', v_req_id),
            '42501'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo hacer INSERT en stock_request_views', v_st; END IF;

        -- 15. INSERT en meter_readings -> P0001 (Trigger valida acceso al local)
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            format('INSERT INTO public.meter_readings (store_id, reading_date, display_value) VALUES (%L, public.get_buenos_aires_date(), 100.0)', v_store_a),
            'P0001'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo hacer INSERT en meter_readings', v_st; END IF;

        -- 16. INSERT en invitations -> 42501 (RLS deniega inserción)
        v_blocked := test_support.expect_error_as(
            v_caller_id,
            'INSERT INTO public.invitations (token_hash, expires_at) VALUES (''hacked_token'', now() + INTERVAL ''1 day'')',
            '42501'
        );
        IF NOT v_blocked THEN RAISE EXCEPTION 'Estado % pudo hacer INSERT en invitations', v_st; END IF;

        -- COMPROBACIÓN DE ESTADO INTACTO (releyendo como postgres):
        SELECT role, status INTO v_chk_role, v_chk_status FROM public.profiles WHERE id = v_target_user_id;
        IF v_chk_role <> 'technician' OR v_chk_status <> 'approved' THEN
            RAISE EXCEPTION 'Estado de target alterado por %: role=%, status=%', v_st, v_chk_role, v_chk_status;
        END IF;

        SELECT COUNT(*) INTO v_count FROM public.user_stores WHERE id = v_assign_id AND ends_at IS NULL;
        IF v_count <> 1 THEN RAISE EXCEPTION 'Asignación de target fue alterada por %', v_st; END IF;

        SELECT closed_by INTO v_chk_closed_by FROM public.stock_requests WHERE id = v_req_id;
        IF v_chk_closed_by IS NOT NULL THEN RAISE EXCEPTION 'Petición cerrada indebidamente por %', v_st; END IF;

        SELECT (archived_at IS NOT NULL) INTO v_chk_archived FROM public.announcements WHERE id = v_ann_id;
        IF v_chk_archived = true THEN RAISE EXCEPTION 'Anuncio archivado indebidamente por %', v_st; END IF;

        SELECT COUNT(*) INTO v_count FROM public.announcement_reads WHERE announcement_id = v_ann_id;
        IF v_count <> 0 THEN RAISE EXCEPTION 'Lectura de anuncio creada indebidamente por %', v_st; END IF;

        SELECT COUNT(*) INTO v_count FROM public.stock_movements WHERE store_id = v_store_a AND part_id = v_part_id;
        IF v_count <> 0 THEN RAISE EXCEPTION 'Movimiento de stock registrado indebidamente por %', v_st; END IF;

        SELECT COUNT(*) INTO v_count FROM public.meter_readings WHERE store_id = v_store_a;
        IF v_count <> 0 THEN RAISE EXCEPTION 'Lectura insertada indebidamente por %', v_st; END IF;

        SELECT COUNT(*) INTO v_count FROM public.invitations WHERE token_hash = 'hacked_token';
        IF v_count <> 0 THEN RAISE EXCEPTION 'Invitación creada indebidamente por %', v_st; END IF;
    END LOOP;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 21. B3: MATRIZ DE ROLES APROBADOS (técnico vs coordinador y admin)
-- ==============================================================================

BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'B3: Matriz roles aprobados: técnico restringido, coordinador y admin autorizados';
    v_store_a UUID;
    v_store_b UUID;
    v_part_id UUID;
    v_tech_a UUID;
    v_tech_b UUID;
    v_coord UUID;
    v_admin UUID;
    v_req_tech_a UUID;
    v_req_tech_b UUID;
    v_ann_coord UUID;
    v_assign_tech_b UUID;
    v_blocked BOOLEAN;
    v_status TEXT;
    v_count INT;
BEGIN
    v_store_a := test_support.create_store('B3A', 'Store B3 A', 40.0);
    v_store_b := test_support.create_store('B3B', 'Store B3 B', 40.0);
    v_part_id := test_support.create_part('Repuesto B3', 'unit');
    v_tech_a := test_support.create_user('tech_b3_a@mcd.com', 'technician', 'approved', v_store_a);
    v_tech_b := test_support.create_user('tech_b3_b@mcd.com', 'technician', 'approved', v_store_b);
    v_coord := test_support.create_user('coord_b3@mcd.com', 'coordinator', 'approved');
    v_admin := test_support.create_user('admin_b3@mcd.com', 'admin', 'approved');

    SELECT id INTO v_assign_tech_b FROM public.user_stores WHERE user_id = v_tech_b AND ends_at IS NULL LIMIT 1;

    INSERT INTO public.stock_requests (store_id, part_id, requester_id)
    VALUES (v_store_a, v_part_id, v_tech_a) RETURNING id INTO v_req_tech_a;

    INSERT INTO public.stock_requests (store_id, part_id, requester_id)
    VALUES (v_store_b, v_part_id, v_tech_b) RETURNING id INTO v_req_tech_b;

    -- --- 1. NEGATIVAS DEL TÉCNICO ---
    -- 1.1 Técnico no puede llamar approve_user
    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.approve_user(%L, ''technician'', %L)', v_tech_b, v_store_a), 'P0001', 'admin o coordinador');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo llamar approve_user'; END IF;

    -- 1.2 Técnico no puede llamar set_user_status
    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.set_user_status(%L, ''inactive'')', v_tech_b), 'P0001', 'admin o coordinador');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo llamar set_user_status'; END IF;

    -- 1.3 Técnico no puede llamar assign_user_role
    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.assign_user_role(%L, ''coordinator'')', v_tech_b), 'P0001', 'solo un administrador');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo llamar assign_user_role'; END IF;

    -- 1.4 Técnico no puede llamar assign_store
    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.assign_store(%L, %L, NULL)', v_tech_b, v_store_a), 'P0001', 'solo admin o coordinador');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo llamar assign_store'; END IF;

    -- 1.5 Técnico no puede llamar end_store_assignment
    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.end_store_assignment(%L)', v_assign_tech_b), 'P0001', 'solo admin o coordinador');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo llamar end_store_assignment'; END IF;

    -- 1.6 Técnico no puede llamar move_user_store
    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.move_user_store(%L, %L, %L)', v_tech_b, v_store_b, v_store_a), 'P0001', 'solo admin o coordinador');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo llamar move_user_store'; END IF;

    -- 1.7 Técnico no puede crear anuncios
    v_blocked := test_support.expect_error_as(v_tech_a, 'INSERT INTO public.announcements (body, target_type) VALUES (''Aviso Tech'', ''all'')', 'P0001', 'solo admin o coordinador pueden publicar anuncios');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo crear anuncio'; END IF;

    -- 1.8 Técnico no puede archivar anuncios
    PERFORM test_support.run_as(v_coord, 'INSERT INTO public.announcements (body, target_type) VALUES (''Anuncio Coord'', ''all'')');
    SELECT id INTO v_ann_coord FROM public.announcements WHERE body = 'Anuncio Coord';

    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.archive_announcement(%L)', v_ann_coord), 'P0001', 'solo admin o coordinador pueden archivar');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico pudo archivar anuncio'; END IF;

    -- 1.9 Técnico A no puede cerrar petición de Técnico B
    v_blocked := test_support.expect_error_as(v_tech_a, format('SELECT public.close_stock_request(%L)', v_req_tech_b), 'P0001', 'solo el creador, el coordinador o el admin');
    IF NOT v_blocked THEN RAISE EXCEPTION 'Técnico A pudo cerrar petición de Técnico B'; END IF;

    -- --- 2. POSITIVAS DE COORDINADOR Y ADMIN ---
    -- 2.1 Coordinador cierra petición de Técnico A (petición de otro)
    PERFORM test_support.run_as(v_coord, format('SELECT public.close_stock_request(%L)', v_req_tech_a));
    SELECT status INTO v_status FROM public.stock_requests WHERE id = v_req_tech_a;
    IF v_status <> 'closed' THEN RAISE EXCEPTION 'Coordinador no pudo cerrar petición de Técnico A'; END IF;

    -- 2.2 Admin cierra petición de Técnico B (petición de otro)
    PERFORM test_support.run_as(v_admin, format('SELECT public.close_stock_request(%L)', v_req_tech_b));
    SELECT status INTO v_status FROM public.stock_requests WHERE id = v_req_tech_b;
    IF v_status <> 'closed' THEN RAISE EXCEPTION 'Admin no pudo cerrar petición de Técnico B'; END IF;

    -- 2.3 Coordinador archiva anuncio
    PERFORM test_support.run_as(v_coord, format('SELECT public.archive_announcement(%L)', v_ann_coord));
    SELECT (archived_at IS NOT NULL) INTO v_blocked FROM public.announcements WHERE id = v_ann_coord;
    IF NOT v_blocked THEN RAISE EXCEPTION 'Coordinador no pudo archivar anuncio'; END IF;

    -- 2.4 Coordinador puede reasignar local vía move_user_store
    PERFORM test_support.run_as(v_coord, format('SELECT public.move_user_store(%L, %L, %L)', v_tech_b, v_store_b, v_store_a));
    SELECT COUNT(*) INTO v_count FROM public.user_stores WHERE user_id = v_tech_b AND store_id = v_store_a AND ends_at IS NULL;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Coordinador no pudo ejecutar move_user_store'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 22. B4: VISTA PROFILES_DIRECTORY (Seguridad de permisos y barrier)
-- ==============================================================================

BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'B4: Vista profiles_directory: anon denegado total, authenticated solo SELECT, coordinador no hace UPDATE';
    v_store_id UUID;
    v_coord_id UUID;
    v_target_id UUID;
    v_blocked BOOLEAN;
    v_count INT;
BEGIN
    v_store_id := test_support.create_store('B4S', 'Store B4', 40.0);
    v_coord_id := test_support.create_user('coord_b4@mcd.com', 'coordinator', 'approved', v_store_id);
    v_target_id := test_support.create_user('target_b4@mcd.com', 'technician', 'approved', v_store_id);

    -- 1. Rol anon no puede SELECT (42501)
    v_blocked := test_support.expect_error_as_anon(
        'SELECT * FROM public.profiles_directory',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Anon pudo hacer SELECT sobre profiles_directory'; END IF;

    -- 2. Rol anon no puede INSERT (42501)
    v_blocked := test_support.expect_error_as_anon(
        'INSERT INTO public.profiles_directory (id, full_name, role) VALUES (gen_random_uuid(), ''Test'', ''technician'')',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Anon pudo hacer INSERT sobre profiles_directory'; END IF;

    -- 3. Rol anon no puede UPDATE (42501)
    v_blocked := test_support.expect_error_as_anon(
        format('UPDATE public.profiles_directory SET full_name = ''Hacked'' WHERE id = %L', v_target_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Anon pudo hacer UPDATE sobre profiles_directory'; END IF;

    -- 4. Rol anon no puede DELETE (42501)
    v_blocked := test_support.expect_error_as_anon(
        format('DELETE FROM public.profiles_directory WHERE id = %L', v_target_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Anon pudo hacer DELETE sobre profiles_directory'; END IF;

    -- 5. Authenticated (Coordinador) puede SELECT
    v_count := test_support.count_as(v_coord_id, format('SELECT COUNT(*) FROM public.profiles_directory WHERE id = %L', v_target_id));
    IF v_count <> 1 THEN RAISE EXCEPTION 'Coordinador no pudo hacer SELECT sobre profiles_directory'; END IF;

    -- 6. Authenticated no puede INSERT sobre profiles_directory (42501)
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        'INSERT INTO public.profiles_directory (id, full_name, role) VALUES (gen_random_uuid(), ''Hacked'', ''technician'')',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Authenticated pudo hacer INSERT sobre profiles_directory'; END IF;

    -- 7. Authenticated (Coordinador) no puede UPDATE sobre profiles_directory de otro perfil (42501)
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('UPDATE public.profiles_directory SET full_name = ''Hacked Coord'' WHERE id = %L', v_target_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Coordinador pudo hacer UPDATE sobre profiles_directory'; END IF;

    -- 8. Authenticated no puede DELETE sobre profiles_directory (42501)
    v_blocked := test_support.expect_error_as(
        v_coord_id,
        format('DELETE FROM public.profiles_directory WHERE id = %L', v_target_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Authenticated pudo hacer DELETE sobre profiles_directory'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 23. B5: VERIFICACIÓN EXHAUSTIVA DE PRIVILEGIOS POR CATÁLOGO (pg_proc y pg_class)
-- ==============================================================================

BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'B5: Catálogo: verificación exhaustiva de privilegios de funciones y tablas';
    v_expected_auth_functions TEXT[] := ARRAY[
        'approve_user',
        'archive_announcement',
        'assign_store',
        'assign_user_role',
        'close_stock_request',
        'end_store_assignment',
        'get_auth_role',
        'get_buenos_aires_date',
        'get_pending_readings_today',
        'is_user_approved',
        'mark_announcement_read',
        'move_user_store',
        'register_stock_movement',
        'set_user_status',
        'user_has_store_access'
    ];
    v_unexpected_auth_funcs TEXT[];
    v_missing_auth_funcs TEXT[];
    v_anon_funcs TEXT[];
    v_invalid_table_privs TEXT[];
BEGIN
    -- 1. Funciones ejecutables por anon en public -> Debe ser vacía (0)
    SELECT array_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')')
    INTO v_anon_funcs
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND has_function_privilege('anon', p.oid, 'EXECUTE');

    IF v_anon_funcs IS NOT NULL AND array_length(v_anon_funcs, 1) > 0 THEN
        RAISE EXCEPTION 'Vulnerabilidad: anon tiene EXECUTE en funciones de public: %', v_anon_funcs;
    END IF;

    -- 2. Funciones ejecutables por authenticated en public -> Lista exacta
    SELECT array_agg(DISTINCT p.proname::TEXT)
    INTO v_unexpected_auth_funcs
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
      AND p.proname::TEXT <> ALL(v_expected_auth_functions);

    IF v_unexpected_auth_funcs IS NOT NULL AND array_length(v_unexpected_auth_funcs, 1) > 0 THEN
        RAISE EXCEPTION 'Vulnerabilidad: authenticated tiene EXECUTE en funciones no autorizadas: %', v_unexpected_auth_funcs;
    END IF;

    SELECT array_agg(f)
    INTO v_missing_auth_funcs
    FROM unnest(v_expected_auth_functions) AS f
    WHERE NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.proname = f
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );

    IF v_missing_auth_funcs IS NOT NULL AND array_length(v_missing_auth_funcs, 1) > 0 THEN
        RAISE EXCEPTION 'Funciones autorizadas sin permiso EXECUTE para authenticated: %', v_missing_auth_funcs;
    END IF;

    -- 3. Verificación de privilegios de tabla para anon -> CERO privilegios en public
    SELECT array_agg(c.relname || ':' || priv)
    INTO v_invalid_table_privs
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'v')
      AND has_table_privilege('anon', c.oid, p.priv);

    IF v_invalid_table_privs IS NOT NULL AND array_length(v_invalid_table_privs, 1) > 0 THEN
        RAISE EXCEPTION 'Vulnerabilidad: anon posee privilegios sobre tablas/vistas: %', v_invalid_table_privs;
    END IF;

    -- 4. Ni anon ni authenticated tienen TRUNCATE, REFERENCES ni TRIGGER en ninguna tabla
    SELECT array_agg(role_name || ':' || c.relname || ':' || priv)
    INTO v_invalid_table_privs
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role_name)
    CROSS JOIN (VALUES ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'v')
      AND has_table_privilege(role_name, c.oid, p.priv);

    IF v_invalid_table_privs IS NOT NULL AND array_length(v_invalid_table_privs, 1) > 0 THEN
        RAISE EXCEPTION 'Vulnerabilidad: roles poseen privilegios prohibidos (TRUNCATE/REFERENCES/TRIGGER): %', v_invalid_table_privs;
    END IF;

    -- 5. Authenticated no tiene INSERT, UPDATE ni DELETE sobre tablas protegidas:
    -- stock_movements, meter_reading_edits, store_inventory, user_status_history, user_stores, announcement_reads
    SELECT array_agg(c.relname || ':' || priv)
    INTO v_invalid_table_privs
    FROM pg_class c
    JOIN pg_namespace n ON c.relnamespace = n.oid
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN ('stock_movements', 'meter_reading_edits', 'store_inventory', 'user_status_history', 'user_stores', 'announcement_reads')
      AND has_table_privilege('authenticated', c.oid, p.priv);

    IF v_invalid_table_privs IS NOT NULL AND array_length(v_invalid_table_privs, 1) > 0 THEN
        RAISE EXCEPTION 'Vulnerabilidad: authenticated posee escritura directa sobre tablas protegidas: %', v_invalid_table_privs;
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 24. B3b: INTENTO DE BYPASS VÍA SET_CONFIG (app.* flags)
-- ==============================================================================

BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'B3b: Bypass app.*: flags de sesión no anulan permisos de tabla/columna (42501)';
    v_store_id UUID;
    v_tech_id UUID;
    v_blocked BOOLEAN;
BEGIN
    v_store_id := test_support.create_store('BYP1', 'Store Bypass', 40.0);
    v_tech_id := test_support.create_user('tech_byp@mcd.com', 'technician', 'approved', v_store_id);

    -- 1. Intentar alterar role en profiles activando app.profile_system_modifying
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('
            SELECT set_config(''app.profile_system_modifying'', ''true'', true);
            UPDATE public.profiles SET role = ''admin'' WHERE id = %L;
        ', v_tech_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Bypass exitoso: authenticated pudo alterar role activando app.profile_system_modifying'; END IF;

    -- 2. Intentar INSERT directo en user_stores activando app.user_stores_modifying
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('
            SELECT set_config(''app.user_stores_modifying'', ''true'', true);
            INSERT INTO public.user_stores (user_id, store_id, assigned_by) VALUES (%L, %L, %L);
        ', v_tech_id, v_store_id, v_tech_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Bypass exitoso: authenticated pudo insertar en user_stores activando flag'; END IF;

    -- 3. Intentar UPDATE directo en stock_requests activando flags
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        format('
            SELECT set_config(''app.stock_movement_internal'', ''true'', true);
            UPDATE public.stock_requests SET status = ''closed'' WHERE store_id = %L;
        ', v_store_id),
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Bypass exitoso: authenticated pudo actualizar stock_requests'; END IF;

    -- 4. Intentar UPDATE directo en announcements activando flags
    v_blocked := test_support.expect_error_as(
        v_tech_id,
        '
            SELECT set_config(''app.profile_system_modifying'', ''true'', true);
            UPDATE public.announcements SET body = ''Hacked'' WHERE true;
        ',
        '42501',
        'permission denied'
    );
    IF NOT v_blocked THEN RAISE EXCEPTION 'Bypass exitoso: authenticated pudo actualizar announcements'; END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 25. B6: VERIFICACIÓN A NIVEL TRIGGER DE LECTURAS PASADAS (como postgres con auth.uid())
-- ==============================================================================

BEGIN;
DO $$
DECLARE
    v_test_name TEXT := 'B6: Trigger lecturas pasadas: bloqueo a nivel trigger incluso como postgres con auth.uid()';
    v_store_id UUID;
    v_tech_id UUID;
    v_reading_past UUID;
    v_blocked BOOLEAN := false;
BEGIN
    v_store_id := test_support.create_store('RD_B6', 'Store B6 RD', 40.0);
    v_tech_id := test_support.create_user('tech_b6@mcd.com', 'technician', 'approved', v_store_id);

    -- Insertar lectura de fecha anterior directamente
    INSERT INTO public.meter_readings (store_id, reading_date, display_value, recorded_by)
    VALUES (v_store_id, public.get_buenos_aires_date() - 2, 100.0, v_tech_id)
    RETURNING id INTO v_reading_past;

    -- Como rol postgres (bypaseando RLS), simular sesión con auth.uid()
    PERFORM set_config('request.jwt.claim.sub', v_tech_id::text, true);

    BEGIN
        UPDATE public.meter_readings SET display_value = 110.0 WHERE id = v_reading_past;
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'P0001' AND SQLERRM ILIKE '%Lectura bloqueada%' THEN
            v_blocked := true;
        ELSE
            RAISE EXCEPTION 'Trigger lanzó error inesperado: % (SQLSTATE %)', SQLERRM, SQLSTATE;
        END IF;
    END;

    -- Limpiar claims
    PERFORM set_config('request.jwt.claim.sub', '', true);

    IF NOT v_blocked THEN
        RAISE EXCEPTION 'Vulnerabilidad: Trigger no bloqueó edición de lectura pasada';
    END IF;

    PERFORM test_support.record_pass(v_test_name);
EXCEPTION WHEN OTHERS THEN
    PERFORM test_support.record_fail(v_test_name, SQLERRM);
END $$;
ROLLBACK;

-- ==============================================================================
-- 99. RESUMEN FINAL Y LIMPIEZA DEL ENTORNO DE PRUEBAS
-- ==============================================================================

DO $$
DECLARE
    v_pass INT;
    v_fail INT;
BEGIN
    BEGIN
        v_pass := currval('test_support.test_pass_seq');
    EXCEPTION WHEN OTHERS THEN
        v_pass := 0;
    END;

    BEGIN
        v_fail := currval('test_support.test_fail_seq');
    EXCEPTION WHEN OTHERS THEN
        v_fail := 0;
    END;

    RAISE NOTICE '==================================================';
    RAISE NOTICE 'RESUMEN FINAL DE PRUEBAS: Total: % | PASS: % | FAIL: %', (v_pass + v_fail), v_pass, v_fail;
    RAISE NOTICE '==================================================';

    -- Eliminar esquema de pruebas antes de evaluar código de salida
    DROP SCHEMA IF EXISTS test_support CASCADE;

    IF v_fail > 0 THEN
        RAISE EXCEPTION 'TEST SUITE FAILED: % prueba(s) fallaron.', v_fail;
    END IF;
END $$;
