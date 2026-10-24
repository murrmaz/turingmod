import { type PlatformLiveState, platformDisplayName, StreamingPlatform } from '@turingmod/shared';
import { ChevronDown, Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { StatusDot } from '@/components/status';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { formatUptime } from '@/constants/activityFormat';
import { useNow, usePlatformLiveState } from '@/hooks/usePlatformLiveState';
import { useYouTubeChat } from '@/hooks/useYouTubeChat';
import { cn } from '@/lib/utils';

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  commands: 'Commands',
  integrations: 'Integrations',
  history: 'History',
  data: 'Data',
};

export function SiteHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { pathname } = useLocation();
  const title = TITLES[pathname.split('/')[1] ?? ''] ?? 'TuringMod';
  const platforms = usePlatformLiveState();
  const now = useNow();
  const stateOf = (platform: StreamingPlatform): PlatformLiveState =>
    platforms.find((state) => state.platform === platform) ?? {
      platform,
      live: false,
      startedAt: null,
    };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <h1 className="text-sm font-medium">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenPalette}
          className="hidden w-64 justify-start text-muted-foreground lg:flex"
        >
          <Search />
          <span className="flex-1 text-left font-normal">Search or run a command…</span>
          <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px]">⌘K</kbd>
        </Button>
        <PlatformBadge state={stateOf(StreamingPlatform.TWITCH)} now={now} />
        <YouTubeBadge state={stateOf(StreamingPlatform.YOUTUBE)} now={now} />
      </div>
    </header>
  );
}

function BadgeBody({ state, now }: { state: PlatformLiveState; now: number }) {
  return (
    <>
      <StatusDot tone={state.live ? 'error' : 'idle'} />
      <span className="font-semibold text-foreground">{platformDisplayName(state.platform)}</span>
      <span className="text-muted-foreground">{state.live ? 'Live' : 'Offline'}</span>
      {state.live && state.startedAt !== null && (
        <span className="font-mono text-muted-foreground tabular-nums">
          {formatUptime(now - state.startedAt)}
        </span>
      )}
    </>
  );
}

const BADGE_CLASS =
  'inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs whitespace-nowrap';

function PlatformBadge({ state, now }: { state: PlatformLiveState; now: number }) {
  return (
    <div className={BADGE_CLASS}>
      <BadgeBody state={state} now={now} />
    </div>
  );
}

const CHAT_STATE_TEXT = {
  idle: 'Chat not connected',
  resolving: 'Looking for a live broadcast…',
  streaming: 'Chat connected',
} as const;

/**
 * YouTube's badge also holds the manual chat control: OBS connects chat on its own when it starts
 * streaming, and this is for when it isn't in the picture.
 */
function YouTubeBadge({ state, now }: { state: PlatformLiveState; now: number }) {
  const chat = useYouTubeChat();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(BADGE_CLASS, 'hover:bg-accent')}>
        <BadgeBody state={state} now={now} />
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
          <StatusDot
            tone={
              chat.state === 'streaming' ? 'viewer' : chat.state === 'resolving' ? 'system' : 'idle'
            }
            pulse={chat.state === 'resolving'}
          />
          {CHAT_STATE_TEXT[chat.state]}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={chat.pending || chat.state !== 'idle'}
          onSelect={() => void chat.goLive().catch(() => undefined)}
        >
          Connect chat
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={chat.pending || chat.state === 'idle'}
          onSelect={() => void chat.goOffline().catch(() => undefined)}
        >
          Disconnect chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
