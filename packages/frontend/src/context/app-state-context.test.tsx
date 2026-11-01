import { screen, waitFor } from '@testing-library/react';
import type { IntegrationInfo } from '@turingmod/shared';
import { IntegrationName } from '@turingmod/shared';
import { describe, expect, it } from 'vitest';
import { deferred, FakeSubscription } from '@/testing/fakeTrpc';
import { integration } from '@/testing/integrations';
import { renderConsole } from '@/testing/render-console';
import { type CommandInfo, useCommandList, useIntegrationState } from './app-state-context';

const COMMAND: CommandInfo = {
  name: 'lurk',
  description: 'Let chat know you are lurking',
  usage: '!lurk',
  permissions: [],
  cooldown: 0,
  availableOn: [],
};

const renders = { commands: 0, integrations: 0 };

function CommandCount() {
  renders.commands++;
  return <output aria-label="Commands">{useCommandList().length}</output>;
}

function IntegrationCount() {
  renders.integrations++;
  return <output aria-label="Integrations">{useIntegrationState().integrations.length}</output>;
}

describe('AppStateProvider', () => {
  it("doesn't render what reads only commands when the integrations change, or the reverse", async () => {
    const watch = new FakeSubscription<IntegrationInfo[]>();
    const list = deferred<CommandInfo[]>();
    renderConsole(
      <>
        <CommandCount />
        <IntegrationCount />
      </>,
      {
        procedures: {
          integrations: { watch },
          commands: { list: { query: () => list.promise } },
        },
      }
    );

    const commandRenders = renders.commands;
    watch.emit([integration(IntegrationName.OBS)]);
    expect(screen.getByLabelText('Integrations')).toHaveTextContent('1');
    expect(renders.commands).toBe(commandRenders);

    const integrationRenders = renders.integrations;
    list.resolve([COMMAND]);
    await waitFor(() => expect(screen.getByLabelText('Commands')).toHaveTextContent('1'));
    expect(renders.integrations).toBe(integrationRenders);
  });
});
