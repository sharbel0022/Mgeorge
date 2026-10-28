const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string): Uint8Array {
  const input = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(input + '='.repeat((4 - input.length % 4) % 4)), c => c.charCodeAt(0));
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function digest(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('BANK_STORAGE_UNAVAILABLE');
  const raw = decode(secret);
  if (raw.length !== 32) throw new Error('BANK_STORAGE_UNAVAILABLE');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

// The authenticated owner and purpose are cryptographically bound to every value.
// Moving a ciphertext into another user's row must not make it readable there.
export async function seal(secret: string, owner: string, purpose: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = encoder.encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv,
    additionalData: encoder.encode(`mg-bank-v1:${owner}:${purpose}`),
  }, await encryptionKey(secret), bytes);
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

export async function unseal<T>(secret: string, owner: string, purpose: string, value: string): Promise<T> {
  try {
    const [version, iv, encrypted, extra] = value.split('.');
    if (version !== 'v1' || !iv || !encrypted || extra) throw new Error('invalid');
    const decodedIv = decode(iv);
    if (decodedIv.length !== 12) throw new Error('invalid');
    const decrypted = await crypto.subtle.decrypt({
      name: 'AES-GCM', iv: decodedIv as BufferSource,
      additionalData: encoder.encode(`mg-bank-v1:${owner}:${purpose}`),
    }, await encryptionKey(secret), decode(encrypted) as BufferSource);
    return JSON.parse(new TextDecoder().decode(decrypted)) as T;
  } catch {
    throw new Error('BANK_SECRET_UNREADABLE');
  }
}

export function validFlowToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function cookieValue(request: Request, name: string): string {
  const parts = (request.headers.get('cookie') ?? '').split(';');
  const matches = parts.map(p => p.trim()).filter(p => p.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : '';
}
