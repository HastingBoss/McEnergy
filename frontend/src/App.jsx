import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { StoreProvider } from './context/StoreContext';
import Navbar from './components/Navbar/Navbar';
import InstallPWA from './components/InstallPWA/InstallPWA';
import MeterReading from './pages/MeterReading/MeterReading';
import ConsumptionComparison from './pages/ConsumptionComparison/ConsumptionComparison';
import GlobalDashboard from './pages/GlobalDashboard/GlobalDashboard';

export default function App() {
  return (
    <StoreProvider>
      <Router>
        <Navbar />
        <main style={{ flex: 1 }}>
          <Routes>
            <Route path="/" element={<MeterReading />} />
            <Route path="/comparison" element={<ConsumptionComparison />} />
            <Route path="/dashboard" element={<GlobalDashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <InstallPWA />
      </Router>
    </StoreProvider>
  );
}
