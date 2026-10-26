import {
  type ExecutionResult,
  type ExecutorErrorCode,
  isExecutorErrorCode,
  messageOf,
  PermissionLevel,
  platformDisplayName,
  StreamingPlatform,
} from '@turingmod/shared';
import { CircleCheck, CircleX, Play } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

import { useCommands } from '@/hooks/useCommands';

export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  [PermissionLevel.VIEWER]: 'Viewer',
  [PermissionLevel.SUBSCRIBER]: 'Subscriber',
  [PermissionLevel.VIP]: 'VIP',
  [PermissionLevel.MODERATOR]: 'Moderator',
  [PermissionLevel.BROADCASTER]: 'Broadcaster',
};

/** What a simulation came back with, as the sheet and its toast show it. */
interface Outcome {
  success: boolean;
  title: string;
  message: string;
  /** For a failure: why, for the streamer */
  reason?: string;
}

const EXECUTOR_TITLES: Record<ExecutorErrorCode, string> = {
  COMMAND_NOT_FOUND: 'Not a command here',
  INSUFFICIENT_PERMISSIONS: 'Not allowed at this permission level',
  COMMAND_ON_COOLDOWN: 'On cooldown',
  EXECUTION_ERROR: 'The command crashed',
};

function toOutcome(result: ExecutionResult): Outcome {
  if (result.success) {
    return {
      success: true,
      title: 'Simulation result',
      message: result.message || 'Ran without a reply.',
    };
  }
  const { code, reason } = result.error;
  // The executor's own refusals get no reply in chat; say so, since the sheet shows one anyway.
  if (isExecutorErrorCode(code)) {
    return {
      success: false,
      title: EXECUTOR_TITLES[code],
      message: `${result.message}. In chat this gets no reply.`,
      reason,
    };
  }
  return { success: false, title: 'Command failed', message: result.message, reason };
}

interface SimulatorRequest {
  command?: string;
  permissionLevel?: PermissionLevel;
}

interface SimulatorContextValue {
  /** Open the simulator, optionally on a command (name without `!`). */
  open: (request?: SimulatorRequest) => void;
}

const SimulatorContext = createContext<SimulatorContextValue | null>(null);

export function useSimulator(): SimulatorContextValue {
  const context = useContext(SimulatorContext);
  if (!context) {
    throw new Error('useSimulator must be used within SimulatorProvider');
  }
  return context;
}

/**
 * The command simulator, as a sheet any page (or the command palette) can open. It runs commands
 * for real, side effects included, as if a viewer had typed them.
 */
export function SimulatorProvider({ children }: { children: ReactNode }) {
  const { simulateCommand } = useCommands();
  const [isOpen, setIsOpenState] = useState(false);
  // Read when a run finishes, to decide whether its result needs a toast.
  const isOpenRef = useRef(false);
  const setIsOpen = useCallback((next: boolean) => {
    isOpenRef.current = next;
    setIsOpenState(next);
  }, []);
  const [commandText, setCommandText] = useState('');
  const [username, setUsername] = useState('TestUser');
  const [platform, setPlatform] = useState<StreamingPlatform>(StreamingPlatform.TWITCH);
  const [permissionLevel, setPermissionLevel] = useState<PermissionLevel>(PermissionLevel.VIEWER);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const open = useCallback(
    (request: SimulatorRequest = {}) => {
      if (request.command !== undefined) {
        setCommandText(`!${request.command} `);
      }
      if (request.permissionLevel !== undefined) {
        setPermissionLevel(request.permissionLevel);
      }
      setOutcome(null);
      setIsOpen(true);
    },
    [setIsOpen]
  );

  const run = async () => {
    setRunning(true);
    setOutcome(null);
    let next: Outcome;
    try {
      const result = await simulateCommand(
        commandText.trim(),
        { username: username.trim() || 'TestUser', permissionLevel },
        platform
      );
      next = toOutcome(result);
    } catch (error) {
      next = { success: false, title: 'Simulation failed', message: messageOf(error) };
    } finally {
      setRunning(false);
    }
    setOutcome(next);
    // The sheet may have been closed while it ran; the result still deserves to be seen.
    if (!isOpenRef.current) {
      (next.success ? toast.success : toast.error)(next.title, { description: next.message });
    }
  };

  const commandName = commandText.trim().split(/\s+/)[0] ?? '';

  return (
    <SimulatorContext.Provider value={{ open }}>
      {children}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent className="w-[420px] gap-0 sm:max-w-[420px]">
          <SheetHeader className="p-6 pb-4">
            <SheetTitle className="text-lg">
              Simulate{' '}
              {commandName.startsWith('!') && commandName.length > 1 && (
                <span className="font-mono">{commandName}</span>
              )}
            </SheetTitle>
            <SheetDescription>
              Runs as if a viewer typed it — side effects are real.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-col gap-5 px-6"
            onSubmit={(event) => {
              event.preventDefault();
              void run();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="sim-command">Command</Label>
              <Input
                id="sim-command"
                className="font-mono"
                value={commandText}
                onChange={(event) => setCommandText(event.target.value)}
                placeholder="!bonk @user"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sim-user">Username</Label>
                <Input
                  id="sim-user"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Platform</Label>
                <Select
                  value={platform}
                  onValueChange={(value) => setPlatform(value as StreamingPlatform)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.values(StreamingPlatform).map((value) => (
                      <SelectItem key={value} value={value}>
                        {platformDisplayName(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Permission level</Label>
              <Select
                value={permissionLevel}
                onValueChange={(value) => setPermissionLevel(value as PermissionLevel)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(PermissionLevel).map((value) => (
                    <SelectItem key={value} value={value}>
                      {PERMISSION_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={running || !commandText.trim()} className="w-full">
              <Play />
              {running ? 'Running…' : 'Run simulation'}
            </Button>
            {outcome && (
              <Alert variant={outcome.success ? 'default' : 'destructive'}>
                {outcome.success ? <CircleCheck className="text-cat-viewer!" /> : <CircleX />}
                <AlertTitle>{outcome.title}</AlertTitle>
                <AlertDescription>
                  <p>{outcome.message}</p>
                  {outcome.reason && (
                    <p className="font-mono text-xs text-muted-foreground">{outcome.reason}</p>
                  )}
                </AlertDescription>
              </Alert>
            )}
          </form>
        </SheetContent>
      </Sheet>
    </SimulatorContext.Provider>
  );
}
