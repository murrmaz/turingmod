import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Encryption } from './Encryption.js';

function makeEncryption(): Encryption {
  return new Encryption('test-master-password', randomBytes(32));
}

describe('Encryption', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const encryption = makeEncryption();
    const ciphertext = encryption.encrypt('super-secret-token');

    expect(ciphertext).not.toBe('super-secret-token');
    expect(encryption.decrypt(ciphertext)).toBe('super-secret-token');
  });

  it('round-trips objects through encryptObject/decryptObject', () => {
    const encryption = makeEncryption();
    const original = { accessToken: 'abc', expiresAt: 12345 };

    const ciphertext = encryption.encryptObject(original);
    expect(encryption.decryptObject(ciphertext)).toEqual(original);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const encryption = makeEncryption();
    const a = encryption.encrypt('same-input');
    const b = encryption.encrypt('same-input');

    expect(a).not.toBe(b);
  });

  it('fails to decrypt with the wrong key', () => {
    const encryption = makeEncryption();
    const ciphertext = encryption.encrypt('super-secret-token');

    const wrongEncryption = makeEncryption();
    expect(() => wrongEncryption.decrypt(ciphertext)).toThrow();
  });

  it('rejects tampered ciphertext (GCM auth tag)', () => {
    const encryption = makeEncryption();
    const ciphertext = encryption.encrypt('super-secret-token');

    const buffer = Buffer.from(ciphertext, 'base64');
    const lastByte = buffer.at(-1) ?? 0;
    buffer[buffer.length - 1] = lastByte ^ 0xff;
    const tampered = buffer.toString('base64');

    expect(() => encryption.decrypt(tampered)).toThrow();
  });

  it('derives the same key for the same password+salt, a different key otherwise', () => {
    const salt = randomBytes(32);
    const a = new Encryption('password', salt);
    const b = new Encryption('password', salt);
    const c = new Encryption('different-password', salt);

    expect(a.getKeyHash()).toBe(b.getKeyHash());
    expect(a.getKeyHash()).not.toBe(c.getKeyHash());
  });
});
