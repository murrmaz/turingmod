import { lazy, Suspense, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppSidebar } from '@/components/app-sidebar';
import { CommandPalette } from '@/components/command-palette';
import { ConnectionBanner } from '@/components/connection-banner';
import { ErrorBoundary } from '@/components/error-boundary';
import { IntegrationToasts } from '@/components/integration-toasts';
import { OAuthFlowProvider } from '@/components/integrations/oauth-flow';
import { SimulatorProvider } from '@/components/simulator';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppStateProvider } from '@/context/app-state-context';
import { TrpcProvider, useConnection } from '@/context/trpc-context';
import { cn } from '@/lib/utils';

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
const SuggestionsPage = lazy(() =>
  import('@/features/suggestions/suggestions-page').then((m) => ({ default: m.SuggestionsPage }))
);
const HistoryPage = lazy(() =>
  import('@/features/history/history-page').then((m) => ({ default: m.HistoryPage }))
);
const DataPage = lazy(() =>
  import('@/features/data/data-page').then((m) => ({ default: m.DataPage }))
);

function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { pathname } = useLocation();
  const { connectionState } = useConnection();
  return (
    <SidebarProvider className="h-svh">
      <AppSidebar />
      <SidebarInset className="min-w-0 overflow-hidden">
        <ConnectionBanner />
        <SiteHeader onOpenPalette={() => setPaletteOpen(true)} />
        {/* Dimmed while reconnecting, since nothing on it is current until the connection is back. */}
        <main
          className={cn(
            'flex min-h-0 flex-1 flex-col overflow-auto transition-opacity',
            connectionState === 'reconnecting' && 'opacity-50'
          )}
        >
          {/* Keyed by page, so a page that crashed is tried afresh once you navigate away. */}
          <ErrorBoundary key={pathname}>
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
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
    // The last resort, for a crash outside any page (the sidebar, header or providers).
    <ErrorBoundary className="min-h-svh">
      <BrowserRouter>
        <TrpcProvider>
          <AppStateProvider>
            <TooltipProvider delayDuration={300}>
              <SimulatorProvider>
                <OAuthFlowProvider>
                  <Routes>
                    <Route path="/" element={<Shell />}>
                      <Route index element={<Navigate to="/dashboard" replace />} />
                      <Route path="dashboard" element={<DashboardPage />} />
                      <Route path="commands" element={<CommandsPage />} />
                      <Route path="integrations" element={<IntegrationsPage />} />
                      <Route path="suggestions" element={<SuggestionsPage />} />
                      <Route path="history" element={<HistoryPage />} />
                      <Route path="data" element={<DataPage />} />
                      <Route path="data/:table" element={<DataPage />} />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                  </Routes>
                  <Toaster position="bottom-right" />
                </OAuthFlowProvider>
              </SimulatorProvider>
            </TooltipProvider>
          </AppStateProvider>
        </TrpcProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
