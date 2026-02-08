import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CommandList } from './components/commands/CommandList';
import { Dashboard } from './components/dashboard/Dashboard';
import { IntegrationPanel } from './components/integrations/IntegrationPanel';
import { AppLayout } from './components/layout/AppLayout';
import { AppStateProvider } from './context/AppStateContext';
import { WebSocketProvider } from './context/WebSocketContext';

/**
 * Main application component
 */
export function App() {
  return (
    <BrowserRouter>
      <WebSocketProvider>
        <AppStateProvider>
          <Routes>
            <Route path="/" element={<AppLayout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="commands" element={<CommandList />} />
              <Route path="integrations" element={<IntegrationPanel />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </AppStateProvider>
      </WebSocketProvider>
    </BrowserRouter>
  );
}
