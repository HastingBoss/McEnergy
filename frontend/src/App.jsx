import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { StoreProvider, useStore } from './context/StoreContext';
import Navbar from './components/Navbar/Navbar';
import InstallPWA from './components/InstallPWA/InstallPWA';
import SplashScreen from './components/SplashScreen/SplashScreen';
import MeterReading from './pages/MeterReading/MeterReading';
import GlobalDashboard from './pages/GlobalDashboard/GlobalDashboard';

function AppContent() {
  const { loading } = useStore();

  return (
    <>
      <SplashScreen isReady={!loading} />
      <Router>
        <Navbar />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/" element={<MeterReading />} />
            <Route path="/dashboard" element={<GlobalDashboard />} />
            <Route path="/comparison" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <InstallPWA />
      </Router>
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AppContent />
    </StoreProvider>
  );
}
