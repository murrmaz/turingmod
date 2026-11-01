import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { IntegrationInfo } from '@turingmod/shared';
import type { ComponentType } from 'react';
import { type Mock, vi } from 'vitest';
import type { ConfigSetupModalProps } from '@/components/integrations/integration-config-dialog';
import type { RouterInputs } from '@/context/trpc-context';
import { renderConsole } from './render-console';

type Configure = (input: RouterInputs['integrations']['configure']) => Promise<IntegrationInfo[]>;

interface SetupModalView {
  user: UserEvent;
  /** What the dialog saved. */
  configure: Mock<Configure>;
  onSaved: Mock<() => void>;
}

/** A non-OAuth setup dialog open on `target`, over a backend that accepts what it saves. */
export function renderSetupModal(
  Modal: ComponentType<ConfigSetupModalProps>,
  target: IntegrationInfo
): SetupModalView {
  const configure = vi.fn<Configure>(async () => []);
  const onSaved = vi.fn<() => void>();
  renderConsole(<Modal integration={target} onDismiss={() => {}} onSaved={onSaved} />, {
    procedures: { integrations: { configure: { mutate: configure } } },
  });
  return { user: userEvent.setup(), configure, onSaved };
}
