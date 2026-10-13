/**
 * Vremenski zakup (lease) je jedini mehanizam međusobnog isključivanja nad
 * zadatkom. Bez njega dva harnesa mogu istovremeno da pišu istu belešku i
 * pregaze tuđi rad.
 *
 * Ovaj modul je čist: nema I/O, vreme se ubacuje, pa je ponašanje na isteku
 * deterministički testabilno.
 */

export const LEASE_FIELDS = ['lock_owner', 'locked_at', 'lease_expires_at'];

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
 * Može li `owner` da preuzme zadatak koji trenutno drži neko drugi?
 * Da, ali samo ako je zakup istekao. Živ zakup se nikad ne otima.
 */
export function canTakeOver(data, owner, now = new Date()) {
  if (!data?.lock_owner) return true;
  if (data.lock_owner === owner) return true;
  return leaseExpired(data, now);
}

export function newLease(owner, ttlMs, now = new Date()) {
  if (!owner) throw new Error('vlasnik zakupa je obavezan');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('ttl zakupa mora biti pozitivan broj');
  return {
    lock_owner: owner,
    locked_at: now.toISOString(),
    lease_expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

export function clearLease() {
  return { lock_owner: null, locked_at: null, lease_expires_at: null };
}
