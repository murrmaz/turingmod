import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useSimulator } from '@/context/simulatorContext';
import { renderConsole } from '@/testing/render-console';

function OpenButton() {
  const simulator = useSimulator();
  return (
    <button type="button" onClick={() => simulator.open({ command: 'bonk' })}>
      Open
    </button>
  );
}

describe('SimulatorProvider', () => {
  it('opens on the command asked for, with every field labelled', async () => {
    const user = userEvent.setup();
    renderConsole(<OpenButton />);

    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(screen.getByLabelText('Command')).toHaveValue('!bonk ');
    expect(screen.getByLabelText('Username')).toHaveValue('TestUser');
    expect(screen.getByLabelText('Platform')).toHaveTextContent('Twitch');
    expect(screen.getByLabelText('Permission level')).toHaveTextContent('Viewer');
  });
});
