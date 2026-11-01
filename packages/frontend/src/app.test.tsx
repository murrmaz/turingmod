import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DataTableInfo } from '@turingmod/shared';
import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Shell } from '@/app';
import { links, PAGES, pagePath, routePattern } from '@/constants/pages';
import type { ConnectionState } from '@/services/connection';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { CurrentLocation, renderConsole } from '@/testing/render-console';

const table = (name: string): DataTableInfo => ({
  name,
  rowCount: 1,
  defaultSort: 'id',
  columns: [],
});

function CrashingPage(): never {
  throw new Error('Page blew up');
}

/** A page that says each time it's built. */
function CountingPage({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return <p>Data page</p>;
}

interface SetupOptions {
  route?: string;
  connectionState?: ConnectionState;
  retry?: () => void;
  onMount?: () => void;
}

function setup({
  route = pagePath('commands'),
  connectionState,
  retry,
  onMount = () => {},
}: SetupOptions = {}) {
  const data = PAGES.find((page) => page.id === 'data');
  renderConsole(
    <>
      <Routes>
        <Route path="/" element={<Shell />}>
          <Route path={pagePath('commands')} element={<p>Commands page</p>} />
          <Route path={pagePath('suggestions')} element={<CrashingPage />} />
          <Route
            path={data ? routePattern(data) : ''}
            element={<CountingPage onMount={onMount} />}
          />
        </Route>
      </Routes>
      <CurrentLocation />
    </>,
    {
      route,
      ...(connectionState ? { connectionState } : {}),
      ...(retry ? { retry } : {}),
      procedures: {
        liveState: { watch: new FakeSubscription() },
        youtubeChat: { watch: new FakeSubscription() },
        data: { listTables: { query: async () => [table('one'), table('two')] } },
      },
    }
  );
}

const pageFrame = (text: string) => screen.getByText(text).closest('main');

describe('Shell', () => {
  describe('while connected', () => {
    it('shows the page at full strength, with no banner', () => {
      setup();

      expect(screen.queryByText('Lost connection to TuringMod.')).not.toBeInTheDocument();
      expect(pageFrame('Commands page')).not.toHaveClass('opacity-50');
    });
  });

  describe('while the connection is lost', () => {
    it('says so across the top and dims the page', () => {
      setup({ connectionState: 'reconnecting' });

      expect(screen.getByRole('alert')).toHaveTextContent('Lost connection to TuringMod.');
      expect(pageFrame('Commands page')).toHaveClass('opacity-50');
    });

    it('retries from the banner', async () => {
      const retry = vi.fn();
      setup({ connectionState: 'reconnecting', retry });

      await userEvent
        .setup()
        .click(within(screen.getByRole('alert')).getByRole('button', { name: 'Retry now' }));

      expect(retry).toHaveBeenCalledTimes(1);
    });
  });

  it('shows no banner before the first connection has been made', () => {
    setup({ connectionState: 'connecting' });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(pageFrame('Commands page')).not.toHaveClass('opacity-50');
  });

  it('keeps the frame up when a page crashes, and tries afresh on leaving it', async () => {
    setup({ route: pagePath('suggestions') });

    expect(await screen.findByRole('alert')).toHaveTextContent('Page blew up');
    expect(screen.getByRole('heading', { name: 'Suggestions' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('link', { name: 'Commands' }));

    expect(await screen.findByText('Commands page')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("doesn't build a page again when moving within it", async () => {
    const onMount = vi.fn();
    setup({ route: links.dataTable('one'), onMount });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('link', { name: /^two/ }));

    expect(screen.getByRole('status', { name: 'Current location' })).toHaveTextContent('/data/two');
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('builds a page again on coming back to it', async () => {
    const onMount = vi.fn();
    setup({ route: links.dataTable('one'), onMount });
    const user = userEvent.setup();

    await user.click(screen.getByRole('link', { name: 'Commands' }));
    await screen.findByText('Commands page');
    await user.click(screen.getByRole('link', { name: 'Data' }));

    await screen.findByText('Data page');
    expect(onMount).toHaveBeenCalledTimes(2);
  });

  it('opens the palette from the header, and with the keyboard', async () => {
    setup();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Search or run a command/ }));
    expect(await screen.findByPlaceholderText('Search or run a command…')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.keyboard('{Control>}k{/Control}');
    expect(await screen.findByPlaceholderText('Search or run a command…')).toBeInTheDocument();
  });
});
