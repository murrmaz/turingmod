import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import type { SelectProps } from '@cloudscape-design/components/select';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { PermissionLevel, Platform } from '@turingmod/shared';
import { useState } from 'react';
import { useCommands } from '../../hooks/useCommands';

/**
 * Command simulator props
 */
export interface CommandSimulatorProps {
  defaultCommand?: string;
  defaultPermissionLevel?: PermissionLevel;
  /** Controlled platform value. When provided, the parent owns the selection. */
  platform?: Platform;
  /** Notified when the user changes the platform, so the parent can filter its command list. */
  onPlatformChange?: (platform: Platform) => void;
}

const PLATFORM_OPTIONS: SelectProps.Option[] = [
  { label: 'Twitch', value: Platform.TWITCH },
  { label: 'YouTube', value: Platform.YOUTUBE },
];

/**
 * Command simulator component
 * Allows testing commands with simulated users
 */
export function CommandSimulator({
  defaultCommand = '',
  defaultPermissionLevel = PermissionLevel.VIEWER,
  platform,
  onPlatformChange,
}: CommandSimulatorProps) {
  const { simulateCommand } = useCommands();
  const [commandText, setCommandText] = useState(defaultCommand ? `!${defaultCommand}` : '');
  const [username, setUsername] = useState('TestUser');
  const [permissionLevel, setPermissionLevel] = useState<SelectProps.Option>({
    label: defaultPermissionLevel,
    value: defaultPermissionLevel,
  });
  const [internalPlatform, setInternalPlatform] = useState<Platform>(platform ?? Platform.TWITCH);
  const selectedPlatform = platform ?? internalPlatform;
  const [isExecuting, setIsExecuting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const permissionOptions: SelectProps.Option[] = [
    { label: 'Viewer', value: PermissionLevel.VIEWER },
    { label: 'Subscriber', value: PermissionLevel.SUBSCRIBER },
    { label: 'VIP', value: PermissionLevel.VIP },
    { label: 'Moderator', value: PermissionLevel.MODERATOR },
    { label: 'Broadcaster', value: PermissionLevel.BROADCASTER },
  ];

  const selectedPlatformOption =
    PLATFORM_OPTIONS.find((option) => option.value === selectedPlatform) ?? null;

  const handlePlatformChange = (next: Platform) => {
    setInternalPlatform(next);
    onPlatformChange?.(next);
  };

  const handleExecute = async () => {
    if (!commandText.trim()) {
      setResult({
        success: false,
        message: 'Please enter a command',
      });
      return;
    }

    setIsExecuting(true);
    setResult(null);

    try {
      const response = await simulateCommand(
        commandText,
        {
          username,
          permissionLevel: permissionLevel.value as PermissionLevel,
        },
        selectedPlatform
      );

      setResult({
        success: response.result.success,
        message: response.result.message || 'Command executed successfully',
      });
    } catch (error) {
      setResult({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to execute command',
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <Container
      header={
        <Header variant="h2" description="Test commands without going live">
          Command Simulator
        </Header>
      }
    >
      <SpaceBetween size="l">
        <FormField label="Platform" description="The platform to simulate the command on">
          <Select
            selectedOption={selectedPlatformOption}
            onChange={(event) =>
              handlePlatformChange(event.detail.selectedOption.value as Platform)
            }
            options={PLATFORM_OPTIONS}
          />
        </FormField>

        <FormField label="Command Text" description="Enter the command to test (e.g., !bonk @user)">
          <Input
            value={commandText}
            onChange={(event) => setCommandText(event.detail.value)}
            placeholder="!bonk @user"
          />
        </FormField>

        <FormField label="Simulated Username" description="The username of the simulated user">
          <Input
            value={username}
            onChange={(event) => setUsername(event.detail.value)}
            placeholder="TestUser"
          />
        </FormField>

        <FormField
          label="Permission Level"
          description="The permission level of the simulated user"
        >
          <Select
            selectedOption={permissionLevel}
            onChange={(event) =>
              setPermissionLevel(event.detail.selectedOption as SelectProps.Option)
            }
            options={permissionOptions}
          />
        </FormField>

        <Button variant="primary" onClick={handleExecute} loading={isExecuting}>
          Execute Simulation
        </Button>

        {result && (
          <Alert type={result.success ? 'success' : 'error'} header="Simulation Result">
            <Box>{result.message}</Box>
          </Alert>
        )}
      </SpaceBetween>
    </Container>
  );
}
