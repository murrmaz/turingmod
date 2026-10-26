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
import { PAGES, pageAt } from '@/constants/pages';
import { useAppState } from '@/context/AppStateContext';
import { useDataTables } from '@/features/data/useDataTables';
import { useConnection } from '@/hooks/useConnection';
import { describeIntegration } from '@/lib/integrationStatus';

export function AppSidebar() {
  const { pathname } = useLocation();
  const { integrations } = useAppState();
  const { state } = useSidebar();
  const broken = integrations.filter((i) => describeIntegration(i).needsAttention).length;
  const current = pageAt(pathname);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="hover:bg-transparent">
              <NavLink to="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-[15px] font-bold text-primary-foreground">
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
              {PAGES.map((page) => (
                <SidebarMenuItem key={page.path}>
                  <SidebarMenuButton
                    asChild
                    isActive={page === current}
                    tooltip={page.label}
                    className="data-[active=true]:font-medium"
                  >
                    <NavLink to={page.path} className="relative">
                      <page.icon />
                      <span>{page.label}</span>
                      {page.path === '/integrations' && broken > 0 && state === 'collapsed' && (
                        <StatusDot tone="error" className="absolute top-1 right-1" />
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                  {page.path === '/integrations' && broken > 0 && (
                    <SidebarMenuBadge className="rounded-md bg-cat-error/25 text-[11px] font-semibold text-foreground peer-hover/menu-button:text-foreground peer-data-[active=true]/menu-button:text-foreground">
                      {broken}
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {current?.path === '/data' && <DataTablesGroup />}
      </SidebarContent>
      <SidebarFooter>
        <ConnectionStatus />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function DataTablesGroup() {
  const { tables } = useDataTables();
  const match = useMatch('/data/:table');
  const active = match?.params.table ?? tables[0]?.name;

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Tables</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {tables.map((table) => (
            <SidebarMenuItem key={table.name}>
              <SidebarMenuButton asChild size="sm" isActive={table.name === active}>
                <NavLink to={`/data/${table.name}`} className="pl-8">
                  <span className="truncate font-mono text-[12.5px]">{table.name}</span>
                  <span className="ml-auto font-mono text-[11.5px] text-subtle-foreground">
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
