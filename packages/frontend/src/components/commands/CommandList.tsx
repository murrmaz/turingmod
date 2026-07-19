import Badge from '@cloudscape-design/components/badge';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import type { CommandInfo } from '@turingmod/shared';
import { PermissionLevel, Platform } from '@turingmod/shared';
import { useState } from 'react';
import { isCommandAvailableOnPlatform } from '../../constants/platformCapabilities';
import { useAppState } from '../../context/AppStateContext';
import { CommandSimulator } from './CommandSimulator';

/**
 * Command list component
 * Displays table of available commands; testing happens in the CommandSimulator below.
 */
export function CommandList() {
  const { commands } = useAppState();
  const [platform, setPlatform] = useState<Platform>(Platform.TWITCH);

  // Only show commands available on the selected platform (Twitch-only commands hide on YouTube).
  const visibleCommands = commands.filter((command) =>
    isCommandAvailableOnPlatform(command.requiredCapabilities, platform)
  );

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
          ]}
          items={visibleCommands}
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
        defaultPermissionLevel={PermissionLevel.VIEWER}
        platform={platform}
        onPlatformChange={setPlatform}
      />
    </SpaceBetween>
  );
}
