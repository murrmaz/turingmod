import { BAN_DURATION_MS } from '@turingmod/shared';
import { singleton } from 'tsyringe';
import { EventBus } from '../../../core/EventBus.js';
import {
  type BannedWord,
  BannedWordRepository,
} from '../../../database/repositories/BannedWordRepository.js';
import { banCutoff } from './bannedWords.js';

export interface ListedBannedWord extends BannedWord {
  /** Epoch milliseconds. A row stays listed after this, as a lapsed ban. */
  expiresAt: number;
}

/**
 * The banned words the streamer manages on the console and the Ban A Word reward adds to.
 * Everything that changes one goes through here, so `bannedWords.changed`, and through it the
 * console (`bannedWords.watch`), hears of every change. Words are given in stored form
 * (`BannedWordSchema`). Writing to a word that's gone (another console deleted it) throws, with
 * the message the console shows. ChatModerator reads the repository directly, since it only reads.
 */
@singleton()
export class BannedWordList {
  constructor(
    private eventBus: EventBus,
    private words: BannedWordRepository
  ) {}

  list(): ListedBannedWord[] {
    return this.words.list().map((word) => ({
      ...word,
      expiresAt: word.bannedAt + BAN_DURATION_MS,
    }));
  }

  /** Whether a ban on this word is in force. */
  isBanned(word: string): boolean {
    return this.words.isActive(word, banCutoff());
  }

  /**
   * Ban a word for a month, renewing a lapsed ban. `bannedBy` is null for the streamer. Unless told
   * otherwise, how it matches follows its length (`defaultWholeWord()`).
   */
  ban(word: string, bannedBy: string | null, wholeWord?: boolean): void {
    if (this.isBanned(word)) {
      throw new Error(`"${word}" is already banned.`);
    }
    this.words.ban(word, bannedBy, Date.now(), wholeWord);
    this.changed();
  }

  /** Correct a word's spelling or how it matches, keeping who banned it and when. */
  update(word: string, newWord: string, wholeWord: boolean): void {
    if (word !== newWord && this.words.has(newWord)) {
      throw new Error(`"${newWord}" is already on the list.`);
    }
    this.require(this.words.update(word, newWord, wholeWord), word);
    this.changed();
  }

  /** Restart a word's month, keeping who banned it. */
  renew(word: string): void {
    this.require(this.words.renew(word), word);
    this.changed();
  }

  /** Delete these words; ones already gone are skipped. */
  remove(words: readonly string[]): void {
    const removed = words.filter((word) => this.words.remove(word));
    if (removed.length > 0) {
      this.changed();
    }
  }

  private require(found: boolean, word: string): void {
    if (!found) {
      throw new Error(`"${word}" is no longer on the list.`);
    }
  }

  private changed(): void {
    this.eventBus.emitSync('bannedWords.changed', undefined);
  }
}
