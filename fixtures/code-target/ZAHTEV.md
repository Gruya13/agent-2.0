# Zamrznut zahtev (pre izvršavanja, bez gotovog rešenja)

Funkcija `parseRange` u `src/range.js` mora da prihvati **nulu** kao granicu:

- `parseRange('0-3')` → `{ from: 0, to: 3 }`
- `parseRange('0')` → `{ from: 0, to: 0 }`

Trenutno se nula gubi. Neispravan ili prazan ulaz se i dalje odbija (vraća
`null`), kao i do sada.

Zahtev opisuje **ponašanje**, ne rešenje. Regresioni test treba da dokaže da je
nula validna granica; postojeći testovi moraju ostati netaknuti i da prolaze.

Okruženje: Node, bez dodatnih zavisnosti. Provera: `npm test`.
Reprodukcija: kratka komanda koja pada dok je bug prisutan (vidi `REPRO` u
zadatku).
