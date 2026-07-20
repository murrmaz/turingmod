import { chromium, firefox, webkit } from 'playwright';

// Playwright manages its own browser binaries per-machine (`npx playwright
// install <browser>`), independent of whatever's on the OS. Different
// developers/agents may have installed different engines, so detect what's
// actually available instead of assuming one.
const CANDIDATES = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
];

/**
 * Returns { name, type } for the first Playwright browser engine that can
 * actually launch on this machine. Throws with install instructions if none can.
 */
export async function getInstalledBrowser() {
  for (const candidate of CANDIDATES) {
    try {
      const browser = await candidate.type.launch({ headless: true });
      await browser.close();
      return candidate;
    } catch {
      // Not installed for this engine — try the next.
    }
  }

  throw new Error(
    'No Playwright browser is installed. Run `npx playwright install chromium` ' +
      '(or `firefox` / `webkit`) and try again.'
  );
}
