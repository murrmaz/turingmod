import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Tone } from '@/lib/tone';
import { cn } from '@/lib/utils';

const DOT: Record<Tone, string> = {
  command: 'bg-cat-command',
  reward: 'bg-cat-reward',
  viewer: 'bg-cat-viewer',
  chat: 'bg-cat-chat',
  system: 'bg-cat-system',
  error: 'bg-cat-error',
  idle: 'bg-cat-idle',
};

export const TONE_TEXT: Record<Tone, string> = {
  command: 'text-cat-command',
  reward: 'text-cat-reward',
  viewer: 'text-cat-viewer',
  chat: 'text-cat-chat',
  system: 'text-cat-system',
  error: 'text-cat-error',
  idle: 'text-subtle-foreground',
};

export function StatusDot({
  tone,
  className,
  pulse = false,
}: {
  tone: Tone;
  className?: string;
  pulse?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full',
        DOT[tone],
        pulse && 'animate-pulse',
        className
      )}
    />
  );
}

/** An outline badge with a coloured dot, e.g. a feed row's type or a permission level. */
export function DotBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 rounded-md px-2 text-caption font-semibold', className)}
    >
      <StatusDot tone={tone} className="size-1.5" />
      {children}
    </Badge>
  );
}
