import type { PlaybackState } from '@spotify/web-api-ts-sdk';
import type { CommandResult } from '@turingmod/shared';
import { PermissionLevel, type PlatformCapability } from '@turingmod/shared';
import { injectable } from 'tsyringe';
import { SpotifyApiIntegration } from '../../integrations/implementations/spotify/SpotifyApiIntegration.js';
import { Logger } from '../../utils/Logger.js';
import type { CommandContext, ICommand } from '../interfaces/ICommand.js';
import { toCommandError } from '../utils/commandErrors.js';
import { ok } from '../utils/results.js';

/**
 * !song command
 * Says what's playing on the streamer's Spotify: a track with its artists, or a podcast episode
 * with its show, plus a link.
 */
@injectable()
export class SongCommand implements ICommand {
  readonly name = 'song';
  readonly description = 'Show the song playing on Spotify';
  readonly usage = '!song';
  readonly permissions = [PermissionLevel.VIEWER];
  /** Per-viewer, to keep a Spotify API read off the rate limit. */
  readonly cooldown = 30;
  // Spotify is the streamer's, not a platform's, so this works wherever chat does.
  readonly requiredCapabilities: PlatformCapability[] = [];

  private logger: Logger;

  constructor(
    private spotify: SpotifyApiIntegration,
    logger: Logger
  ) {
    this.logger = logger.child({ command: 'song' });
  }

  async execute(_context: CommandContext): Promise<CommandResult> {
    try {
      // Without 'episode', Spotify reports a playing podcast as nothing at all.
      const playback: PlaybackState | null = await this.spotify.request((sdk) =>
        sdk.player.getCurrentlyPlayingTrack(undefined, 'episode')
      );
      return ok(describePlayback(playback));
    } catch (error) {
      this.logger.error('Error in song command', error);
      return toCommandError(error, "Couldn't check Spotify right now");
    }
  }
}

/** The chat reply for what Spotify says is playing. */
export function describePlayback(playback: PlaybackState | null): string {
  // No playback at all (Spotify's 204), paused, or an ad, which comes with no item.
  const item = playback?.is_playing ? playback.item : null;
  if (!item) {
    return 'Nothing is playing on Spotify right now';
  }

  const parts = [`Now playing: ${item.name}`];
  if (item.type === 'episode' && 'show' in item) {
    parts.push(`from ${item.show.name}`);
  } else if ('artists' in item && item.artists.length > 0) {
    parts.push(`by ${item.artists.map((artist) => artist.name).join(', ')}`);
  }
  const link = item.external_urls.spotify;
  if (link) {
    parts.push(`— ${link}`);
  }
  return parts.join(' ');
}

export default SongCommand;
