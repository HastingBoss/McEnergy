import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

const FIVE_STORES = [
  { id: '11111111-1111-1111-1111-111111111004', code: 'AR6', name: "McDonald's AR6", meter_model: 'Circutor CVM-C10', display_indicator: 'kWh', meter_multiplier: 1.0 },
  { id: '11111111-1111-1111-1111-111111111003', code: 'AR3', name: "McDonald's AR3", meter_model: 'Schneider PM5350', display_indicator: 'kWh', meter_multiplier: 1.0 },
  { id: '11111111-1111-1111-1111-111111111005', code: 'MTD', name: "McDonald's MTD", meter_model: 'Schneider PM5350', display_indicator: '1.8.0', meter_multiplier: 60.0 },
  { id: '11111111-1111-1111-1111-111111111009', code: 'DEV', name: "McDonald's DEV", meter_model: 'Schneider PM5350', display_indicator: '1.8.0', meter_multiplier: 40.0 },
  { id: '11111111-1111-1111-1111-111111111008', code: 'DEN', name: "McDonald's DEN", meter_model: 'Circutor CVM-C10', display_indicator: 'Active Energy', meter_multiplier: 40.0 }
];

const StoreContext = createContext({
  stores: [],
  currentStore: null,
  setCurrentStore: () => {},
  defaultStore: null,
  setDefaultStore: () => {},
  loading: true,
  refreshStores: () => {}
});

export function StoreProvider({ children }) {
  const [stores, setStores] = useState(FIVE_STORES);
  const [currentStore, setCurrentStoreState] = useState(FIVE_STORES[0]);
  const [defaultStore, setDefaultStoreState] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadStores = async () => {
    try {
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .in('code', ['AR6', 'AR3', 'MTD', 'DEV', 'DEN'])
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      const loadedList = (data && data.length > 0) ? data : FIVE_STORES;
      const storeCodes = ['AR6', 'AR3', 'MTD', 'DEV', 'DEN'];
      const ordered = storeCodes
        .map((code) => loadedList.find((s) => s.code === code))
        .filter(Boolean);

      const finalStores = ordered.length > 0 ? ordered : loadedList;
      setStores(finalStores);

      // Cargar local por defecto y último seleccionado
      const defaultStoreId = localStorage.getItem('mcd_default_store_id');
      const defMatch = finalStores.find((s) => s.id === defaultStoreId || s.code === defaultStoreId);
      setDefaultStoreState(defMatch || null);

      const savedStoreId = defaultStoreId || localStorage.getItem('mcd_last_store_id');
      const match = finalStores.find((s) => s.id === savedStoreId || s.code === savedStoreId);
      setCurrentStoreState(match || defMatch || finalStores[0]);
    } catch (err) {
      console.warn('Usando configuración local de los 5 locales:', err.message);
      const defaultStoreId = localStorage.getItem('mcd_default_store_id');
      const defMatch = FIVE_STORES.find((s) => s.id === defaultStoreId || s.code === defaultStoreId);
      setDefaultStoreState(defMatch || null);

      const savedStoreId = defaultStoreId || localStorage.getItem('mcd_last_store_id');
      const match = FIVE_STORES.find((s) => s.id === savedStoreId || s.code === savedStoreId);
      setCurrentStoreState(match || defMatch || FIVE_STORES[0]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const setCurrentStore = (store) => {
    setCurrentStoreState(store);
    if (store?.id) {
      localStorage.setItem('mcd_last_store_id', store.id);
    }
  };

  const setDefaultStore = (store) => {
    if (!store) {
      localStorage.removeItem('mcd_default_store_id');
      setDefaultStoreState(null);
      return;
    }

    if (defaultStore?.id === store.id) {
      // Toggle off si se vuelve a clickear el mismo
      localStorage.removeItem('mcd_default_store_id');
      setDefaultStoreState(null);
    } else {
      localStorage.setItem('mcd_default_store_id', store.id);
      setDefaultStoreState(store);
    }
  };

  return (
    <StoreContext.Provider
      value={{
        stores,
        currentStore,
        setCurrentStore,
        defaultStore,
        setDefaultStore,
        loading,
        refreshStores: loadStores
      }}
    >
      {children}
    </StoreContext.Provider>
  );
}

export const useStore = () => useContext(StoreContext);
