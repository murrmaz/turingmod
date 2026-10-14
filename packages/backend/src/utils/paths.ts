import { fileURLToPath } from 'node:url';

/**
 * `packages/backend/data`: bundled assets (`bonk.mp3`) plus files TuringMod writes for the
 * streamer, such as clip lists. Everything in it but the bundled assets is gitignored.
 */
export const DATA_DIRECTORY = fileURLToPath(new URL('../../data/', import.meta.url));

/**
 * The repository root's `.env`, located from this file rather than the working directory: npm runs
 * workspace scripts from `packages/backend`, while the README (and `.env.example`) put it at the
 * root, where the frontend's Vite config reads it too.
 */
export const ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));
