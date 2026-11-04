import { act, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { type ExecutionResult, PermissionLevel, StreamingPlatform } from '@turingmod/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type SimulatorRequest, useSimulator } from '@/context/simulatorContext';
import { deferred } from '@/testing/fakeTrpc';
import { renderConsole } from '@/testing/render-console';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

function OpenButton({
  request = { command: 'bonk' },
  label = 'Open',
}: {
  request?: SimulatorRequest;
  label?: string;
}) {
  const simulator = useSimulator();
  return (
    <button type="button" onClick={() => simulator.open(request)}>
      {label}
    </button>
  );
}

/** Reads the simulator like any page, saying each time it renders. */
function CountingOpener({ onRender }: { onRender: () => void }) {
  const simulator = useSimulator();
  onRender();
  return (
    <button type="button" onClick={() => simulator.open({ command: 'bonk' })}>
      Open
    </button>
  );
}

const replied = (message: string): ExecutionResult => ({ success: true, message });
const refused = (message: string, reason: string): ExecutionResult => ({
  success: false,
  message,
  error: { code: 'COMMAND_ON_COOLDOWN', reason },
});
const failed = (message: string, reason: string): ExecutionResult => ({
  success: false,
  message,
  error: { code: 'INVALID_INPUT', reason },
});

type Simulate = (input: {
  commandText: string;
  simulatedUser: { username: string; permissionLevel: PermissionLevel };
  platform: StreamingPlatform;
}) => Promise<ExecutionResult>;

/** The sheet opened on !bonk, over a backend answering with `simulate`. */
async function openOver(simulate: Simulate) {
  const user = userEvent.setup();
  renderConsole(<OpenButton />, { procedures: { commands: { simulate: { mutate: simulate } } } });
  await user.click(screen.getByRole('button', { name: 'Open' }));
  return user;
}

const runIt = (user: UserEvent) =>
  user.click(screen.getByRole('button', { name: 'Run simulation' }));

describe('SimulatorProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens on the command asked for, with every field labelled', async () => {
    const user = userEvent.setup();
    renderConsole(<OpenButton />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByLabelText('Command')).toHaveValue('!bonk ');
    expect(screen.getByLabelText('Username')).toHaveValue('TestUser');
    expect(screen.getByLabelText('Platform')).toHaveTextContent('Twitch');
    expect(screen.getByLabelText('Permission level')).toHaveTextContent('Viewer');
  });

  it("doesn't render what opens it again as the form is filled in", async () => {
    let renders = 0;
    const user = userEvent.setup();
    renderConsole(
      <CountingOpener
        onRender={() => {
          renders += 1;
        }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    const before = renders;
    await user.type(screen.getByLabelText('Command'), 'abc');

    expect(renders).toBe(before);
  });

  it('goes back to a viewer when the next opening asks for no level', async () => {
    const user = userEvent.setup();
    renderConsole(
      <>
        <OpenButton request={{ permissionLevel: PermissionLevel.BROADCASTER }} />
        <OpenButton request={{ command: 'bonk' }} label="Open as anyone" />
      </>
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Open as anyone' }));

    expect(screen.getByLabelText('Permission level')).toHaveTextContent('Viewer');
  });

  it('opens at the permission level asked for', async () => {
    const user = userEvent.setup();
    renderConsole(<OpenButton request={{ permissionLevel: PermissionLevel.BROADCASTER }} />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByLabelText('Permission level')).toHaveTextContent('Broadcaster');
  });

  it('runs what the form says, as the user and platform chosen', async () => {
    const simulate = vi.fn<Simulate>(async () => replied('Bonk!'));
    const user = await openOver(simulate);

    await user.type(screen.getByLabelText('Command'), '@streamer  ');
    await user.clear(screen.getByLabelText('Username'));
    await user.type(screen.getByLabelText('Username'), '  sam ');
    await user.click(screen.getByLabelText('Platform'));
    await user.click(await screen.findByRole('option', { name: 'YouTube' }));
    await user.click(screen.getByLabelText('Permission level'));
    await user.click(await screen.findByRole('option', { name: 'Broadcaster' }));
    await runIt(user);

    expect(simulate).toHaveBeenCalledWith({
      commandText: '!bonk @streamer',
      simulatedUser: { username: 'sam', permissionLevel: PermissionLevel.BROADCASTER },
      platform: StreamingPlatform.YOUTUBE,
    });
  });

  it('falls back to the default username when it is left blank', async () => {
    const simulate = vi.fn<Simulate>(async () => replied('Bonk!'));
    const user = await openOver(simulate);

    await user.clear(screen.getByLabelText('Username'));
    await runIt(user);

    expect(simulate.mock.calls[0]?.[0].simulatedUser.username).toBe('TestUser');
  });

  it("can't run with no command, or while one is running", async () => {
    const answer = deferred<ExecutionResult>();
    const user = await openOver(() => answer.promise);

    await user.clear(screen.getByLabelText('Command'));
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeDisabled();

    await user.type(screen.getByLabelText('Command'), '!bonk');
    await runIt(user);
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();

    await act(async () => answer.resolve(replied('Bonk!')));
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeEnabled();
  });

  it('shows the reply of a command that ran', async () => {
    const user = await openOver(async () => replied('Bonk!'));

    await runIt(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Simulation result');
    expect(alert).toHaveTextContent('Bonk!');
  });

  it('says when a command ran without replying', async () => {
    const user = await openOver(async () => replied(''));

    await runIt(user);

    expect(await screen.findByRole('alert')).toHaveTextContent('Ran without a reply.');
  });

  it("says what the executor refused, and that chat wouldn't hear about it", async () => {
    const user = await openOver(async () => refused('Wait a bit', '12s left'));

    await runIt(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('On cooldown');
    expect(alert).toHaveTextContent('Wait a bit. In chat this gets no reply.');
    expect(alert).toHaveTextContent('12s left');
  });

  it("shows a command's own failure as the reply chat would get, with the reason", async () => {
    const user = await openOver(async () => failed('Usage: !bonk @user', 'No target'));

    await runIt(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Command failed');
    expect(alert).toHaveTextContent('Usage: !bonk @user');
    expect(alert).not.toHaveTextContent('In chat this gets no reply.');
    expect(alert).toHaveTextContent('No target');
  });

  it("says so when the request itself fails, and doesn't get stuck running", async () => {
    const user = await openOver(() => Promise.reject(new Error('Connection lost')));

    await runIt(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Simulation failed');
    expect(alert).toHaveTextContent('Connection lost');
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeEnabled();
  });

  it("shows a result in the sheet only, while it's open", async () => {
    const user = await openOver(async () => replied('Bonk!'));

    await runIt(user);
    await screen.findByRole('alert');

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts a success that arrives after the sheet was closed', async () => {
    const answer = deferred<ExecutionResult>();
    const user = await openOver(() => answer.promise);

    await runIt(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Command')).not.toBeInTheDocument());
    await act(async () => answer.resolve(replied('Bonk!')));

    expect(toast.success).toHaveBeenCalledWith('Simulation result', { description: 'Bonk!' });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts a failure that arrives after the sheet was closed', async () => {
    const answer = deferred<ExecutionResult>();
    const user = await openOver(() => answer.promise);

    await runIt(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Command')).not.toBeInTheDocument());
    await act(async () => answer.reject(new Error('Connection lost')));

    expect(toast.error).toHaveBeenCalledWith('Simulation failed', {
      description: 'Connection lost',
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('opens afresh, without the last result', async () => {
    const user = await openOver(async () => replied('Bonk!'));

    await runIt(user);
    await screen.findByRole('alert');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByLabelText('Command')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByLabelText('Command')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
