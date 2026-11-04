import { type PlatformLiveState, platformDisplayName, StreamingPlatform } from '@turingmod/shared';
import { ChevronDown, Search } from 'lucide-react';
import type { ComponentType } from 'react';
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
import { pageAt } from '@/constants/pages';
import { useConnection } from '@/context/trpc-context';
import { useNow } from '@/hooks/useNow';
import { usePlatformLiveState } from '@/hooks/usePlatformLiveState';
import { useYouTubeChat } from '@/hooks/useYouTubeChat';
import { reportActionError } from '@/lib/reportError';
import { formatUptime } from '@/lib/time';
import { cn } from '@/lib/utils';

export function SiteHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { pathname } = useLocation();
  const title = pageAt(pathname)?.label ?? 'TuringMod';
  const { platforms, status } = usePlatformLiveState();
  const isConnected = useConnection().connectionState === 'connected';
  const known = isConnected && status.state === 'live';
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
          <kbd className="rounded border bg-muted px-1.5 font-mono text-caption">⌘K</kbd>
        </Button>
        {Object.values(StreamingPlatform).map((platform) => {
          const Badge = PLATFORM_BADGES[platform];
          return <Badge key={platform} state={stateOf(platform)} known={known} now={now} />;
        })}
      </div>
    </header>
  );
}

interface BadgeProps {
  state: PlatformLiveState;
  /** False while the console is disconnected, or the live state hasn't arrived or has failed. */
  known: boolean;
  now: number;
}

/**
 * A platform's name and whether it's live. When that isn't known it says so, rather than calling
 * the platform offline or showing the last state with an uptime still counting.
 */
function BadgeBody({ state, known, now }: BadgeProps) {
  if (!known) {
    return (
      <>
        <StatusDot tone="idle" />
        <span className="font-semibold text-foreground">{platformDisplayName(state.platform)}</span>
        <span className="text-muted-foreground">Unknown</span>
      </>
    );
  }
  return (
    <>
      <StatusDot tone={state.live ? 'live' : 'idle'} />
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

function PlatformBadge(props: BadgeProps) {
  return (
    <div className={BADGE_CLASS}>
      <BadgeBody {...props} />
    </div>
  );
}

const CHAT_STATE_TEXT = {
  idle: 'Chat not connected',
  resolving: 'Looking for a live broadcast…',
  streaming: 'Chat connected',
} as const;

const CHAT_STATE_TONE = {
  idle: 'idle',
  resolving: 'pending',
  streaming: 'ok',
} as const;

/**
 * YouTube's badge also holds the manual chat control: OBS connects chat on its own when it starts
 * streaming, and this is for when it isn't in the picture.
 */
function YouTubeBadge(props: BadgeProps) {
  const chat = useYouTubeChat();
  const isConnected = useConnection().connectionState === 'connected';
  const chatKnown = isConnected && chat.status.state === 'live';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(BADGE_CLASS, 'hover:bg-accent')}>
        <BadgeBody {...props} />
        <ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex items-center gap-2 font-normal text-muted-foreground">
          <StatusDot
            tone={chatKnown ? CHAT_STATE_TONE[chat.state] : 'idle'}
            pulse={chatKnown && chat.state === 'resolving'}
          />
          {chatKnown
            ? CHAT_STATE_TEXT[chat.state]
            : isConnected
              ? 'Chat state unknown'
              : 'Not connected to TuringMod'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!chatKnown || chat.pending || chat.state !== 'idle'}
          onSelect={() =>
            void chat
              .goLive()
              .catch((error: unknown) => reportActionError("Couldn't connect YouTube chat", error))
          }
        >
          Connect chat
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!chatKnown || chat.pending || chat.state === 'idle'}
          onSelect={() =>
            void chat
              .goOffline()
              .catch((error: unknown) =>
                reportActionError("Couldn't disconnect YouTube chat", error)
              )
          }
        >
          Disconnect chat
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Each platform's badge, so a new platform doesn't compile until it has one. */
const PLATFORM_BADGES: Record<StreamingPlatform, ComponentType<BadgeProps>> = {
  [StreamingPlatform.TWITCH]: PlatformBadge,
  [StreamingPlatform.YOUTUBE]: YouTubeBadge,
};
