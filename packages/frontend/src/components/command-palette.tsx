import { PermissionLevel } from '@turingmod/shared';
import { Database, History, LayoutDashboard, Plug, Terminal } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useAppState } from '@/context/AppStateContext';
import { useSimulator } from '@/features/commands/simulator';

const PAGES = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/commands', label: 'Commands', icon: Terminal },
  { to: '/integrations', label: 'Integrations', icon: Plug },
  { to: '/history', label: 'History', icon: History },
  { to: '/data', label: 'Data', icon: Database },
];

/**
 * ⌘K: jump to a page, or open a command in the simulator. Running goes through the simulator
 * sheet rather than straight from here, since a command's side effects are real.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { commands } = useAppState();
  const simulator = useSimulator();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search or run a command…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Go to">
          {PAGES.map(({ to, label, icon: Icon }) => (
            <CommandItem key={to} onSelect={() => run(() => navigate(to))}>
              <Icon />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Run as broadcaster">
          {commands.map((command) => (
            <CommandItem
              key={command.name}
              value={`!${command.name} ${command.description}`}
              onSelect={() =>
                run(() =>
                  simulator.open({
                    command: command.name,
                    permissionLevel: PermissionLevel.BROADCASTER,
                  })
                )
              }
            >
              <Terminal />
              <span className="font-mono">!{command.name}</span>
              <span className="truncate text-muted-foreground">{command.description}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
