import {
  Database,
  History,
  LayoutDashboard,
  Lightbulb,
  type LucideIcon,
  Plug,
  Terminal,
} from 'lucide-react';

export type PageId = 'dashboard' | 'commands' | 'integrations' | 'suggestions' | 'history' | 'data';

/**
 * The URL parameters pages keep their state in, named once so a page and every link into it
 * agree: History's search (`?q=`), the integration open on the Integrations page
 * (`?selected=`), and the table the Data page shows (`/data/:table`).
 */
export const URL_PARAMS = {
  historySearch: 'q',
  selectedIntegration: 'selected',
  dataTable: 'table',
} as const;

export interface Page {
  id: PageId;
  path: string;
  label: string;
  icon: LucideIcon;
  /** A path segment after `path` the page reads, optional: Data's table (`/data/settings`). */
  param?: string;
}

/**
 * The console's pages, in navigation order. The routes (app.tsx), the sidebar, the ⌘K palette
 * and the header's title are all made from this list; a new page also needs its component in
 * app.tsx's PAGE_COMPONENTS, which the compiler asks for.
 */
export const PAGES: readonly Page[] = [
  { id: 'dashboard', path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'commands', path: '/commands', label: 'Commands', icon: Terminal },
  { id: 'integrations', path: '/integrations', label: 'Integrations', icon: Plug },
  { id: 'suggestions', path: '/suggestions', label: 'Suggestions', icon: Lightbulb },
  { id: 'history', path: '/history', label: 'History', icon: History },
  { id: 'data', path: '/data', label: 'Data', icon: Database, param: URL_PARAMS.dataTable },
];

/** Where the console opens, and where an address that's no page leads. */
export const HOME_PAGE: PageId = 'dashboard';

/** A page's address. */
export function pagePath(id: PageId): string {
  const page = PAGES.find((candidate) => candidate.id === id);
  if (!page) {
    throw new Error(`No page ${id}`);
  }
  return page.path;
}

/** The route pattern a page is served on, its optional parameter included (`/data/:table?`). */
export function routePattern(page: Page): string {
  return page.param === undefined ? page.path : `${page.path}/:${page.param}?`;
}

/** The page a location is on, including its sub-paths (`/data/settings` is Data). */
export function pageAt(pathname: string): Page | undefined {
  return PAGES.find((page) => pathname === page.path || pathname.startsWith(`${page.path}/`));
}

/**
 * Links that open a page on something. Every link into a page's state is built here, from
 * URL_PARAMS, rather than written out where it's used.
 */
export const links = {
  /** History, searching for a viewer's activity. */
  historyOf: (user: string) =>
    `${pagePath('history')}?${new URLSearchParams({ [URL_PARAMS.historySearch]: user })}`,
  /** The Integrations page, with one integration's details open. */
  integration: (name: string) =>
    `${pagePath('integrations')}?${new URLSearchParams({ [URL_PARAMS.selectedIntegration]: name })}`,
  /** One table on the Data page. */
  dataTable: (table: string) => `${pagePath('data')}/${encodeURIComponent(table)}`,
};
