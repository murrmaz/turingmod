import Spinner from '@cloudscape-design/components/spinner';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { AppStateProvider } from './context/AppStateContext';
import { WebSocketProvider } from './context/WebSocketContext';

const Dashboard = lazy(() =>
  import('./components/dashboard/Dashboard').then((m) => ({ default: m.Dashboard }))
);
const CommandList = lazy(() =>
  import('./components/commands/CommandList').then((m) => ({ default: m.CommandList }))
);
const IntegrationPanel = lazy(() =>
  import('./components/integrations/IntegrationPanel').then((m) => ({
    default: m.IntegrationPanel,
  }))
);
const History = lazy(() =>
  import('./components/history/History').then((m) => ({ default: m.History }))
);

function RouteFallback() {
  return <Spinner size="large" />;
}

/**
 * Main application component
 */
export function App() {
  return (
    <BrowserRouter>
      <WebSocketProvider>
        <AppStateProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="commands" element={<CommandList />} />
                <Route path="integrations" element={<IntegrationPanel />} />
                <Route path="history" element={<History />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Routes>
          </Suspense>
        </AppStateProvider>
      </WebSocketProvider>
    </BrowserRouter>
  );
}
