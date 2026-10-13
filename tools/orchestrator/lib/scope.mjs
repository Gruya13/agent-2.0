/**
 * Opseg revizije (audit scope).
 *
 * Revizorska uloga (`librarian`) sme da menja **postojeće** produkcione beleške,
 * ali samo one koje su joj zadatkom eksplicitno stavljene u opseg. Bez toga bi
 * „održavanje baze" bilo blanko ovlašćenje za pisanje po celom `wiki/`.
 *
 * Podržani obrasci:
 *   `wiki/Index.md`      tačan put
 *   `wiki/*.md`          jedan nivo
 *   `wiki/**\/*.md`      proizvoljna dubina
 *   `wiki/**`            sve ispod
 */
import path from 'node:path';

export function normalizeRel(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

/** Pretvori glob u regularni izraz; `*` ne prelazi `/`, `**` prelazi. */
export function globToRegExp(glob) {
  const clean = normalizeRel(glob);
  let out = '';
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (ch === '*') {
      if (clean[i + 1] === '*') {
        out += '[\\s\\S]*';
        i += 1;
        if (clean[i + 1] === '/') i += 1; // `**/` ne mora da matira ništa
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (ch === '?') { out += '[^/]'; continue; }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Da li relativna putanja ulazi u zadati opseg? */
export function matchesScope(relative, scopes) {
  if (!Array.isArray(scopes) || scopes.length === 0) return false;
  const rel = normalizeRel(relative);
  return scopes.some((scope) => globToRegExp(scope).test(rel));
}

/** Provera na nivou kontrolnog sloja: baci ako putanja izlazi iz opsega. */
export function assertInScope(relative, scopes, label = 'putanja') {
  if (!matchesScope(relative, scopes)) {
    throw new Error(`${label} "${normalizeRel(relative)}" ne ulazi u opseg revizije (${(scopes ?? []).join(', ') || 'prazan opseg'})`);
  }
  return true;
}

/** Skrati listu na putanje unutar opsega (za izveštaje i artefakte). */
export function filterScope(paths, scopes) {
  return paths.map(normalizeRel).filter((rel) => matchesScope(rel, scopes));
}

export function scopeFromPaths(paths) {
  return paths.map((p) => normalizeRel(path.join(path.dirname(normalizeRel(p)), path.basename(normalizeRel(p)))));
}
