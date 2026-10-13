-- ==============================================================================
-- DATABASE SEED: MCDONALD'S PWA MAINTENANCE & INVENTORY
-- Engine: PostgreSQL 15+ (Supabase)
-- Re-ejecutable sin errores (Idempotente)
-- ==============================================================================

-- 1. LOCALES (stores)
INSERT INTO public.stores (code, name, is_active, meter_model, display_indicator, meter_multiplier) VALUES
('PLS', 'PLS', true, NULL, NULL, NULL),
('PBJ', 'PBJ', true, NULL, NULL, NULL),
('AR3', 'AR3', true, NULL, NULL, NULL),
('AR6', 'AR6', true, NULL, NULL, NULL),
('MTD', 'MTD', true, 'Schneider PM5350', '1.8.0', 40.0000),
('JNN', 'JNN', true, NULL, NULL, NULL),
('HAS', 'HAS', true, NULL, NULL, NULL),
('DEN', 'DEN', true, NULL, NULL, NULL),
('DEV', 'DEV', true, NULL, NULL, NULL)
ON CONFLICT (code) DO UPDATE
SET is_active = EXCLUDED.is_active,
    meter_model = COALESCE(stores.meter_model, EXCLUDED.meter_model),
    display_indicator = COALESCE(stores.display_indicator, EXCLUDED.display_indicator),
    meter_multiplier = COALESCE(stores.meter_multiplier, EXCLUDED.meter_multiplier);

-- 2. CATEGORÍAS (part_categories)
INSERT INTO public.part_categories (name, description) VALUES
('Pinturas e insumos de pinturería', 'Esmaltes, látex, rodillos, solventes y preparación de superficies de locales'),
('Parrilla', 'Repuestos para parrillas Garland, Nieco y clamshells automáticos'),
('Freidora', 'Componentes para freidoras Frymaster, Henny Penny y zonas de filtrado de aceite'),
('Insumos eléctricos e instalación', 'Cables normalizados, contactores, térmicas, disyuntores y borneras'),
('Teclados y membranas', 'Interfaces táctiles, membranas M3000 y botoneras de equipamiento'),
('Plaquetas electrónicas', 'Tarjetas PCB lógicas de control, fuentes conmutadas e interfaces I/O'),
('Controladores y termostatos', 'Sensores NTC/PT100, termostatos de seguridad y pirómetros digitales'),
('Misceláneos', 'Tornillería sanitaria, adhesivos de alta temperatura, selladores RTV y empaquetaduras')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description;

-- 3. CATÁLOGO DE REPUESTOS (spare_parts - 16 ítems cubriendo las 8 categorías)
DO $$
DECLARE
    cat_pinturas UUID;
    cat_parrilla UUID;
    cat_freidora UUID;
    cat_electricos UUID;
    cat_teclados UUID;
    cat_plaquetas UUID;
    cat_controladores UUID;
    cat_miscelaneos UUID;
BEGIN
    SELECT id INTO cat_pinturas FROM public.part_categories WHERE name = 'Pinturas e insumos de pinturería';
    SELECT id INTO cat_parrilla FROM public.part_categories WHERE name = 'Parrilla';
    SELECT id INTO cat_freidora FROM public.part_categories WHERE name = 'Freidora';
    SELECT id INTO cat_electricos FROM public.part_categories WHERE name = 'Insumos eléctricos e instalación';
    SELECT id INTO cat_teclados FROM public.part_categories WHERE name = 'Teclados y membranas';
    SELECT id INTO cat_plaquetas FROM public.part_categories WHERE name = 'Plaquetas electrónicas';
    SELECT id INTO cat_controladores FROM public.part_categories WHERE name = 'Controladores y termostatos';
    SELECT id INTO cat_miscelaneos FROM public.part_categories WHERE name = 'Misceláneos';

    -- 1. Pinturas
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Látex Lavable Gris Corporativo', cat_pinturas, 'liter', 'Paredes interiores de cocina, lobby y baños de clientes', 10.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Esmalte Sintético Amarillo McDonald''s', cat_pinturas, 'liter', 'Señalética interna, zócalos metálicos y rampas de descarga', 4.0, true)
    ON CONFLICT DO NOTHING;

    -- 2. Parrilla
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Teflón Superior Release Sheet Garland', cat_parrilla, 'unit', 'Parrillas Garland XPE / MWE clamshell 2 o 3 platen', 6.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Termocupla Platen Superior Garland', cat_parrilla, 'unit', 'Sensor de temperatura platens superiores Garland', 2.0, true)
    ON CONFLICT DO NOTHING;

    -- 3. Freidora
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Termostato Límite Superior High-Limit 232°C', cat_freidora, 'unit', 'Freidoras a gas y eléctricas Frymaster OCF30 / LOV', 2.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Válvula de Drenaje Sanitaria 1 1/4"', cat_freidora, 'unit', 'Bateas de fritura Frymaster y Dean con microswitch de seguridad', 1.0, true)
    ON CONFLICT DO NOTHING;

    -- 4. Insumos eléctricos
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Contactor Tripolar 24V Bobina 25A', cat_electricos, 'unit', 'Tableros de potencia y motores compresores Taylor / Garland', 3.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Termomagnética Bipolar 16A Curva C', cat_electricos, 'unit', 'Circuitos de control secundario tableros seccionales', 4.0, true)
    ON CONFLICT DO NOTHING;

    -- 5. Teclados y membranas
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Membrana Teclado Frymaster M3000', cat_teclados, 'unit', 'Controlador M3000 freidoras de papas y pollo', 1.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Teclado Frontal Taylor C708 / C713', cat_teclados, 'unit', 'Panel de mandos máquinas de helado suave Taylor', 1.0, true)
    ON CONFLICT DO NOTHING;

    -- 6. Plaquetas electrónicas
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Plaqueta Lógica de Control Taylor C708', cat_plaquetas, 'unit', 'Placa base principal máquina de postres Taylor', 1.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Placa Interfaz I/O Garland Grill', cat_plaquetas, 'unit', 'Parrillas automáticas Garland Series XPE', 1.0, true)
    ON CONFLICT DO NOTHING;

    -- 7. Controladores y termostatos
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Controlador Digital Dixell XR60CX', cat_controladores, 'unit', 'Cámaras de congelados, lácteos y heladeras bajo mesada', 2.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Sonda de Temperatura NTC 10K Acero Inox', cat_controladores, 'unit', 'Monitoreo de cámaras frigoríficas y cubas frías', 4.0, true)
    ON CONFLICT DO NOTHING;

    -- 8. Misceláneos
    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Sellador Silicona Alta Temperatura RTV Roja', cat_miscelaneos, 'unit', 'Resiste hasta 315°C, conductos de humos y marcos de parrilla', 4.0, true)
    ON CONFLICT DO NOTHING;

    INSERT INTO public.spare_parts (name, category_id, unit, compatibility_notes, minimum_critical_stock, is_active)
    VALUES ('Kit O-Rings Sanitarios Válvula Taylor', cat_miscelaneos, 'unit', 'Juego de sellos tóricos grado alimenticio Taylor C708/C713', 6.0, true)
    ON CONFLICT DO NOTHING;
END $$;

-- 4. EQUIVALENCIAS DE EJEMPLO (part_equivalencies - sin uso activo por ahora)
DO $$
DECLARE
    part_taylor_key UUID;
    part_taylor_pcb UUID;
BEGIN
    SELECT id INTO part_taylor_key FROM public.spare_parts WHERE name = 'Teclado Frontal Taylor C708 / C713';
    SELECT id INTO part_taylor_pcb FROM public.spare_parts WHERE name = 'Plaqueta Lógica de Control Taylor C708';

    IF part_taylor_key IS NOT NULL AND part_taylor_pcb IS NOT NULL THEN
        INSERT INTO public.part_equivalencies (part_id, equivalent_part_id, notes)
        VALUES (part_taylor_key, part_taylor_pcb, 'Referencia técnica cruzada de subsistema de comando')
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

-- 5. STOCK DE EJEMPLO EN LOCAL "MTD" (Generado exclusivamente vía register_stock_movement)
DO $$
DECLARE
    store_mtd_id UUID;
    part_rec RECORD;
    initial_qty NUMERIC(12, 2);
    shelf_loc VARCHAR(80);
BEGIN
    SELECT id INTO store_mtd_id FROM public.stores WHERE code = 'MTD';

    IF store_mtd_id IS NULL THEN
        RAISE EXCEPTION 'Local MTD no encontrado en la base de datos.';
    END IF;

    FOR part_rec IN 
        SELECT id, name, unit, minimum_critical_stock 
        FROM public.spare_parts 
        ORDER BY name
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.store_inventory 
            WHERE store_id = store_mtd_id AND part_id = part_rec.id
        ) THEN
            IF part_rec.unit = 'liter' THEN
                initial_qty := part_rec.minimum_critical_stock + 15.0;
                shelf_loc := 'Depósito Pinturas - Estante P1';
            ELSE
                initial_qty := part_rec.minimum_critical_stock + 3.0;
                shelf_loc := 'Taller MTD - Gaveta ' || SUBSTRING(part_rec.name, 1, 3);
            END IF;

            PERFORM public.register_stock_movement_system(
                p_store_id => store_mtd_id,
                p_part_id => part_rec.id,
                p_movement_type => 'initial_load'::stock_movement_type,
                p_variation => initial_qty,
                p_notes => 'Stock inicial de puesta en marcha local MTD',
                p_shelf_location => shelf_loc,
                p_user_id => NULL
            );
        END IF;
    END LOOP;
END $$;

-- 6. CONFIGURACIÓN GENERAL (app_config)
INSERT INTO public.app_config (key, value, description)
VALUES ('daily_deviation_threshold_percentage', '5', 'Umbral de desvío en porcentaje sobre el objetivo diario')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value;

-- 7. OBJETIVO MENSUAL DE EJEMPLO PARA MTD (store_monthly_targets)
DO $$
DECLARE
    store_mtd_id UUID;
    curr_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
    curr_month INT := EXTRACT(MONTH FROM CURRENT_DATE)::INT;
BEGIN
    SELECT id INTO store_mtd_id FROM public.stores WHERE code = 'MTD';

    IF store_mtd_id IS NOT NULL THEN
        INSERT INTO public.store_monthly_targets (
            store_id,
            year,
            month,
            base_kwh,
            reduction_percentage
        ) VALUES (
            store_mtd_id,
            curr_year,
            curr_month,
            45000.00,
            3.00
        )
        ON CONFLICT (store_id, year, month) DO NOTHING;
    END IF;
END $$;
