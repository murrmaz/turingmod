import {
  Database,
  History,
  LayoutDashboard,
  Lightbulb,
  type LucideIcon,
  Plug,
  Terminal,
} from 'lucide-react';

export interface Page {
  path: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The console's pages, in navigation order: the sidebar, the ⌘K palette and the header's title
 * all read them from here. A new page also needs its route in App.tsx.
 */
export const PAGES: readonly Page[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/commands', label: 'Commands', icon: Terminal },
  { path: '/integrations', label: 'Integrations', icon: Plug },
  { path: '/suggestions', label: 'Suggestions', icon: Lightbulb },
  { path: '/history', label: 'History', icon: History },
  { path: '/data', label: 'Data', icon: Database },
];

/** The page a location is on, including its sub-paths (`/data/settings` is Data). */
export function pageAt(pathname: string): Page | undefined {
  return PAGES.find((page) => pathname === page.path || pathname.startsWith(`${page.path}/`));
}
