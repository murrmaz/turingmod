import { type ComponentType, type LazyExoticComponent, lazy, Suspense, useState } from 'react';
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
import { HOME_PAGE, PAGES, type PageId, pagePath, routePattern } from '@/constants/pages';
import { AppStateProvider } from '@/context/app-state-context';
import { TrpcProvider, useConnection } from '@/context/trpc-context';
import { cn } from '@/lib/utils';

/**
 * Each page's component, loaded when first opened. Keyed by page, so a page in PAGES without a
 * component here is a compile error.
 */
const PAGE_COMPONENTS: Record<PageId, LazyExoticComponent<ComponentType>> = {
  dashboard: lazy(() =>
    import('@/features/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage }))
  ),
  commands: lazy(() =>
    import('@/features/commands/commands-page').then((m) => ({ default: m.CommandsPage }))
  ),
  integrations: lazy(() =>
    import('@/features/integrations/integrations-page').then((m) => ({
      default: m.IntegrationsPage,
    }))
  ),
  suggestions: lazy(() =>
    import('@/features/suggestions/suggestions-page').then((m) => ({ default: m.SuggestionsPage }))
  ),
  history: lazy(() =>
    import('@/features/history/history-page').then((m) => ({ default: m.HistoryPage }))
  ),
  data: lazy(() => import('@/features/data/data-page').then((m) => ({ default: m.DataPage }))),
};

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
                      <Route index element={<Navigate to={pagePath(HOME_PAGE)} replace />} />
                      {PAGES.map((page) => {
                        const Page = PAGE_COMPONENTS[page.id];
                        return <Route key={page.id} path={routePattern(page)} element={<Page />} />;
                      })}
                      <Route path="*" element={<Navigate to={pagePath(HOME_PAGE)} replace />} />
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
