import { describe, expect, it } from 'vitest';
import { links, PAGES, pageAt, pagePath, routePattern, URL_PARAMS } from './pages';

describe('pages', () => {
  it('names every page once', () => {
    const ids = PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(PAGES.map((page) => page.path)).size).toBe(ids.length);
  });

  it('serves a page with a parameter on its path with or without it', () => {
    const data = PAGES.find((page) => page.id === 'data');
    const commands = PAGES.find((page) => page.id === 'commands');

    expect(data && routePattern(data)).toBe(`/data/:${URL_PARAMS.dataTable}?`);
    expect(commands && routePattern(commands)).toBe('/commands');
  });

  it('finds the page an address is on, its sub-paths included', () => {
    expect(pageAt('/data/settings')?.id).toBe('data');
    expect(pageAt('/data')?.id).toBe('data');
    expect(pageAt('/database')).toBeUndefined();
    expect(pageAt('/nowhere')).toBeUndefined();
  });

  it('builds links that survive any text', () => {
    expect(links.historyOf('Ana & Bo')).toBe(`${pagePath('history')}?q=Ana+%26+Bo`);
    expect(links.integration('twitch-api')).toBe('/integrations?selected=twitch-api');
    expect(links.dataTable('a/b c')).toBe('/data/a%2Fb%20c');
  });
});
