import { ExternalLink, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

/** The numbered steps of a setup dialog's instructions, with what to click in `<strong>`. */
export function SetupSteps({ children }: { children: ReactNode }) {
  return (
    <ol className="ml-5 list-decimal space-y-1.5 text-muted-foreground marker:text-subtle-foreground [&_strong]:text-foreground">
      {children}
    </ol>
  );
}

/** A link in those instructions, to a provider's own site, in a new tab. */
export function SetupLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
    >
      {children}
      <ExternalLink className="size-3" />
    </a>
  );
}

/** What a dialog says about where a secret goes. */
export function SecurityNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
