import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

/**
 * Encryption utility for securing API tokens and sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */
export class Encryption {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16; // 128 bits
  // private readonly saltLength = 32;
  private readonly authTagLength = 16;

  private key: Buffer;

  constructor(masterPassword: string) {
    // Derive encryption key from master password
    // In production, this should use a stored salt
    const salt = Buffer.from('turingmod-salt-v1'); // Fixed salt for consistency
    this.key = scryptSync(masterPassword, salt, this.keyLength);
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
    const { createHash } = require('node:crypto');
    return createHash('sha256').update(this.key).digest('hex');
  }
}
