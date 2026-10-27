/**
 * MG FAKTURAKOLL – SÄKERHET / KRYPTERING
 * ANSVAR: Innehåller hjälpmetoder för hashning, säkra token, sessioner och AES-256-GCM-kryptering av integrationsuppgifter.
 * FLÖDE: server.js använder säkerhetsfunktionerna; privata nycklar och token får inte skickas till frontend.
 * LÄS VIDARE: docs/KODGUIDE.md för genomgång av moduler och funktioner.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';

export function digest(value) { return createHash('sha256').update(value).digest('hex'); }
export function token() { return randomBytes(32).toString('base64url'); }
export function secureEqual(a,b) {
  const left=Buffer.from(String(a)); const right=Buffer.from(String(b));
  return left.length===right.length && timingSafeEqual(left,right);
}
export function passwordHash(password, salt=randomBytes(16).toString('hex')) {
  const derived=scryptSync(password,salt,64).toString('hex');
  return `${salt}:${derived}`;
}
export function verifyPassword(password, stored) {
  if(!stored || !stored.includes(':')) return false;
  const [salt,hash]=stored.split(':');
  return secureEqual(scryptSync(password,salt,64).toString('hex'),hash);
}
export function cipherKey() {
  if(process.env.BANK_DATA_KEY&&process.env.ENCRYPTION_KEY&&process.env.BANK_DATA_KEY!==process.env.ENCRYPTION_KEY)throw new Error('Motstridiga krypteringsnycklar');
  const key=process.env.ENCRYPTION_KEY||process.env.BANK_DATA_KEY;
  if(!/^[a-f0-9]{64}$/i.test(key??'')) throw new Error('BANK_DATA_KEY must be 64 hex characters');
  return Buffer.from(key,'hex');
}
/** Krypterar känsliga integrationsuppgifter med AES-256-GCM och ny slumpad IV. */
export function encryptObject(value) {
  const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',cipherKey(),iv);
  const payload=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),payload]).toString('base64');
}
/** Dekrypterar skyddade integrationstoken med serverns privata datanyckel. */
export function decryptObject(value) {
  const bytes=Buffer.from(value,'base64');
  const d=createDecipheriv('aes-256-gcm',cipherKey(),bytes.subarray(0,12));
  d.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([d.update(bytes.subarray(28)),d.final()]).toString('utf8'));
}
export function sign(data, secret=process.env.SESSION_SECRET) {
  return createHmac('sha256',secret).update(data).digest('base64url');
}
/** Skapar HttpOnly-cookie så JavaScript i webbläsaren inte direkt kan läsa sessionsvärdet. */
export function sessionCookie(sessionToken,secure) {
  return `mg_session=${encodeURIComponent(sessionToken)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure?'; Secure':''}`;
}
export function clearCookie(secure) {
  return `mg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure?'; Secure':''}`;
}
