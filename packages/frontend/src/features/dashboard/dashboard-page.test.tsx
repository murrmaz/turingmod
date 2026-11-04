import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  type ActivityLogEntry,
  type PlatformLiveState,
  StreamingPlatform,
} from '@turingmod/shared';
import { Link, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { RouterOutputs } from '@/context/trpc-context';
import { activityEntry } from '@/testing/activity';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { CurrentLocation, renderConsole } from '@/testing/render-console';
import { DashboardPage } from './dashboard-page';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

type FeedEvent = RouterOutputs['activity']['feed'] extends AsyncIterable<infer E> ? E : never;

let clock = Date.now() - 60_000;

/** A command run, which the feed titles `!name`. */
function command(name: string): ActivityLogEntry {
  clock += 1000;
  return activityEntry(
    'command.executed',
    { command: name, username: 'viewer' },
    { id: `command-${name}`, timestamp: clock }
  );
}

function chat(message: string): ActivityLogEntry {
  clock += 1000;
  return activityEntry(
    'chat.message',
    { message, username: 'viewer' },
    { id: `chat-${message}`, timestamp: clock }
  );
}

function setup(stored: ActivityLogEntry[] = []) {
  const feed = new FakeSubscription<FeedEvent>();
  const liveState = new FakeSubscription<PlatformLiveState[]>();
  const user = userEvent.setup();
  renderConsole(
    <>
      <DashboardPage />
      <CurrentLocation />
    </>,
    {
      procedures: {
        activity: { feed },
        liveState: { watch: liveState },
      },
    }
  );
  feed.emit({ type: 'seed', entries: [...stored].reverse() });
  const arrive = (entry: ActivityLogEntry) => feed.emit({ type: 'entry', entry });
  return { feed, liveState, user, arrive };
}

/** The commands the feed is showing, top to bottom. */
function shownCommands(): string[] {
  const [, body] = screen.getAllByRole('rowgroup');
  return within(body as HTMLElement)
    .queryAllByText(/^!\w+$/)
    .map((cell) => cell.textContent ?? '');
}

function scrollFeedTo(scrollTop: number): void {
  const scroller = screen.getByRole('table').parentElement as HTMLElement;
  fireEvent.scroll(scroller, { target: { scrollTop } });
}

describe('Live activity', () => {
  it('starts from the stored log, newest first, and puts each new event on top', () => {
    const { arrive } = setup([command('first'), command('second')]);

    arrive(command('third'));

    expect(shownCommands()).toEqual(['!third', '!second', '!first']);
  });

  it('holds new events behind a count while paused, and shows them on Resume', async () => {
    const { user, arrive } = setup([command('first')]);

    await user.click(screen.getByRole('button', { name: 'Pause' }));
    arrive(command('second'));
    arrive(command('third'));

    expect(shownCommands()).toEqual(['!first']);
    expect(screen.getByRole('button', { name: '2 new events' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));

    expect(shownCommands()).toEqual(['!third', '!second', '!first']);
    expect(screen.queryByRole('button', { name: /new event/ })).not.toBeInTheDocument();
  });

  it('jumps to the latest and resumes from the new-events count', async () => {
    const { user, arrive } = setup([command('first')]);
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    arrive(command('second'));

    await user.click(screen.getByRole('button', { name: '1 new event' }));

    expect(shownCommands()).toEqual(['!second', '!first']);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('freezes while scrolled away from the top, and follows again back at the top', () => {
    const { arrive } = setup([command('first')]);

    scrollFeedTo(200);
    arrive(command('second'));

    expect(shownCommands()).toEqual(['!first']);
    expect(screen.getByRole('button', { name: '1 new event' })).toBeInTheDocument();

    scrollFeedTo(0);

    expect(shownCommands()).toEqual(['!second', '!first']);
  });

  it('counts only held events the current tab would show', async () => {
    const { user, arrive } = setup([command('first')]);
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    // "All" leaves chat out, so a chat message held back isn't news there.
    arrive(chat('hello'));
    expect(screen.queryByRole('button', { name: /new event/ })).not.toBeInTheDocument();

    arrive(command('second'));
    expect(screen.getByRole('button', { name: '1 new event' })).toBeInTheDocument();
  });

  it('keeps what arrived live when a reconnect sends the stored log again', async () => {
    const stored = command('stored');
    const { user, feed, arrive } = setup([stored]);
    // Chat is never stored, so the new seed can't contain it.
    arrive(chat('hello'));

    feed.emit({ type: 'seed', entries: [stored] });
    await user.click(screen.getByRole('tab', { name: 'Chat' }));

    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('stays held through a reconnect, counting only what the stored log adds', async () => {
    const stored = command('stored');
    const { user, feed } = setup([stored]);
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    feed.emit({ type: 'seed', entries: [command('missed'), stored] });

    expect(shownCommands()).toEqual(['!stored']);
    expect(screen.getByRole('button', { name: '1 new event' })).toBeInTheDocument();
  });

  it('holds everything a reconnect brought when paused after it', async () => {
    const stored = command('stored');
    const { user, feed, arrive } = setup([stored]);
    arrive(chat('hello'));
    feed.emit({ type: 'seed', entries: [command('missed'), stored] });

    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(shownCommands()).toEqual(['!missed', '!stored']);
    expect(screen.queryByRole('button', { name: /new event/ })).not.toBeInTheDocument();
  });

  it('filters by the text typed after pressing /', async () => {
    const { user } = setup([command('lurk'), command('bonk')]);

    await user.keyboard('/');
    expect(screen.getByPlaceholderText('Filter events…')).toHaveFocus();
    await user.keyboard('bonk');

    expect(shownCommands()).toEqual(['!bonk']);
  });

  it('leaves the arrow keys alone once the open entry has left the feed', async () => {
    const { user, arrive } = setup([command('old')]);
    await user.click(screen.getByText('!old'));
    expect(screen.getByRole('dialog', { name: '!old' })).toBeInTheDocument();

    act(() => {
      for (let index = 0; index < 1000; index++) {
        arrive(command(`new${index}`));
      }
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const pressed = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    act(() => void window.dispatchEvent(pressed));

    expect(pressed.defaultPrevented).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('steps through the rows it shows with ↑ and ↓ while an entry is open', async () => {
    const { user } = setup([command('first'), command('second'), command('third')]);

    await user.click(screen.getByText('!second'));
    expect(screen.getByRole('dialog', { name: '!second' })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('dialog', { name: '!first' })).toBeInTheDocument();

    // The last row stays selected rather than wrapping around.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('dialog', { name: '!first' })).toBeInTheDocument();

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('dialog', { name: '!third' })).toBeInTheDocument();
  });

  it("opens History on an entry's viewer", async () => {
    const { user } = setup([command('lurk')]);

    await user.click(screen.getByText('!lurk'));
    await user.click(screen.getByRole('button', { name: 'View viewer’s history' }));

    // The sheet is modal, so it hides the rest from assistive technology until the page changes.
    expect(
      screen.getByRole('status', { name: 'Current location', hidden: true })
    ).toHaveTextContent('/history?q=viewer');
  });

  it("counts every event but chat while offline, and only this stream's once live", () => {
    const before = command('before');
    const { liveState, arrive } = setup([before]);
    arrive(chat('hello'));
    arrive(command('during'));
    expect(screen.getByText(/Newest first · 2 events$/)).toBeInTheDocument();

    // Two platforms live: the stream started when the earlier of them went live.
    liveState.emit([
      { platform: StreamingPlatform.TWITCH, live: true, startedAt: before.timestamp + 1 },
      { platform: StreamingPlatform.YOUTUBE, live: true, startedAt: before.timestamp + 500 },
    ]);

    expect(screen.getByText(/Newest first · 1 event this stream$/)).toBeInTheDocument();
  });

  describe('when the feed fails', () => {
    function failed(stored: ActivityLogEntry[] = []) {
      const feed = new FakeSubscription<FeedEvent>();
      renderConsole(<DashboardPage />, {
        procedures: {
          activity: { feed },
          liveState: { watch: new FakeSubscription<PlatformLiveState[]>() },
        },
      });
      if (stored.length > 0) {
        feed.emit({ type: 'seed', entries: stored });
      }
      feed.fail(new Error('Database is locked'));
      return feed;
    }

    it('says so in place, rather than as if there were no activity', () => {
      failed();

      expect(screen.getByRole('alert')).toHaveTextContent('Database is locked');
      expect(screen.queryByText(/No activity yet/)).not.toBeInTheDocument();
    });

    it('keeps showing the rows it has', () => {
      failed([command('kept')]);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(shownCommands()).toEqual(['!kept']);
    });

    it('clears once a retry delivers the log', async () => {
      const feed = failed();

      await waitFor(() => expect(feed.subscriberCount).toBe(1), { timeout: 3000 });
      feed.emit({ type: 'seed', entries: [command('back')] });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(shownCommands()).toEqual(['!back']);
    });
  });

  describe('with a busy chat', () => {
    /** Each arrives in turn, in the one render, as many as `count`. */
    function flood(arrive: (entry: ActivityLogEntry) => void, count: number, prefix: string) {
      act(() => {
        for (let index = 0; index < count; index++) {
          arrive(chat(`${prefix}${index}`));
        }
      });
    }

    it('keeps every other event, and counts them still', async () => {
      const { arrive, user } = setup([command('stored')]);
      arrive(command('live'));

      flood(arrive, 1001, 'm');

      expect(shownCommands()).toEqual(['!live', '!stored']);
      expect(screen.getByText(/Newest first · 2 events$/)).toBeInTheDocument();
      await user.click(screen.getByRole('tab', { name: 'Chat' }));
      expect(screen.getByText('m1000')).toBeInTheDocument();
    });

    it('keeps the newest of each kind when both are over their limits', async () => {
      const { arrive, user } = setup();
      arrive(command('oldest'));
      arrive(chat('oldest chat'));
      act(() => {
        for (let index = 0; index < 1000; index++) {
          arrive(command(`c${index}`));
        }
      });
      flood(arrive, 1000, 'm');

      expect(screen.queryByText('!oldest')).not.toBeInTheDocument();
      expect(shownCommands()[0]).toBe('!c999');
      await user.click(screen.getByRole('tab', { name: 'Chat' }));
      expect(screen.queryByText('oldest chat')).not.toBeInTheDocument();
      expect(screen.getByText('m999')).toBeInTheDocument();
    });
  });

  describe('on another page', () => {
    function withAnotherPage() {
      const feed = new FakeSubscription<FeedEvent>();
      const subscribe = vi.spyOn(feed, 'subscribe');
      const user = userEvent.setup();
      renderConsole(
        <>
          <Link to="/dashboard">Go to Dashboard</Link>
          <Link to="/elsewhere">Go elsewhere</Link>
          <Routes>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/elsewhere" element={<p>Elsewhere</p>} />
          </Routes>
        </>,
        {
          route: '/dashboard',
          procedures: {
            activity: { feed },
            liveState: { watch: new FakeSubscription<PlatformLiveState[]>() },
          },
        }
      );
      feed.emit({ type: 'seed', entries: [] });
      return { feed, subscribe, user };
    }

    it('keeps what arrived before leaving, chat and simulated commands included', async () => {
      const { feed, user } = withAnotherPage();
      feed.emit({ type: 'entry', entry: chat('before') });
      feed.emit({
        type: 'entry',
        entry: activityEntry(
          'command.executed',
          { command: 'simulated', isSimulation: true },
          { id: 'simulated', timestamp: clock }
        ),
      });

      await user.click(screen.getByText('Go elsewhere'));
      await user.click(screen.getByText('Go to Dashboard'));

      expect(shownCommands()).toEqual(['!simulated']);
      await user.click(screen.getByRole('tab', { name: 'Chat' }));
      expect(screen.getByText('before')).toBeInTheDocument();
    });

    it('collects what arrives meanwhile, on the one subscription', async () => {
      const { feed, subscribe, user } = withAnotherPage();

      await user.click(screen.getByText('Go elsewhere'));
      expect(screen.getByText('Elsewhere')).toBeInTheDocument();
      feed.emit({ type: 'entry', entry: chat('while away') });
      feed.emit({ type: 'entry', entry: command('meanwhile') });
      await user.click(screen.getByText('Go to Dashboard'));

      expect(shownCommands()).toEqual(['!meanwhile']);
      await user.click(screen.getByRole('tab', { name: 'Chat' }));
      expect(screen.getByText('while away')).toBeInTheDocument();
      expect(subscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("a row's menu", () => {
    const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Row actions' }));
      return screen.findByRole('menu');
    };

    it('inspects the row', async () => {
      const { user } = setup([command('bonk')]);

      await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Inspect' }));

      expect(await screen.findByRole('dialog', { name: '!bonk' })).toBeInTheDocument();
    });

    it("copies the row's JSON, without opening the row", async () => {
      const { user } = setup([command('bonk')]);

      await user.click(within(await openMenu(user)).getByRole('menuitem', { name: 'Copy JSON' }));

      await expect(navigator.clipboard.readText()).resolves.toContain('"command-bonk"');
      expect(screen.queryByRole('dialog', { name: '!bonk' })).not.toBeInTheDocument();
    });

    it("opens History on the row's viewer", async () => {
      const { user } = setup([command('bonk')]);

      await user.click(
        within(await openMenu(user)).getByRole('menuitem', { name: 'View viewer’s history' })
      );

      expect(
        screen.getByRole('status', { name: 'Current location', hidden: true })
      ).toHaveTextContent('/history?q=viewer');
    });
  });

  it('says which way the feed is sorted', async () => {
    const { user } = setup([command('bonk')]);
    expect(screen.getByText(/^Newest first/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Time' }));

    expect(screen.getByText(/^Oldest first/)).toBeInTheDocument();
  });
});
