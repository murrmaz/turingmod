import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Modal from '@cloudscape-design/components/modal';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { CommandInfo } from '@turingmod/shared';
import { PermissionLevel } from '@turingmod/shared';
import { useState } from 'react';
import { useAppState } from '../../context/AppStateContext';
import { CommandSimulator } from './CommandSimulator';

/**
 * Command list component
 * Displays table of available commands
 */
export function CommandList() {
  const { commands } = useAppState();
  const [selectedCommand, setSelectedCommand] = useState<CommandInfo | null>(null);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);

  const handleTestCommand = (command: CommandInfo) => {
    setSelectedCommand(command);
    setIsSimulatorOpen(true);
  };

  const getPermissionColor = (level: string): 'blue' | 'green' | 'red' | 'grey' => {
    switch (level) {
      case 'broadcaster':
        return 'red';
      case 'moderator':
        return 'blue';
      case 'vip':
      case 'subscriber':
        return 'green';
      default:
        return 'grey';
    }
  };

  return (
    <>
      <SpaceBetween size="l">
        <Container
          header={
            <Header variant="h1" description="Manage and test chat commands">
              Commands
            </Header>
          }
        >
          <Table
            columnDefinitions={[
              {
                id: 'name',
                header: 'Command',
                cell: (item: CommandInfo) => `!${item.name}`,
                sortingField: 'name',
              },
              {
                id: 'description',
                header: 'Description',
                cell: (item: CommandInfo) => item.description,
              },
              {
                id: 'permissions',
                header: 'Permission Level',
                cell: (item: CommandInfo) => (
                  <Badge color={getPermissionColor(item.permissions[0] || 'viewer')}>
                    {item.permissions.join(', ')}
                  </Badge>
                ),
              },
              {
                id: 'cooldown',
                header: 'Cooldown',
                cell: (item: CommandInfo) => `${item.cooldown}s`,
              },
              {
                id: 'actions',
                header: 'Actions',
                cell: (item: CommandInfo) => (
                  <Button onClick={() => handleTestCommand(item)}>Test</Button>
                ),
              },
            ]}
            items={commands}
            loadingText="Loading commands..."
            empty={
              <Box textAlign="center" color="inherit">
                <b>No commands available</b>
                <Box padding={{ bottom: 's' }} variant="p" color="inherit">
                  Commands will appear here once the backend is connected.
                </Box>
              </Box>
            }
          />
        </Container>

        <CommandSimulator
          {...(selectedCommand?.name && { defaultCommand: selectedCommand.name })}
          defaultPermissionLevel={PermissionLevel.VIEWER}
        />
      </SpaceBetween>

      <Modal
        visible={isSimulatorOpen}
        onDismiss={() => setIsSimulatorOpen(false)}
        header={`Test Command: !${selectedCommand?.name}`}
        size="large"
      >
        <CommandSimulator
          {...(selectedCommand?.name && { defaultCommand: selectedCommand.name })}
          defaultPermissionLevel={PermissionLevel.VIEWER}
        />
      </Modal>
    </>
  );
}
