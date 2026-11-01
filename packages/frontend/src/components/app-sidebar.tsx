import { NavLink, useLocation, useMatch } from 'react-router-dom';
import { StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  HOME_PAGE,
  links,
  PAGES,
  type Page,
  type PageId,
  pageAt,
  pagePath,
  routePattern,
  URL_PARAMS,
} from '@/constants/pages';
import { useIntegrationState } from '@/context/app-state-context';
import { useConnection } from '@/context/trpc-context';
import { useDataTables } from '@/hooks/useDataTables';
import { describeIntegration } from '@/lib/integrationStatus';

export function AppSidebar() {
  const { pathname } = useLocation();
  const { integrations } = useIntegrationState();
  const { state } = useSidebar();
  const current = pageAt(pathname);
  // A count beside a page's name, when it has something that needs looking at.
  const badges: Partial<Record<PageId, number>> = {
    integrations: integrations.filter((i) => describeIntegration(i).needsAttention).length,
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-transparent">
              <NavLink to={pagePath(HOME_PAGE)}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground">
                  T
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">TuringMod</span>
                  <span className="truncate text-xs text-muted-foreground">Stream console</span>
                </div>
              </NavLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Console</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {PAGES.map((page) => {
                const badge = badges[page.id] ?? 0;
                return (
                  <SidebarMenuItem key={page.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={page === current}
                      tooltip={page.label}
                      className="data-[active=true]:font-medium"
                    >
                      <NavLink to={page.path} className="relative">
                        <page.icon />
                        <span>{page.label}</span>
                        {badge > 0 && state === 'collapsed' && (
                          <StatusDot tone="error" className="absolute top-1 right-1" />
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                    {badge > 0 && (
                      <SidebarMenuBadge className="rounded-md bg-cat-error/25 text-caption font-semibold text-foreground peer-hover/menu-button:text-foreground peer-data-[active=true]/menu-button:text-foreground">
                        {badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {current?.id === 'data' && <DataTablesGroup page={current} />}
      </SidebarContent>
      <SidebarFooter>
        <ConnectionStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** The Data page's tables, under it in the sidebar while it's open. */
function DataTablesGroup({ page }: { page: Page }) {
  const { tables } = useDataTables();
  const match = useMatch(routePattern(page));
  const active = match?.params[URL_PARAMS.dataTable] ?? tables[0]?.name;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Tables</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {tables.map((table) => (
            <SidebarMenuItem key={table.name}>
              <SidebarMenuButton asChild size="sm" isActive={table.name === active}>
                <NavLink to={links.dataTable(table.name)} className="pl-8">
                  <span className="truncate font-mono text-data">{table.name}</span>
                  <span className="ml-auto font-mono text-caption text-subtle-foreground">
                    {table.rowCount.toLocaleString()}
                  </span>
                </NavLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * The console's own connection to the backend. A lost one is retried by itself (the banner over
 * the page says so too); Retry now skips the wait.
 */
function ConnectionStatus() {
  const { connectionState, retry } = useConnection();

  if (connectionState === 'connected' || connectionState === 'connecting') {
    const connected = connectionState === 'connected';
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
        <StatusDot tone={connected ? 'viewer' : 'system'} pulse={!connected} className="size-2" />
        <span className="truncate group-data-[collapsible=icon]:hidden">
          {connected ? `Connected · ${window.location.host}` : 'Connecting…'}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 px-2 py-1 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
      <div className="flex items-center gap-2 text-xs text-cat-error">
        <StatusDot tone="error" pulse className="size-2" />
        <span className="group-data-[collapsible=icon]:hidden">Reconnecting…</span>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={retry}
        className="group-data-[collapsible=icon]:hidden"
      >
        Retry now
      </Button>
    </div>
  );
}
