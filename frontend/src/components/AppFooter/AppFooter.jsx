export default function AppFooter() {
  return (
    <footer
      style={{
        textAlign: 'center',
        padding: '24px 12px calc(80px + env(safe-area-inset-bottom, 0px))',
        color: '#777777',
        fontSize: '0.75rem',
        letterSpacing: '0.2px',
        userSelect: 'none'
      }}
    >
      Derechos reservados a <strong style={{ color: '#AAAAAA', fontWeight: '600' }}>Luca Guerra</strong> @ <span style={{ color: '#FFC72C', fontWeight: '700' }}>McDonald's MTD</span>
    </footer>
  );
}

