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
});
