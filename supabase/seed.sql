-- ==============================================================================
-- SEMILLA DE LECTURAS HISTÓRICAS PARA COMPARATIVA INTERANUAL (2025 vs 2026)
-- Permite validar inmediatamente la comparación de consumo día a día y mensual
-- ==============================================================================

DO $$
DECLARE
    rec_store RECORD;
    v_date_2025 DATE;
    v_date_2026 DATE;
    v_day INT;
    v_base_kwh NUMERIC;
    v_daily_kwh NUMERIC;
    v_current_kwh NUMERIC;
    v_display NUMERIC;
BEGIN
    FOR rec_store IN SELECT id, code, meter_multiplier FROM public.stores WHERE code IN ('AR6', 'AR3', 'MTD', 'DEV', 'DEN') LOOP
        -- Consumo base diario aproximado según local
        v_base_kwh := CASE rec_store.code
            WHEN 'MTD' THEN 960.0
            WHEN 'AR6' THEN 650.0
            WHEN 'AR3' THEN 880.0
            WHEN 'DEV' THEN 920.0
            WHEN 'DEN' THEN 710.0
            ELSE 600.0
        END;

        -- 1. Generar lecturas de Octubre 2025 (Año Anterior)
        v_current_kwh := 500000.0;
        FOR v_day IN 1..31 LOOP
            v_date_2025 := make_date(2025, 10, v_day);
            -- Variación diaria realista (±10%)
            v_daily_kwh := ROUND(v_base_kwh * (0.92 + (v_day % 5) * 0.04), 2);
            v_current_kwh := v_current_kwh + v_daily_kwh;
            v_display := ROUND(v_current_kwh / COALESCE(rec_store.meter_multiplier, 1.0), 3);

            INSERT INTO public.meter_readings (
                store_id, reading_date, display_value, applied_multiplier,
                kwh_reading, calculated_consumption, technician_name
            ) VALUES (
                rec_store.id, v_date_2025, v_display, rec_store.meter_multiplier,
                v_current_kwh, v_daily_kwh, 'Técnico Guardia'
            )
            ON CONFLICT (store_id, reading_date) DO UPDATE
            SET display_value = EXCLUDED.display_value,
                kwh_reading = EXCLUDED.kwh_reading,
                calculated_consumption = EXCLUDED.calculated_consumption;
        END LOOP;

        -- 2. Generar lecturas de Octubre 2026 (Año Actual hasta el día 13)
        v_current_kwh := 850000.0;
        FOR v_day IN 1..13 LOOP
            v_date_2026 := make_date(2026, 10, v_day);
            -- Consumo 2026 con ligera reducción del ~3% (eficiencia energética)
            v_daily_kwh := ROUND(v_base_kwh * 0.97 * (0.91 + (v_day % 4) * 0.05), 2);
            v_current_kwh := v_current_kwh + v_daily_kwh;
            v_display := ROUND(v_current_kwh / COALESCE(rec_store.meter_multiplier, 1.0), 3);

            INSERT INTO public.meter_readings (
                store_id, reading_date, display_value, applied_multiplier,
                kwh_reading, calculated_consumption, technician_name
            ) VALUES (
                rec_store.id, v_date_2026, v_display, rec_store.meter_multiplier,
                v_current_kwh, v_daily_kwh, 'Técnico Guardia'
            )
            ON CONFLICT (store_id, reading_date) DO UPDATE
            SET display_value = EXCLUDED.display_value,
                kwh_reading = EXCLUDED.kwh_reading,
                calculated_consumption = EXCLUDED.calculated_consumption;
        END LOOP;
    END LOOP;
END $$;
