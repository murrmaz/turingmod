import { act, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import {
  type PlatformLiveState,
  StreamingPlatform,
  type YouTubeChatState,
} from '@turingmod/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import type { ConnectionState } from '@/services/connection';
import { deferred, FakeSubscription } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/render-console';
import { SiteHeader } from './site-header';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const live = (platform: StreamingPlatform, startedAt: number | null): PlatformLiveState => ({
  platform,
  live: true,
  startedAt,
});

interface SetupOptions {
  connectionState?: ConnectionState;
  route?: string;
  goLive?: () => Promise<YouTubeChatState>;
  goOffline?: () => Promise<YouTubeChatState>;
  onOpenPalette?: () => void;
}

function setup({
  connectionState = 'connected',
  route = '/',
  goLive = async () => 'resolving',
  goOffline = async () => 'idle',
  onOpenPalette = () => {},
}: SetupOptions = {}) {
  const liveState = new FakeSubscription<PlatformLiveState[]>();
  const chat = new FakeSubscription<YouTubeChatState>();
  renderConsole(
    <SidebarProvider>
      <SiteHeader onOpenPalette={onOpenPalette} />
    </SidebarProvider>,
    {
      connectionState,
      route,
      procedures: {
        liveState: { watch: liveState },
        youtubeChat: {
          watch: chat,
          goLive: { mutate: goLive },
          goOffline: { mutate: goOffline },
        },
      },
    }
  );
  return { liveState, chat };
}

const twitchBadge = () => screen.getByText('Twitch').parentElement;
const youTubeBadge = () => screen.getByRole('button', { name: /YouTube/ });

async function openChatMenu(user: UserEvent) {
  await user.click(await screen.findByRole('button', { name: /YouTube/ }));
  const menu = within(await screen.findByRole('menu'));
  return {
    menu,
    connect: menu.getByRole('menuitem', { name: 'Connect chat' }),
    disconnect: menu.getByRole('menuitem', { name: 'Disconnect chat' }),
  };
}

describe('SiteHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('title', () => {
    it.each([
      ['/commands', 'Commands'],
      ['/data/settings', 'Data'],
      ['/nowhere', 'TuringMod'],
    ])('at %s reads %s', (route, title) => {
      setup({ route });

      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    });
  });

  it('opens the palette from its search button', async () => {
    const onOpenPalette = vi.fn();
    setup({ onOpenPalette });

    await userEvent.setup().click(screen.getByRole('button', { name: /Search or run a command/ }));

    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  describe('live badges', () => {
    it('says unknown until the backend has said', () => {
      setup();

      expect(twitchBadge()).toHaveTextContent('Unknown');
      expect(youTubeBadge()).toHaveTextContent('Unknown');
    });

    it('says unknown rather than the last state once reading it has failed', () => {
      const { liveState } = setup();
      liveState.emit([live(StreamingPlatform.TWITCH, null)]);

      liveState.fail(new Error('Database is locked'));

      expect(twitchBadge()).toHaveTextContent('Unknown');
      expect(twitchBadge()).not.toHaveTextContent('Live');
    });

    it('reads offline for a platform the backend left out of its answer', () => {
      const { liveState } = setup();

      liveState.emit([]);

      expect(twitchBadge()).toHaveTextContent('Offline');
      expect(youTubeBadge()).toHaveTextContent('Offline');
    });

    it('shows each platform by its own state', () => {
      const { liveState } = setup();

      liveState.emit([
        live(StreamingPlatform.TWITCH, null),
        { platform: StreamingPlatform.YOUTUBE, live: false, startedAt: null },
      ]);

      expect(twitchBadge()).toHaveTextContent('Live');
      expect(youTubeBadge()).toHaveTextContent('Offline');
    });

    it('counts the uptime up while live', () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      const { liveState } = setup();

      liveState.emit([live(StreamingPlatform.TWITCH, Date.now() - 65_000)]);
      expect(twitchBadge()).toHaveTextContent('0:01:05');

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(twitchBadge()).toHaveTextContent('0:01:06');
    });

    it('shows no uptime when the start of the stream is not known', () => {
      const { liveState } = setup();

      liveState.emit([live(StreamingPlatform.TWITCH, null)]);

      expect(twitchBadge()).not.toHaveTextContent(/\d:\d\d:\d\d/);
    });

    it.each<ConnectionState>(['connecting', 'reconnecting'])(
      'says unknown rather than the last state while %s',
      (connectionState) => {
        const { liveState } = setup({ connectionState });

        liveState.emit([
          live(StreamingPlatform.TWITCH, Date.now() - 65_000),
          live(StreamingPlatform.YOUTUBE, Date.now() - 65_000),
        ]);

        for (const badge of [twitchBadge(), youTubeBadge()]) {
          expect(badge).toHaveTextContent('Unknown');
          expect(badge).not.toHaveTextContent('Live');
          expect(badge).not.toHaveTextContent(/\d:\d\d:\d\d/);
        }
      }
    );
  });

  describe('YouTube chat menu', () => {
    it.each<[YouTubeChatState, string, boolean, boolean]>([
      ['idle', 'Chat not connected', true, false],
      ['resolving', 'Looking for a live broadcast…', false, true],
      ['streaming', 'Chat connected', false, true],
    ])(
      'while %s reads "%s" and offers what can be done',
      async (state, text, canConnect, canDisconnect) => {
        const { chat } = setup();
        chat.emit(state);

        const { menu, connect, disconnect } = await openChatMenu(userEvent.setup());

        expect(menu.getByText(text)).toBeInTheDocument();
        expect(connect.hasAttribute('aria-disabled')).toBe(!canConnect);
        expect(disconnect.hasAttribute('aria-disabled')).toBe(!canDisconnect);
      }
    );

    it.each<YouTubeChatState>(['idle', 'streaming'])(
      'offers nothing while the console is disconnected, with chat last %s',
      async (state) => {
        const { chat } = setup({ connectionState: 'reconnecting' });
        chat.emit(state);

        const { menu, connect, disconnect } = await openChatMenu(userEvent.setup());

        expect(menu.getByText('Not connected to TuringMod')).toBeInTheDocument();
        expect(connect).toHaveAttribute('aria-disabled', 'true');
        expect(disconnect).toHaveAttribute('aria-disabled', 'true');
      }
    );

    it('offers nothing until the state of chat has arrived', async () => {
      setup();

      const { menu, connect, disconnect } = await openChatMenu(userEvent.setup());

      expect(menu.getByText('Chat state unknown')).toBeInTheDocument();
      expect(connect).toHaveAttribute('aria-disabled', 'true');
      expect(disconnect).toHaveAttribute('aria-disabled', 'true');
    });

    it('offers nothing once reading the state of chat has failed', async () => {
      const { chat } = setup();
      chat.emit('idle');

      chat.fail(new Error('Database is locked'));
      const { menu, connect } = await openChatMenu(userEvent.setup());

      expect(menu.getByText('Chat state unknown')).toBeInTheDocument();
      expect(connect).toHaveAttribute('aria-disabled', 'true');
    });

    it('connects chat, and shows the state that answers with', async () => {
      const goLive = vi.fn(async (): Promise<YouTubeChatState> => 'resolving');
      const { chat } = setup({ goLive });
      chat.emit('idle');
      const user = userEvent.setup();

      await user.click((await openChatMenu(user)).connect);

      expect(goLive).toHaveBeenCalledTimes(1);
      const { menu } = await openChatMenu(user);
      expect(menu.getByText('Looking for a live broadcast…')).toBeInTheDocument();
    });

    it('disconnects chat, and shows the state that answers with', async () => {
      const goOffline = vi.fn(async (): Promise<YouTubeChatState> => 'idle');
      const { chat } = setup({ goOffline });
      chat.emit('streaming');
      const user = userEvent.setup();

      await user.click((await openChatMenu(user)).disconnect);

      expect(goOffline).toHaveBeenCalledTimes(1);
      const { menu } = await openChatMenu(user);
      expect(menu.getByText('Chat not connected')).toBeInTheDocument();
    });

    it('offers nothing while a request is waiting for its answer', async () => {
      const answer = deferred<YouTubeChatState>();
      const { chat } = setup({ goLive: () => answer.promise });
      chat.emit('idle');
      const user = userEvent.setup();

      await user.click((await openChatMenu(user)).connect);
      const { connect, disconnect } = await openChatMenu(user);
      expect(connect).toHaveAttribute('aria-disabled', 'true');
      expect(disconnect).toHaveAttribute('aria-disabled', 'true');

      await act(async () => answer.resolve('resolving'));

      expect(disconnect).not.toHaveAttribute('aria-disabled');
    });

    it('offers nothing while disconnecting waits for its answer', async () => {
      const answer = deferred<YouTubeChatState>();
      const { chat } = setup({ goOffline: () => answer.promise });
      chat.emit('streaming');
      const user = userEvent.setup();

      await user.click((await openChatMenu(user)).disconnect);
      const { connect, disconnect } = await openChatMenu(user);
      expect(connect).toHaveAttribute('aria-disabled', 'true');
      expect(disconnect).toHaveAttribute('aria-disabled', 'true');

      await act(async () => answer.resolve('idle'));

      expect(connect).not.toHaveAttribute('aria-disabled');
    });

    it('says so when connecting fails, and offers it again', async () => {
      const { chat } = setup({
        goLive: () => Promise.reject(new Error('Quota exceeded')),
      });
      chat.emit('idle');
      const user = userEvent.setup();

      await user.click((await openChatMenu(user)).connect);

      expect(toast.error).toHaveBeenCalledWith("Couldn't connect YouTube chat", {
        description: 'Quota exceeded',
      });
      expect((await openChatMenu(user)).connect).not.toHaveAttribute('aria-disabled');
    });

    it('says so when disconnecting fails', async () => {
      const { chat } = setup({
        goOffline: () => Promise.reject(new Error('Socket closed')),
      });
      chat.emit('streaming');
      const user = userEvent.setup();

      await user.click((await openChatMenu(user)).disconnect);

      expect(toast.error).toHaveBeenCalledWith("Couldn't disconnect YouTube chat", {
        description: 'Socket closed',
      });
    });
  });
});
