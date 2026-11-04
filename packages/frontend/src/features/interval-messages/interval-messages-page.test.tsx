import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeSubscription } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/render-console';
import { IntervalMessagesPage } from './interval-messages-page';
import type { IntervalMessage } from './useIntervalMessages';

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() })
);
vi.mock('sonner', () => ({ toast }));

interface Rotation {
  messages: IntervalMessage[];
  nextId: number | null;
}

function message(id: number, text: string, changes: Partial<IntervalMessage> = {}) {
  return { id, message: text, enabled: true, lastPostedAt: null, createdAt: id, ...changes };
}

function setup(rotation: Rotation) {
  const watch = new FakeSubscription<Rotation>();
  const procedures = {
    watch,
    add: { mutate: vi.fn(async (_: { message: string }) => rotation) },
    update: { mutate: vi.fn(async (_: { id: number; message: string }) => rotation) },
    setEnabled: { mutate: vi.fn(async (_: { id: number; enabled: boolean }) => rotation) },
    move: { mutate: vi.fn(async (_: { id: number; direction: 'up' | 'down' }) => rotation) },
    delete: { mutate: vi.fn(async (_: { ids: number[] }) => rotation) },
  };
  renderConsole(<IntervalMessagesPage />, { procedures: { intervalMessages: procedures } });
  act(() => watch.emit(rotation));
  return { user: userEvent.setup(), ...procedures };
}

const row = (text: string) => {
  const found = screen.getByText(text).closest('tr');
  if (!found) {
    throw new Error(`No row for ${text}`);
  }
  return within(found);
};

const TWO: Rotation = { messages: [message(1, 'first'), message(2, 'second')], nextId: 1 };

describe('Interval Messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says how to start when there are none', () => {
    setup({ messages: [], nextId: null });

    expect(screen.getByText(/No interval messages yet/)).toBeVisible();
  });

  it('says how often they post, from the interval the backend uses', () => {
    setup(TWO);

    expect(screen.getByText(/every 30 minutes while you're live/)).toBeVisible();
  });

  it('marks only the next message, and shows when each last posted', () => {
    setup({
      messages: [
        message(1, 'first', { lastPostedAt: new Date(2026, 0, 2, 3, 4).getTime() }),
        message(2, 'second'),
      ],
      nextId: 2,
    });

    expect(row('second').getByText('Next')).toBeVisible();
    expect(row('first').queryByText('Next')).toBeNull();
    expect(row('second').getByText('Never')).toBeVisible();
    expect(row('first').queryByText('Never')).toBeNull();
  });

  it('says when every message is paused, since nothing will be posted', () => {
    setup({ messages: [message(1, 'first', { enabled: false })], nextId: null });

    expect(screen.getByRole('alert')).toHaveTextContent('nothing will be posted');
  });

  it('adds a message and shows the answer', async () => {
    const { user, add } = setup({ messages: [], nextId: null });
    add.mutate.mockResolvedValue({ messages: [message(1, 'Join us')], nextId: 1 });

    await user.click(screen.getByRole('button', { name: 'Add message' }));
    await user.type(screen.getByLabelText('Message'), '  Join us  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(add.mutate).toHaveBeenCalledWith({ message: 'Join us' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Join us')).toBeVisible();
  });

  it('saves on Enter, without adding a line', async () => {
    const { user, add } = setup({ messages: [], nextId: null });

    await user.click(screen.getByRole('button', { name: 'Add message' }));
    await user.type(screen.getByLabelText('Message'), 'Join us{Enter}');

    expect(add.mutate).toHaveBeenCalledWith({ message: 'Join us' });
  });

  it('refuses a message starting with a command, and says why', async () => {
    const { user, add } = setup({ messages: [], nextId: null });

    await user.click(screen.getByRole('button', { name: 'Add message' }));
    await user.type(screen.getByLabelText('Message'), '!discord{Enter}');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByText(/Can't start with ! or \//)).toBeVisible();
    expect(add.mutate).not.toHaveBeenCalled();
  });

  it('warns when YouTube would cut a message off', async () => {
    const { user } = setup({ messages: [], nextId: null });

    await user.click(screen.getByRole('button', { name: 'Add message' }));
    await user.click(screen.getByLabelText('Message'));
    await user.paste('x'.repeat(201));

    expect(screen.getByText(/201 \/ 500\. YouTube cuts messages off at 200/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('edits a message when its row is clicked', async () => {
    const { user, update } = setup(TWO);

    await user.click(screen.getByText('second'));
    const field = screen.getByLabelText('Message');
    expect(field).toHaveValue('second');
    await user.clear(field);
    await user.type(field, 'changed');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(update.mutate).toHaveBeenCalledWith({ id: 2, message: 'changed' });
  });

  it('keeps the dialog and its text when saving fails', async () => {
    const { user, update } = setup(TWO);
    update.mutate.mockRejectedValue(new Error('That interval message no longer exists.'));

    await user.click(screen.getByText('second'));
    await user.type(screen.getByLabelText('Message'), ' changed{Enter}');

    expect(await screen.findByText('That interval message no longer exists.')).toBeVisible();
    expect(screen.getByLabelText('Message')).toHaveValue('second changed');
  });

  it('moves a message, and offers only the directions it can go', async () => {
    const { user, move } = setup(TWO);

    expect(row('first').getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(row('second').getByRole('button', { name: 'Move down' })).toBeDisabled();

    await user.click(row('second').getByRole('button', { name: 'Move up' }));

    expect(move.mutate).toHaveBeenCalledWith({ id: 2, direction: 'up' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('pauses a message without opening it', async () => {
    const { user, setEnabled } = setup(TWO);

    await user.click(row('first').getByRole('checkbox', { name: 'Pause message' }));

    expect(setEnabled.mutate).toHaveBeenCalledWith({ id: 1, enabled: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reports a move that fails', async () => {
    const { user, move } = setup(TWO);
    move.mutate.mockRejectedValue(new Error('nope'));

    await user.click(row('second').getByRole('button', { name: 'Move up' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't move the message", {
        description: 'nope',
      })
    );
  });

  it('hides a deleted message at once, sending the delete only when Undo lapses', async () => {
    const { user, delete: remove } = setup(TWO);

    await user.click(row('first').getByRole('button', { name: 'Message actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    expect(screen.queryByText('first')).toBeNull();
    expect(remove.mutate).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Deleting interval message…', expect.anything());

    const options = toast.mock.lastCall?.[1] as { onAutoClose: () => void };
    act(() => options.onAutoClose());

    expect(remove.mutate).toHaveBeenCalledWith({ ids: [1] });
  });

  it('brings a deleted message back on Undo', async () => {
    const { user, delete: remove } = setup(TWO);

    await user.click(row('first').getByRole('button', { name: 'Message actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const options = toast.mock.lastCall?.[1] as { action: { onClick: () => void } };
    act(() => options.action.onClick());

    expect(screen.getByText('first')).toBeVisible();
    expect(remove.mutate).not.toHaveBeenCalled();
  });
});
