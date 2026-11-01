import { screen, within } from '@testing-library/react';
import {
  type DataTableInfo,
  type IntegrationInfo,
  IntegrationName,
  IntegrationStatus,
} from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import { links } from '@/constants/pages';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { integration } from '@/testing/integrations';
import { renderConsole } from '@/testing/render-console';
import { AppSidebar } from './app-sidebar';
import { SidebarProvider } from './ui/sidebar';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

function table(name: string, rowCount: number): DataTableInfo {
  return { name, rowCount, columns: [], defaultSort: 'id' };
}

function setup(route: string, integrations: IntegrationInfo[] = [], tables: DataTableInfo[] = []) {
  const watch = new FakeSubscription<IntegrationInfo[]>();
  renderConsole(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>,
    {
      route,
      procedures: {
        integrations: { watch },
        data: { listTables: { query: async () => tables } },
      },
    }
  );
  watch.emit(integrations);
}

const pageItem = (name: string) =>
  within(screen.getByRole('link', { name }).closest('li') as HTMLElement);

describe('AppSidebar', () => {
  it('links every page, marking the one it is on', () => {
    setup('/history');

    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Commands' })).toHaveAttribute('href', '/commands');
  });

  it('counts the integrations that need attention beside Integrations', () => {
    setup('/dashboard', [
      integration(IntegrationName.OBS, { status: IntegrationStatus.ERROR, enabled: true }),
      integration(IntegrationName.SOUND, { status: IntegrationStatus.CONNECTED, enabled: true }),
    ]);

    expect(pageItem('Integrations').getByText('1')).toBeInTheDocument();
  });

  it('shows no count while every integration is well', () => {
    setup('/dashboard', [integration(IntegrationName.SOUND)]);

    expect(pageItem('Integrations').queryByText(/^\d+$/)).not.toBeInTheDocument();
  });

  it("lists the Data page's tables while it's open, marking the one shown", async () => {
    setup(links.dataTable('settings'), [], [table('activity_log', 1200), table('settings', 4)]);

    const shown = await screen.findByRole('link', { name: /^settings/ });
    expect(shown).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('link', { name: /^activity_log/ })).toHaveAttribute(
      'href',
      links.dataTable('activity_log')
    );
  });

  it('marks the first table when the Data page names none', async () => {
    setup('/data', [], [table('activity_log', 1200), table('settings', 4)]);

    expect(await screen.findByRole('link', { name: /^activity_log/ })).toHaveAttribute(
      'data-active',
      'true'
    );
  });

  it('lists no tables away from the Data page', () => {
    setup('/dashboard', [], [table('settings', 4)]);

    expect(screen.queryByText('Tables')).not.toBeInTheDocument();
  });
});
