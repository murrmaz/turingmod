import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ActivityLogEntry, PlatformLiveState } from '@turingmod/shared';
import { describe, expect, it, vi } from 'vitest';
import type { RouterOutputs } from '@/context/TrpcContext';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/renderConsole';
import { DashboardPage } from './dashboard-page';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

type FeedEvent = RouterOutputs['activity']['feed'] extends AsyncIterable<infer E> ? E : never;

let clock = Date.now() - 60_000;

/** A command run, which the feed titles `!name`. */
function command(name: string): ActivityLogEntry {
  clock += 1000;
  return {
    id: `command-${name}`,
    event: 'command.executed',
    timestamp: clock,
    data: { command: name, args: [], success: true, message: '', username: 'viewer' },
  };
}

function chat(message: string): ActivityLogEntry {
  clock += 1000;
  return {
    id: `chat-${message}`,
    event: 'chat.message',
    timestamp: clock,
    data: { message, username: 'viewer', platform: 'twitch' },
  };
}

function setup(stored: ActivityLogEntry[] = []) {
  const feed = new FakeSubscription<FeedEvent>();
  const user = userEvent.setup();
  renderConsole(<DashboardPage />, {
    procedures: {
      activity: { feed },
      liveState: { watch: new FakeSubscription<PlatformLiveState[]>() },
    },
  });
  feed.emit({ type: 'seed', entries: [...stored].reverse() });
  const arrive = (entry: ActivityLogEntry) => feed.emit({ type: 'entry', entry });
  return { feed, user, arrive };
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

  it('filters by the text typed after pressing /', async () => {
    const { user } = setup([command('lurk'), command('bonk')]);

    await user.keyboard('/');
    expect(screen.getByPlaceholderText('Filter events…')).toHaveFocus();
    await user.keyboard('bonk');

    expect(shownCommands()).toEqual(['!bonk']);
  });
});
