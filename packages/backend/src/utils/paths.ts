import { fileURLToPath } from 'node:url';

/**
 * `packages/backend/data`: bundled assets (`bonk.mp3`) plus files TuringMod writes for the
 * streamer, such as clip lists. Everything in it but the bundled assets is gitignored.
 */
export const DATA_DIRECTORY = fileURLToPath(new URL('../../data/', import.meta.url));
