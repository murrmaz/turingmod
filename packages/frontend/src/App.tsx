import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { CommandPalette } from '@/components/command-palette';
import { IntegrationToasts } from '@/components/integration-toasts';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppStateProvider } from '@/context/AppStateContext';
import { WebSocketProvider } from '@/context/WebSocketContext';
import { SimulatorProvider } from '@/features/commands/simulator';

const DashboardPage = lazy(() =>
  import('@/features/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage }))
);
const CommandsPage = lazy(() =>
  import('@/features/commands/commands-page').then((m) => ({ default: m.CommandsPage }))
);
const IntegrationsPage = lazy(() =>
  import('@/features/integrations/integrations-page').then((m) => ({
    default: m.IntegrationsPage,
  }))
);
const HistoryPage = lazy(() =>
  import('@/features/history/history-page').then((m) => ({ default: m.HistoryPage }))
);
const DataPage = lazy(() =>
  import('@/features/data/data-page').then((m) => ({ default: m.DataPage }))
);

function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-hidden">
        <SiteHeader onOpenPalette={() => setPaletteOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-auto">
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
      </SidebarInset>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <IntegrationToasts />
    </SidebarProvider>
  );
}

/**
 * Main application component
 */
export function App() {
  return (
    <BrowserRouter>
      <WebSocketProvider>
        <AppStateProvider>
          <TooltipProvider delayDuration={300}>
            <SimulatorProvider>
              <Routes>
                <Route path="/" element={<Shell />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="commands" element={<CommandsPage />} />
                  <Route path="integrations" element={<IntegrationsPage />} />
                  <Route path="history" element={<HistoryPage />} />
                  <Route path="data" element={<DataPage />} />
                  <Route path="data/:table" element={<DataPage />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Route>
              </Routes>
              <Toaster position="bottom-right" />
            </SimulatorProvider>
          </TooltipProvider>
        </AppStateProvider>
      </WebSocketProvider>
    </BrowserRouter>
  );
}
