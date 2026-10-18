/**
 * Minimalni YAML parser/serializer za potrebe sistema.
 *
 * Namerno bez eksternih zavisnosti: repozitorijum mora da radi i offline, a
 * frontmatter zadataka i belešaka je strogo kontrolisan podskup YAML-a.
 *
 * Podržano:
 *   - mapiranja po indentaciji (2 razmaka), ugnježdena proizvoljno duboko
 *   - liste (`- stavka`), uključujući listu mapiranja (`- kljuc: vrednost`)
 *   - skalari: string (navodnici " i '), broj, boolean, null/~
 *   - inline kolekcije: [a, b], {a: 1, b: 2}
 *   - blok skalari: |, |-, |+, >, >-, >+
 *   - komentari (#) van navodnika
 *
 * Nije podržano (i namerno se odbija, ne ignoriše tiho): anchori/alias-i,
 * tagovi (!), više dokumenata (---), eksplicitni map ključevi (?), merge keys.
 */

const NULL_TOKENS = new Set(['null', '~', 'Null', 'NULL']);
const TRUE_TOKENS = new Set(['true', 'True', 'TRUE']);
const FALSE_TOKENS = new Set(['false', 'False', 'FALSE']);

export class YamlError extends Error {
  constructor(message, line) {
    super(line === undefined ? message : `${message} (linija ${line})`);
    this.name = 'YamlError';
    this.line = line;
  }
}

// ------------------------------------------------------------------ parsing

function stripComment(text) {
  if (text.startsWith('"') || text.startsWith("'")) return text;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '#' && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        current += text[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '[' || ch === '{') depth += 1;
    if (ch === ']' || ch === '}') depth -= 1;
    if (ch === separator && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  parts.push(current);
  return parts;
}

function unquote(text) {
  const t = text.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\(["\\/nrtbf])/g, (_, c) => ({
      '"': '"', '\\': '\\', '/': '/', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f',
    })[c]);
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

export function parseScalar(raw, line) {
  const text = stripComment(String(raw)).trim();
  if (text === '') return null;
  if (text.startsWith('"') || text.startsWith("'")) {
    const quote = text[0];
    if (text.length < 2 || !text.endsWith(quote)) throw new YamlError(`nezatvoren navodnik: ${text}`, line);
    return unquote(text);
  }
  // Nezatvorene flow kolekcije su greška, ne string: YAML ih takođe odbija.
  if (text.startsWith('[') && !text.endsWith(']')) throw new YamlError(`nezatvorena inline lista: ${text}`, line);
  if (text.startsWith('{') && !text.endsWith('}')) throw new YamlError(`nezatvoreno inline mapiranje: ${text}`, line);
  if (NULL_TOKENS.has(text)) return null;
  if (TRUE_TOKENS.has(text)) return true;
  if (FALSE_TOKENS.has(text)) return false;
  if (text.startsWith('[') && text.endsWith(']')) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return [];
    return splitTopLevel(inner, ',').map((part) => parseScalar(part, line));
  }
  if (text.startsWith('{') && text.endsWith('}')) {
    const inner = text.slice(1, -1).trim();
    if (inner === '') return {};
    const out = {};
    for (const part of splitTopLevel(inner, ',')) {
      const idx = keyEnd(part);
      if (idx < 0) throw new YamlError(`neispravan inline map: ${part}`, line);
      out[unquote(part.slice(0, idx))] = parseScalar(part.slice(idx + 1), line);
    }
    return out;
  }
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  if (/^-?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/.test(text) && /[.eE]/.test(text)) {
    return Number.parseFloat(text);
  }
  return text;
}

/** Indeks dvotočke koja razdvaja ključ od vrednosti, ili -1. */
function keyEnd(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ':') {
      const next = text[i + 1];
      if (next === undefined || next === ' ' || next === '\t') return i;
    }
  }
  return -1;
}

function isListItem(text) {
  return text === '-' || text.startsWith('- ');
}

function tokenize(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  // Indentacija blok skalara u toku (npr. `summary: |-`). Prazne linije unutar
  // bloka se NE preskaču — inače parser tiho gubi prazne redove iz izveštaja.
  let blokIndent = null;
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const indentRaw = raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
    if (blokIndent !== null) {
      // Tabulator u uvlačenju bloka je YAML greška; bez ove provere se tiho
      // odsecao deo sadržaja (npr. "\talpha" -> "lpha").
      if (/^\s*\t/.test(raw) || / \t/.test(raw.match(/^[ \t]*/)[0])) {
        throw new YamlError('tabulator u YAML-u nije dozvoljen', i + 1);
      }
      if (raw.trim() !== '' && indentRaw < blokIndent) {
        blokIndent = null;
      } else {
        out.push({ indent: indentRaw, text: raw.trim(), raw, line: i + 1, prazna: raw.trim() === '' });
        continue;
      }
    }
    if (raw.trim() === '') continue;
    if (/^\s*#/.test(raw)) continue;
    if (/^\s*\.\.\.\s*$/.test(raw)) break;
    if (/^\s*---\s*$/.test(raw) && out.length > 0) {
      throw new YamlError('više dokumenata u jednom YAML toku nije podržano', i + 1);
    }
    const indent = raw.match(/^\s*/)[0].replace(/\t/g, '  ').length;
    if (/\t/.test(raw)) throw new YamlError('tabulator u YAML-u nije dozvoljen', i + 1);
    out.push({ indent, text: raw.trim(), raw, line: i + 1 });
    if (/[|>][-+]?\s*$/.test(raw.trim())) blokIndent = raw.trim().startsWith('- ') ? indent + 1 : indent + 1;
  }
  return out;
}

function parseBlockScalar(lines, index, indent, style) {
  const collected = [];
  let i = index;
  let blockIndent = null;
  while (i < lines.length) {
    const entry = lines[i];
    // Prazna linija pripada bloku, uključujući vodeće (indikator bloka je već
    // viđen), pa se čuva kao prazan red.
    if (entry.prazna) {
      collected.push('');
      i += 1;
      continue;
    }
    if (entry.indent <= indent && !(blockIndent !== null && entry.indent >= blockIndent)) break;
    if (blockIndent === null) blockIndent = entry.indent;
    if (entry.indent < blockIndent) break;
    collected.push(entry.raw === undefined ? entry.text : entry.raw.slice(blockIndent));
    i += 1;
  }
  if (blockIndent === null) blockIndent = indent + 2;
  // Završne prazne linije se izdvajaju: chomp pravila ih tretiraju posebno, pa
  // se bez ovoga dodavao višak preloma (nalaz nezavisne provere).
  let trailing = 0;
  while (collected.length && collected[collected.length - 1] === '') {
    collected.pop();
    trailing += 1;
  }
  const folded = style.startsWith('>');
  // Folded blok sa uvlačenjem (linija dublja od prve) ne čitamo verno: viša
  // indentacija menja značenje (zadržava prelome), a naša aproksimacija bi je
  // tiho pretvorila u razmake. Bolje je odbiti ulaz nego izmeniti sadržaj.
  if (folded && collected.some((lin) => lin !== '' && /^[ \t]/.test(lin))) {
    throw new YamlError('folded blok (">") sa uvlacenjem nije podrzan; koristi "|-" ili "|"');
  }
  let value;
  if (folded) {
    // Fold: susedne neprazne linije se spajaju razmakom, a prazna linija je
    // granica pasusa (prelom) — `join(' ')` je brisao granice pasusa.
    value = '';
    for (const lin of collected) {
      if (lin === '') { value += '\n'; continue; }
      value += value === '' || value.endsWith('\n') ? lin : ` ${lin}`;
    }
  } else {
    value = collected.join('\n');
  }
  const chomp = style.slice(1);
  if (chomp === '-') value = value.replace(/\n+$/, '');
  // Keep (|+): prazne linije su već prelomi; finalni prelom se dodaje samo ako
  // postoji bar jedna neprazna linija (inače bi se prelom duplirao).
  else if (chomp === '+') value = value === '' ? '\n'.repeat(trailing) : value + '\n'.repeat(trailing + 1);
  // Clip (|) daje tačno jedan završni prelom.
  else value = collected.length || trailing ? `${value}\n` : value;
  return [value, i];
}

function parseMap(lines, index, indent, seed) {
  const obj = {};
  let i = index;

  const assign = (key, pairIndex, pairIndent) => {
    const entry = lines[pairIndex];
    const raw = entry.text.slice(keyEnd(entry.text) + 1).trim();
    if (raw === '') {
      const next = lines[pairIndex + 1];
      if (next && (next.indent > pairIndent || isListItem(next.text))) {
        const childIndent = isListItem(next.text) ? next.indent : next.indent;
        if (next.indent <= pairIndent && !isListItem(next.text)) return pairIndex + 1;
        const [value, after] = parseNode(lines, pairIndex + 1, childIndent, { skipIndentCheck: next.indent <= pairIndent });
        obj[key] = value;
        return after;
      }
      obj[key] = null;
      return pairIndex + 1;
    }
    if (/^[|>][-+]?\d?$/.test(raw)) {
      const [value, after] = parseBlockScalar(lines, pairIndex + 1, pairIndent, raw);
      obj[key] = value;
      return after;
    }
    obj[key] = parseScalar(raw, entry.line);
    return pairIndex + 1;
  };

  if (seed !== undefined) {
    const idx = keyEnd(seed);
    if (idx < 0) throw new YamlError(`neispravan unos u mapiranju: ${seed}`);
    obj[unquote(seed.slice(0, idx))] = parseScalar(seed.slice(idx + 1));
  }

  while (i < lines.length) {
    const entry = lines[i];
    if (entry.indent < indent) break;
    if (entry.indent > indent) throw new YamlError(`neočekivana indentacija: ${entry.text}`, entry.line);
    if (isListItem(entry.text)) break;
    const idx = keyEnd(entry.text);
    if (idx < 0) throw new YamlError(`očekivan "ključ: vrednost", dobijeno: ${entry.text}`, entry.line);
    const key = unquote(entry.text.slice(0, idx));
    i = assign(key, i, indent);
  }
  return [obj, i];
}

function parseList(lines, index, indent) {
  const arr = [];
  let i = index;
  while (i < lines.length) {
    const entry = lines[i];
    if (entry.indent !== indent || !isListItem(entry.text)) break;
    const content = entry.text === '-' ? '' : entry.text.slice(2).trim();
    if (content === '') {
      const next = lines[i + 1];
      if (next && (next.indent > indent || isListItem(next.text))) {
        const [value, after] = parseNode(lines, i + 1, next.indent <= indent ? indent + 2 : next.indent, { skipIndentCheck: next.indent <= indent });
        arr.push(value);
        i = after;
      } else {
        arr.push(null);
        i += 1;
      }
      continue;
    }
    const idx = keyEnd(content);
    if (idx >= 0) {
      const [value, after] = parseMap(lines, i + 1, indent + 2, content);
      arr.push(value);
      i = after;
      continue;
    }
    arr.push(parseScalar(content, entry.line));
    i += 1;
  }
  return [arr, i];
}

function parseNode(lines, index, indent, options = {}) {
  if (index >= lines.length) return [null, index];
  const entry = lines[index];
  if (!options.skipIndentCheck && entry.indent !== indent) {
    throw new YamlError(`očekivana indentacija ${indent}, dobijeno ${entry.indent}`, entry.line);
  }
  if (isListItem(entry.text)) return parseList(lines, index, entry.indent);
  return parseMap(lines, index, entry.indent);
}

export function parseYaml(text) {
  if (typeof text !== 'string') throw new TypeError('parseYaml očekuje string');
  const lines = tokenize(text);
  if (!lines.length) return null;
  const [value, index] = parseNode(lines, 0, lines[0].indent);
  if (index !== lines.length) {
    throw new YamlError(`nekorišćen sadržaj posle kraja dokumenta: ${lines[index].text}`, lines[index].line);
  }
  return value;
}

// -------------------------------------------------------------- serializing

const SPECIAL_FIRST = new Set(['-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', "'", '"', '%', '@', '`', ' ']);

function looksNumeric(text) {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text);
}

function needsQuote(text) {
  if (text === '') return true;
  if (SPECIAL_FIRST.has(text[0])) return true;
  if (/\s$/.test(text) || /^\s/.test(text)) return true;
  if (/[\n\t]/.test(text)) return true;
  if (text.includes(': ') || text.endsWith(':')) return true;
  if (/\s#/.test(text) || text.startsWith('#')) return true;
  if (looksNumeric(text)) return true;
  if (NULL_TOKENS.has(text) || TRUE_TOKENS.has(text) || FALSE_TOKENS.has(text)) return true;
  if (/^(yes|no|on|off|Yes|No|On|Off|YES|NO|ON|OFF)$/.test(text)) return true;
  return false;
}

function quoteScalar(text) {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
}

function scalarInline(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new YamlError(`ne mogu da serijalizujem broj ${value}`);
    return String(value);
  }
  const text = String(value);
  if (text.includes('\n')) throw new YamlError('višelinijski string mora kroz dumpEntry (blok skalar)');
  return needsQuote(text) ? quoteScalar(text) : text;
}

function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function dumpKey(key) {
  return /^[A-Za-z0-9_.-]+$/.test(key) ? key : quoteScalar(String(key));
}

/** Serijalizuj vrednost kao blok linija sa datom indentacijom. */
function dumpValue(value, indent, out) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const keys = Object.keys(item);
        if (!keys.length) { out.push(`${pad}- {}`); continue; }
        const [first, ...rest] = keys;
        const firstValue = item[first];
        if (typeof firstValue === 'object' && firstValue !== null && !isEmpty(firstValue)) {
          out.push(`${pad}- ${dumpKey(first)}:`);
          dumpValue(firstValue, indent + 4, out);
        } else if (typeof firstValue === 'string' && firstValue.includes('\n')) {
          out.push(`${pad}- ${dumpKey(first)}: |-`);
          dumpBlockText(firstValue, indent + 4, out);
        } else {
          out.push(`${pad}- ${dumpKey(first)}: ${isEmpty(firstValue) ? (Array.isArray(firstValue) ? '[]' : firstValue === null ? 'null' : '{}') : scalarInline(firstValue)}`);
        }
        for (const key of rest) {
          dumpEntry(key, item[key], indent + 2, out);
        }
      } else if (Array.isArray(item)) {
        if (!item.length) { out.push(`${pad}- []`); continue; }
        out.push(`${pad}-`);
        dumpValue(item, indent + 2, out);
      } else if (typeof item === 'string' && item.includes('\n')) {
        out.push(`${pad}- |-`);
        dumpBlockText(item, indent + 2, out);
      } else {
        out.push(`${pad}- ${scalarInline(item)}`);
      }
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) dumpEntry(key, value[key], indent, out);
    return;
  }
  throw new YamlError('dumpValue očekuje kolekciju');
}

function dumpBlockText(text, indent, out) {
  const pad = ' '.repeat(indent);
  // Uvek se skida TAČNO jedan završni prelom; stil (|-, |, |+) određuje koliko
  // ih parser vrati, pa round-trip čuva i završne prazne linije.
  const cleaned = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = cleaned.split('\n');
  // Vodeća indentacija se normalizuje na prvu liniju: ako bi prva linija imala
  // veći uvlačenje od ostalih, YAML bi prijavio "neočekivana indentacija" i ceo
  // frontmatter bi postao nečitljiv (dokazano na tekstu izveštaja verifikatora).
  const base = /^[ \t]*/.exec(lines[0])?.[0] ?? '';
  for (const line of lines) {
    if (line.trim() === '') { out.push(''); continue; }
    const ostatak = line.startsWith(base) ? line.slice(base.length) : line.trimStart();
    out.push(`${pad}${ostatak}`);
  }
}

function dumpEntry(key, value, indent, out) {
  const pad = ' '.repeat(indent);
  if (typeof value === 'string' && value.includes('\n')) {
    // Stil se bira prema broju završnih preloma da parse vrati isti string:
    // 0 -> |- (strip), 1 -> | (clip), 2+ -> |+ (keep).
    const zavrsnih = /(\n+)$/.exec(value)?.[1].length ?? 0;
    const stil = zavrsnih === 0 ? '|-' : zavrsnih === 1 ? '|' : '|+';
    out.push(`${pad}${dumpKey(key)}: ${stil}`);
    dumpBlockText(value, indent + 2, out);
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) { out.push(`${pad}${dumpKey(key)}: []`); return; }
    out.push(`${pad}${dumpKey(key)}:`);
    dumpValue(value, indent + 2, out);
    return;
  }
  if (value !== null && value !== undefined && typeof value === 'object') {
    if (!Object.keys(value).length) { out.push(`${pad}${dumpKey(key)}: {}`); return; }
    out.push(`${pad}${dumpKey(key)}:`);
    dumpValue(value, indent + 2, out);
    return;
  }
  out.push(`${pad}${dumpKey(key)}: ${scalarInline(value)}`);
}

/**
 * Serijalizuj objekat u YAML. Ako je `order` dat, ključevi iz njega idu prvi
 * (stabilan diff zadataka), a ostali zadržavaju redosled unošenja.
 */
export function stringifyYaml(value, options = {}) {
  const { order } = options;
  if (value === null || value === undefined) return 'null\n';
  if (Array.isArray(value)) {
    const out = [];
    dumpValue(value, 0, out);
    return `${out.join('\n')}\n`;
  }
  if (typeof value !== 'object') return `${scalarInline(value)}\n`;
  const ordered = {};
  if (order) {
    for (const key of order) if (key in value) ordered[key] = value[key];
  }
  for (const key of Object.keys(value)) if (!(key in ordered)) ordered[key] = value[key];
  const out = [];
  for (const key of Object.keys(ordered)) dumpEntry(key, ordered[key], 0, out);
  return out.length ? `${out.join('\n')}\n` : '';
}

// -------------------------------------------------------------- frontmatter

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function hasFrontmatter(text) {
  return FRONTMATTER_RE.test(text);
}

/** Vrati { data, body, present } — nikad ne baca za nedostajući frontmatter. */
export function parseFrontmatter(text) {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { data: null, body: text, present: false };
  let data;
  try {
    data = parseYaml(match[1]);
  } catch (error) {
    throw new YamlError(`neispravan frontmatter: ${error.message}`);
  }
  if (data !== null && (typeof data !== 'object' || Array.isArray(data))) {
    throw new YamlError('frontmatter mora biti mapiranje');
  }
  return { data: data ?? {}, body: text.slice(match[0].length), present: true };
}

/**
 * Serijalizuj frontmatter + telo u kanonskom obliku: tačno jedan prazan red
 * između zaglavlja i tela. Kanonizacija čini `parse(format(x))` idempotentnim,
 * pa diff-ovi zadataka i belešaka ne sadrže prazan šum.
 */
export function stringifyFrontmatter(data, body, options = {}) {
  const yaml = stringifyYaml(data, options);
  const normalized = body === '' ? '' : `\n${body.replace(/^\n+/, '')}`;
  return `---\n${yaml}---\n${normalized}`;
}
