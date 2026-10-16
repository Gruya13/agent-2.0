import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, stringifyYaml, parseFrontmatter, stringifyFrontmatter, YamlError } from '../tools/orchestrator/lib/yaml.mjs';

test('parseYaml: skalari, liste, ugnježdena mapiranja', () => {
  const value = parseYaml([
    'title: "Naslov: sa dvotočkom"',
    'count: 42',
    'ratio: 0.5',
    'flag: true',
    'empty: null',
    'tags:',
    '  - ai',
    '  - agenti',
    'meta:',
    '  nested:',
    '    deep: vrednost',
    'list_of_maps:',
    '  - path: a/b.md',
    '    bytes: 12',
    '  - path: c.md',
    'inline: [a, "b c", 3]',
    'inline_map: {x: 1, y: two}',
  ].join('\n'));

  assert.equal(value.title, 'Naslov: sa dvotočkom');
  assert.equal(value.count, 42);
  assert.equal(value.ratio, 0.5);
  assert.equal(value.flag, true);
  assert.equal(value.empty, null);
  assert.deepEqual(value.tags, ['ai', 'agenti']);
  assert.deepEqual(value.meta, { nested: { deep: 'vrednost' } });
  assert.deepEqual(value.list_of_maps, [{ path: 'a/b.md', bytes: 12 }, { path: 'c.md' }]);
  assert.deepEqual(value.inline, ['a', 'b c', 3]);
  assert.deepEqual(value.inline_map, { x: 1, y: 'two' });
});

test('parseYaml: ISO datum ostaje string, ne broj', () => {
  const value = parseYaml('created: 2025-10-13T22:00:00.000Z');
  assert.equal(value.created, '2025-10-13T22:00:00.000Z');
  assert.equal(typeof value.created, 'string');
});

test('parseYaml: blok skalar čuva prelome redova', () => {
  const value = parseYaml(['body: |-', '  prva', '  druga', ''].join('\n'));
  assert.equal(value.body, 'prva\ndruga');
});

test('parseYaml: komentar van navodnika se odbacuje, unutar navodnika ne', () => {
  const value = parseYaml('a: vrednost # komentar\nb: "tekst # nije komentar"');
  assert.equal(value.a, 'vrednost');
  assert.equal(value.b, 'tekst # nije komentar');
});

test('parseYaml: tabulator i višestruki dokument su greške, ne tiho ignorisanje', () => {
  assert.throws(() => parseYaml('a:\n\tb: 1'), YamlError);
  assert.throws(() => parseYaml('a: 1\n---\nb: 2'), YamlError);
});

test('stringifyYaml: round-trip je identitet za realan frontmatter zadatka', () => {
  const value = {
    id: 'TASK-101',
    title: 'Naslov: sa dvotočkom',
    status: 'ready',
    created: '2025-10-13T22:00:00.000Z',
    authors: [],
    tags: ['ai', 'agenti'],
    assignee: null,
    artifacts: ['wiki/drafts/X.md'],
    verification: { verdict: 'pass', by: 'verifier' },
    deprecated: false,
    history: [{ at: '2025-10-13T22:00:00.000Z', status: 'proposed', actor: 'operator' }],
  };
  const text = stringifyYaml(value);
  assert.deepEqual(parseYaml(text), value);
});

test('stringifyYaml: vrednosti koje liče na druge tipove se citiraju', () => {
  const text = stringifyYaml({ a: 'null', b: 'true', c: '007', d: 'x: y', e: '-x' });
  const back = parseYaml(text);
  assert.equal(back.a, 'null');
  assert.equal(back.b, 'true');
  assert.equal(back.c, '007');
  assert.equal(back.d, 'x: y');
  assert.equal(back.e, '-x');
});

test('frontmatter: parsiranje i serijalizacija', () => {
  const text = '---\ntitle: T\nstatus: draft\n---\n\ntelo\n';
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.present, true);
  assert.equal(parsed.data.title, 'T');
  assert.equal(parsed.body, '\ntelo\n');

  const again = parseFrontmatter(stringifyFrontmatter(parsed.data, parsed.body));
  assert.deepEqual(again.data, parsed.data);
  assert.equal(again.body, parsed.body);
});

test('frontmatter: nedostatak nije greška, neispravan YAML jeste', () => {
  const none = parseFrontmatter('samo telo');
  assert.equal(none.present, false);
  assert.equal(none.body, 'samo telo');
  assert.throws(() => parseFrontmatter('---\n  loše: [\n---\ntelo'), YamlError);
});

test('frontmatter: redosled polja je stabilan (bez šuma u diff-u)', () => {
  const order = ['id', 'title', 'status'];
  const text = stringifyFrontmatter({ status: 'ready', title: 'T', id: 'TASK-001', extra: 1 }, '', { order });
  const lines = text.split('\n');
  assert.equal(lines[1], 'id: TASK-001');
  assert.equal(lines[2], 'title: T');
  assert.equal(lines[3], 'status: ready');
  assert.equal(lines[4], 'extra: 1');
});
test('Y1: tekst izveštaja sa neujednačenom indentacijom ostaje validan', () => {
  const summary = ' prva linija uvucena\n    druga jos uvlacenija\n\ntreca bez uvucenja';
  const tekst = stringifyFrontmatter({ title: 'x', verification: { verdict: 'fail', summary } }, '# telo\n');
  const { data } = parseFrontmatter(tekst);
  assert.equal(data.verification.verdict, 'fail');
  assert.equal(data.verification.summary.includes('prva linija uvucena'), true);
  assert.equal(data.verification.summary.includes('treca bez uvucenja'), true);
});

test('Y2: round-trip je idempotentan za višelinijski tekst', () => {
  const summary = '  uvod\n    detalj\n\n  zakljucak';
  const prvi = stringifyFrontmatter({ summary }, 'telo\n');
  const { data } = parseFrontmatter(prvi);
  const drugi = stringifyFrontmatter({ summary: data.summary }, 'telo\n');
  assert.equal(prvi, drugi);
});
test('Y3: vodeće prazne linije u blok skalaru se čuvaju', () => {
  const summary = '\n\nprva linija\n\ndruga linija';
  const tekst = stringifyFrontmatter({ summary }, 'telo\n');
  const { data } = parseFrontmatter(tekst);
  assert.equal(data.summary.startsWith('\n\nprva linija'), true, JSON.stringify(data.summary));
  assert.equal(data.summary.includes('\n\ndruga linija'), true);
});
test('Y4: round-trip čuva završne prazne linije (|, |+, samo prelomi)', () => {
  for (const ulaz of ['a\nb', 'a\nb\n', 'a\nb\n\n', '\n\n', '\nprva\n\ndruga\n\n\n']) {
    const tekst = stringifyFrontmatter({ s: ulaz }, 't\n');
    const { data } = parseFrontmatter(tekst);
    assert.equal(data.s, ulaz, `round-trip za ${JSON.stringify(ulaz)}`);
  }
});

test('Y5: folded > čuva granice pasusa', () => {
  const ulaz = '---\nsummary: >\n\n  prvi red\n  drugi red\n\n  treci pasus\n---\n\ntelo\n';
  const { data } = parseFrontmatter(ulaz);
  assert.match(data.summary, /prvi red drugi red/);
  assert.match(data.summary, /\n/);
  assert.equal(data.summary.includes('prvi red drugi red\ntreci pasus'), true, JSON.stringify(data.summary));
});

test('Y6: prazan string i string samo od preloma', () => {
  const prazan = parseFrontmatter(stringifyFrontmatter({ s: '' }, 't\n')).data.s;
  assert.equal(prazan, '');
  const prelomi = parseFrontmatter(stringifyFrontmatter({ s: '\n\n' }, 't\n')).data.s;
  assert.equal(prelomi, '\n\n');
});
test('Y7: tab u uvlačenju bloka se odbija', () => {
  assert.throws(() => parseYaml('value: |-\n\talpha\nnext: x\n'), YamlError);
  // Običan tab van bloka se takođe odbija.
  assert.throws(() => parseYaml('a:\n\tb: 1\n'), YamlError);
});
