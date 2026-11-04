import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('./', import.meta.url));

/** The source of every module the build includes. */
function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => readFileSync(`${SRC}${file}`, 'utf8'));
}

/** Reads the source, since setup.ts resolves through decorator metadata tests don't have. */
describe('setup', () => {
  it('starts every class that implements IService, since nothing else would', () => {
    const declared = sourceFiles().flatMap((source) =>
      [...source.matchAll(/\bclass\s+(\w+)[^{]*?\bimplements\b[^{]*?\bIService\b/g)].map(
        ([, name]) => name
      )
    );
    const setup = readFileSync(`${SRC}setup.ts`, 'utf8');
    const added = [...setup.matchAll(/services\.add\(container\.resolve\((\w+)\)\)/g)].map(
      ([, name]) => name
    );

    expect(declared).toContain('BreakService'); // the pattern still finds them
    expect(added.sort()).toEqual(declared.sort());
  });

  describe('the order services start in, which they stop in reverse', () => {
    const order = [
      ...readFileSync(`${SRC}setup.ts`, 'utf8').matchAll(
        /services\.add\(container\.resolve\((\w+)\)\)/g
      ),
    ].map(([, name]) => name);

    it('puts what triggers actions last, so nothing new starts during the undoing', () => {
      expect(order.slice(-4)).toEqual([
        'RaidShoutout',
        'RewardRouter',
        'OwnChatMessages',
        'ChatRouter',
      ]);
    });

    it('stops what undoes things while what they rely on still runs', () => {
      const position = (name: string) => {
        expect(order).toContain(name);
        return order.indexOf(name);
      };

      // Ending a break unpauses rewards, which RewardSync carries to Twitch.
      expect(position('RewardSync')).toBeLessThan(position('BreakService'));
      // A break ending or an effect failing as it stops still reaches the activity log.
      expect(position('ActivityForwarder')).toBeLessThan(position('BreakService'));
      expect(position('ActivityForwarder')).toBeLessThan(position('FacecamEffectRunner'));
      // The go-live post follows PlatformLiveStatus's events.
      expect(position('PlatformLiveStatus')).toBeLessThan(position('GoLiveAnnouncer'));
    });
  });
});
