import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Zap, TrendingUp, BarChart3, ChevronDown, Check, Building2, Star, Sparkles } from 'lucide-react';
import { useStore } from '../../context/StoreContext';

export default function Navbar() {
  const { stores, currentStore, setCurrentStore, defaultStore, setDefaultStore } = useStore();
  const [showStoreModal, setShowStoreModal] = useState(false);

  const isCurrentDefault = defaultStore?.id === currentStore?.id;

  return (
    <>
      {/* Top Header - Paleta McDonald's Oficial */}
      <header style={{
        backgroundColor: '#1D1D1D',
        borderBottom: '1px solid #3A3833',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src="/favicon.png"
            alt="McEnergy Logo"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              objectFit: 'cover',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)'
            }}
          />
          <div>
            <h1 style={{ fontSize: '0.98rem', fontWeight: '800', margin: 0, color: '#FFFFFF', letterSpacing: '-0.2px' }}>
              Control Eléctrico McD
            </h1>
            <p style={{ fontSize: '0.72rem', color: '#A0A0A0', margin: 0 }}>
              Cálculo de Medidores & Comparativa
            </p>
          </div>
        </div>

        {/* Store Selector Button - Touch target 48px */}
        <button
          onClick={() => setShowStoreModal(true)}
          style={{
            backgroundColor: '#27251F',
            border: isCurrentDefault ? '1px solid #FFC72C' : '1px solid #3A3833',
            borderRadius: '24px',
            minHeight: '44px',
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            color: '#FFC72C',
            fontSize: '0.85rem',
            fontWeight: '800',
            cursor: 'pointer'
          }}
          title="Cambiar o fijar local"
        >
          {isCurrentDefault ? (
            <Star size={15} fill="#FFC72C" color="#FFC72C" />
          ) : (
            <Building2 size={15} />
          )}
          <span>{currentStore?.code || 'Local'}</span>
          <ChevronDown size={14} color="#A0A0A0" />
        </button>
      </header>

      {/* Store Selector Modal / Drawer Táctil */}
      {showStoreModal && (
        <div
          onClick={() => setShowStoreModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.78)',
            backdropFilter: 'blur(5px)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-slide-up"
            style={{
              backgroundColor: '#1D1D1D',
              borderTopLeftRadius: '22px',
              borderTopRightRadius: '22px',
              border: '1px solid #3A3833',
              width: '100%',
              maxWidth: '520px',
              maxHeight: '85vh',
              overflowY: 'auto',
              padding: '20px 16px 36px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.8)'
            }}
          >
            {/* Encabezado del selector */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: '800', color: '#FFFFFF', margin: 0 }}>
                  Seleccionar Local
                </h3>
                <p style={{ fontSize: '0.78rem', color: '#A0A0A0', margin: '2px 0 0 0' }}>
                  Tocá la estrella para fijar tu <strong>local por defecto</strong> al abrir la app.
                </p>
              </div>
              <button
                onClick={() => setShowStoreModal(false)}
                style={{
                  backgroundColor: '#27251F',
                  color: '#C0C0C0',
                  borderRadius: '50%',
                  width: '36px',
                  height: '36px',
                  minHeight: '36px',
                  padding: 0,
                  fontSize: '1.1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid #3A3833'
                }}
              >
                ✕
              </button>
            </div>

            {/* Banner Local por defecto actual */}
            <div style={{
              backgroundColor: '#27251F',
              border: '1px solid #3A3833',
              borderRadius: '10px',
              padding: '8px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.78rem'
            }}>
              <Star size={16} fill={defaultStore ? '#FFC72C' : 'none'} color="#FFC72C" />
              <span style={{ color: '#CCCCCC' }}>
                Local por defecto: <strong style={{ color: defaultStore ? '#FFC72C' : '#FFFFFF' }}>
                  {defaultStore ? `${defaultStore.name} (${defaultStore.code})` : 'Ninguno fijado'}
                </strong>
              </span>
            </div>

            {/* Lista de locales con target táctil amplio (52px+) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {stores.map((s) => {
                const isSelected = currentStore?.id === s.id;
                const isStoreDefault = defaultStore?.id === s.id;

                return (
                  <div
                    key={s.id}
                    onClick={() => {
                      setCurrentStore(s);
                      setShowStoreModal(false);
                    }}
                    style={{
                      backgroundColor: isSelected ? 'rgba(255, 199, 44, 0.12)' : '#27251F',
                      border: isSelected ? '1px solid #FFC72C' : '1px solid #3A3833',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      minHeight: '52px',
                      transition: 'transform 0.1s ease, border-color 0.2s ease'
                    }}
                    className="card-interactive"
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <strong style={{ fontSize: '0.98rem', color: isSelected ? '#FFC72C' : '#FFFFFF' }}>
                          {s.name}
                        </strong>
                        <span style={{
                          backgroundColor: '#1D1D1D',
                          color: '#A0A0A0',
                          padding: '2px 7px',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: '700'
                        }}>
                          {s.code}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#888888', marginTop: '3px' }}>
                        Medidor: {s.meter_model} • Factor TC: <strong>x{s.meter_multiplier}</strong>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {/* Botón para fijar / alternar Local por defecto */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDefaultStore(s);
                        }}
                        style={{
                          backgroundColor: isStoreDefault ? '#3A2E12' : '#1D1D1D',
                          border: isStoreDefault ? '1px solid #FFC72C' : '1px solid #444',
                          color: isStoreDefault ? '#FFC72C' : '#888888',
                          borderRadius: '8px',
                          minHeight: '36px',
                          padding: '6px 10px',
                          fontSize: '0.72rem',
                          fontWeight: '700',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                        title={isStoreDefault ? 'Desmarcar local por defecto' : 'Fijar como local por defecto'}
                      >
                        <Star size={14} fill={isStoreDefault ? '#FFC72C' : 'none'} color="#FFC72C" />
                        <span>{isStoreDefault ? 'Por defecto' : 'Fijar'}</span>
                      </button>

                      {isSelected && <Check size={20} color="#FFC72C" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Mobile Tab Bar - Barra Táctil Háptica con 48px+ de target */}
      <nav style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#1D1D1D',
        borderTop: '1px solid #3A3833',
        display: 'flex',
        justifyContent: 'space-around',
        padding: '6px 4px calc(6px + env(safe-area-inset-bottom, 0px))',
        zIndex: 100
      }}>
        <NavLink
          to="/"
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            color: isActive ? '#FFC72C' : '#888888',
            textDecoration: 'none',
            fontSize: '0.78rem',
            fontWeight: isActive ? '800' : '600',
            flex: 1,
            minHeight: '48px',
            borderRadius: '10px',
            backgroundColor: isActive ? 'rgba(255, 199, 44, 0.08)' : 'transparent',
            transition: 'all 0.15s ease'
          })}
        >
          <Zap size={22} color="currentColor" />
          <span>Lectura</span>
        </NavLink>

        <NavLink
          to="/dashboard"
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            color: isActive ? '#FFC72C' : '#888888',
            textDecoration: 'none',
            fontSize: '0.78rem',
            fontWeight: isActive ? '800' : '600',
            flex: 1,
            minHeight: '48px',
            borderRadius: '10px',
            backgroundColor: isActive ? 'rgba(255, 199, 44, 0.08)' : 'transparent',
            transition: 'all 0.15s ease'
          })}
        >
          <BarChart3 size={22} color="currentColor" />
          <span>Red & Comparativa</span>
        </NavLink>
      </nav>
    </>
  );
}
