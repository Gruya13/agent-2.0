/**
 * Vremenski zakup (lease) je jedini mehanizam međusobnog isključivanja nad
 * zadatkom. Bez njega dva harnesa mogu istovremeno da pišu istu belešku i
 * pregaze tuđi rad.
 *
 * Ovaj modul je čist: nema I/O, vreme se ubacuje, pa je ponašanje na isteku
 * deterministički testabilno.
 */

export const LEASE_FIELDS = ['lock_owner', 'locked_at', 'lease_expires_at', 'lock_token'];

export function isLeaseLive(data, now = new Date()) {
  if (!data?.lock_owner) return false;
  const expires = Date.parse(data.lease_expires_at ?? '');
  if (!Number.isFinite(expires)) return false;
  return expires > now.getTime();
}

export function leaseExpired(data, now = new Date()) {
  return Boolean(data?.lock_owner) && !isLeaseLive(data, now);
}

export function leaseInfo(data, now = new Date()) {
  if (!data?.lock_owner) return { held: false, live: false, owner: null, expiresAt: null, remainingMs: 0 };
  const expires = Date.parse(data.lease_expires_at ?? '');
  const remainingMs = Number.isFinite(expires) ? expires - now.getTime() : 0;
  return {
    held: true,
    live: remainingMs > 0,
    owner: data.lock_owner,
    lockedAt: data.locked_at ?? null,
    expiresAt: data.lease_expires_at ?? null,
    remainingMs,
  };
}

/**
 * Može li ovaj PROCES da preuzme zadatak?
 *
 * Ime vendora nije dovoljno: dva procesa istog harnesa (`agy`) imaju isto ime,
 * pa bi oba držala „isti" zakup. Zato zakup nosi i **token** koji izdaje proces
 * koji ga je uzeo — tuđi živ zakup se ne preuzima ni pod istim imenom.
 */
export function canTakeOver(data, owner, now = new Date(), token = null) {
  if (!data?.lock_owner) return true;
  if (leaseExpired(data, now)) return true;
  if (data.lock_owner === owner && data.lock_token && token && data.lock_token === token) return true;
  return false;
}

/** Da li ovaj proces drži zakup (ime + token), i to važeći? */
export function holdsLease(data, owner, token, now = new Date()) {
  if (!data?.lock_owner || data.lock_owner !== owner) return false;
  if (!isLeaseLive(data, now)) return false;
  if (data.lock_token && data.lock_token !== token) return false;
  return true;
}

export function newLease(owner, ttlMs, now = new Date(), token = null) {
  if (!owner) throw new Error('vlasnik zakupa je obavezan');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttl zakupa mora biti pozitivan broj');
  return {
    lock_owner: owner,
    locked_at: now.toISOString(),
    lease_expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    lock_token: token,
  };
}

export function clearLease() {
  return { lock_owner: null, locked_at: null, lease_expires_at: null, lock_token: null };
}
