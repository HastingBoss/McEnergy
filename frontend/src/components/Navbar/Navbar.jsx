import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Zap, TrendingUp, BarChart3, ChevronDown, Check, Building2 } from 'lucide-react';
import { useStore } from '../../context/StoreContext';

export default function Navbar() {
  const { stores, currentStore, setCurrentStore } = useStore();
  const [showStoreModal, setShowStoreModal] = useState(false);

  return (
    <>
      {/* Top Header */}
      <header style={{
        backgroundColor: '#1E1E1E',
        borderBottom: '1px solid #2D2D2D',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            backgroundColor: '#DA291C',
            width: '34px',
            height: '34px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '900',
            color: '#FFBC0D',
            fontSize: '20px',
            boxShadow: '0 2px 6px rgba(218, 41, 28, 0.4)'
          }}>
            M
          </div>
          <div>
            <h1 style={{ fontSize: '0.95rem', fontWeight: '700', margin: 0, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
              Control Eléctrico McD
            </h1>
            <p style={{ fontSize: '0.72rem', color: '#A0A0A0', margin: 0 }}>
              Cálculo de Medidores & Comparativa
            </p>
          </div>
        </div>

        {/* Store Selector Button */}
        <button
          onClick={() => setShowStoreModal(true)}
          style={{
            backgroundColor: '#262626',
            border: '1px solid #383838',
            borderRadius: '20px',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#FFBC0D',
            fontSize: '0.85rem',
            fontWeight: '700'
          }}
        >
          <Building2 size={15} />
          <span>{currentStore?.code || 'Local'}</span>
          <ChevronDown size={14} color="#A0A0A0" />
        </button>
      </header>

      {/* Store Selector Modal */}
      {showStoreModal && (
        <div
          onClick={() => setShowStoreModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(3px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#1E1E1E',
              borderTopLeftRadius: '20px',
              borderTopRightRadius: '20px',
              border: '1px solid #333333',
              width: '100%',
              maxWidth: '520px',
              maxHeight: '80vh',
              overflowY: 'auto',
              padding: '20px 16px 36px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#FFFFFF', margin: 0 }}>
                  Seleccionar Local
                </h3>
                <p style={{ fontSize: '0.75rem', color: '#888888', margin: '2px 0 0 0' }}>
                  Elige el local para cargar o consultar lecturas
                </p>
              </div>
              <button
                onClick={() => setShowStoreModal(false)}
                style={{
                  backgroundColor: '#2A2A2A',
                  color: '#C0C0C0',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  padding: 0,
                  fontSize: '1.2rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {stores.map((s) => {
                const isSelected = currentStore?.id === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      setCurrentStore(s);
                      setShowStoreModal(false);
                    }}
                    style={{
                      backgroundColor: isSelected ? '#2E2616' : '#262626',
                      border: isSelected ? '1px solid #FFBC0D' : '1px solid #333333',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      textAlign: 'left'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ fontSize: '1rem', color: isSelected ? '#FFBC0D' : '#FFFFFF' }}>
                          {s.name}
                        </strong>
                        <span style={{
                          backgroundColor: '#1A1A1A',
                          color: '#A0A0A0',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem'
                        }}>
                          {s.code}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#888888', marginTop: '3px' }}>
                        Medidor: {s.meter_model || 'Directo'} {s.meter_multiplier && s.meter_multiplier !== 1 ? `(TC x${s.meter_multiplier})` : ''} • Display: {s.display_indicator || 'kWh'}
                      </div>
                    </div>
                    {isSelected && <Check size={18} color="#FFBC0D" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Mobile Tab Bar */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#1A1A1A',
        borderTop: '1px solid #2D2D2D',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '8px 4px calc(8px + env(safe-area-inset-bottom, 0px))',
        zIndex: 100
      }}>
        <NavLink
          to="/"
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            color: isActive ? '#FFBC0D' : '#888888',
            textDecoration: 'none',
            fontSize: '0.72rem',
            fontWeight: isActive ? '700' : '400',
            flex: 1
          })}
        >
          <Zap size={20} />
          <span>Lectura</span>
        </NavLink>

        <NavLink
          to="/comparison"
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            color: isActive ? '#FFBC0D' : '#888888',
            textDecoration: 'none',
            fontSize: '0.72rem',
            fontWeight: isActive ? '700' : '400',
            flex: 1
          })}
        >
          <TrendingUp size={20} />
          <span>Comparativa</span>
        </NavLink>

        <NavLink
          to="/dashboard"
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            color: isActive ? '#FFBC0D' : '#888888',
            textDecoration: 'none',
            fontSize: '0.72rem',
            fontWeight: isActive ? '700' : '400',
            flex: 1
          })}
        >
          <BarChart3 size={20} />
          <span>Red Global</span>
        </NavLink>
      </nav>
    </>
  );
}
