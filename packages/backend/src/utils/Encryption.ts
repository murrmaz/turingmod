import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { DatabaseManager } from '../database/DatabaseManager.js';

/**
 * Encryption utility for securing API tokens and sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */
export class Encryption {
  private static readonly SALT_LENGTH = 32;
  private static readonly SALT_SETTINGS_KEY = 'encryption_salt';

  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  private readonly authTagLength = 16;

  private key: Buffer;

  constructor(masterPassword: string, salt: Buffer) {
    this.key = scryptSync(masterPassword, salt, this.keyLength);
  }

  /**
   * Read this install's salt from the settings table, generating and persisting a random one on
   * first run. Storing it (rather than hardcoding it) means an attacker who obtains a single
   * ciphertext without the database can no longer reuse a precomputed table across installs — they
   * need the matching salt too, which only exists in that install's own database.
   */
  static getOrCreateSalt(db: DatabaseManager): Buffer {
    const row = db.queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [
      Encryption.SALT_SETTINGS_KEY,
    ]);
    if (row) {
      return Buffer.from(row.value, 'base64');
    }

    const salt = randomBytes(Encryption.SALT_LENGTH);
    db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [
      Encryption.SALT_SETTINGS_KEY,
      salt.toString('base64'),
      Date.now(),
    ]);
    return salt;
  }

  /**
   * Encrypt data
   * @param plaintext - Data to encrypt
   * @returns Encrypted data as base64 string (format: iv:authTag:ciphertext)
   */
  encrypt(plaintext: string): string {
    // Generate random IV (initialization vector)
    const iv = randomBytes(this.ivLength);

    // Create cipher
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    // Encrypt
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

    // Get authentication tag
    const authTag = cipher.getAuthTag();

    // Combine iv:authTag:ciphertext and encode as base64
    const result = Buffer.concat([iv, authTag, encrypted]);
    return result.toString('base64');
  }

  /**
   * Decrypt data
   * @param ciphertext - Encrypted data as base64 string
   * @returns Decrypted plaintext
   */
  decrypt(ciphertext: string): string {
    // Decode base64
    const buffer = Buffer.from(ciphertext, 'base64');

    // Extract components
    const iv = buffer.subarray(0, this.ivLength);
    const authTag = buffer.subarray(this.ivLength, this.ivLength + this.authTagLength);
    const encrypted = buffer.subarray(this.ivLength + this.authTagLength);

    // Create decipher
    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);

    // Decrypt
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return decrypted.toString('utf8');
  }

  /**
   * Encrypt an object (converts to JSON first)
   */
  encryptObject<T>(obj: T): string {
    const json = JSON.stringify(obj);
    return this.encrypt(json);
  }

  /**
   * Decrypt an object (parses JSON after decryption)
   */
  decryptObject<T>(ciphertext: string): T {
    const json = this.decrypt(ciphertext);
    return JSON.parse(json) as T;
  }

  /**
   * Generate a hash of the key for verification
   */
  getKeyHash(): string {
    return createHash('sha256').update(this.key).digest('hex');
  }
}
