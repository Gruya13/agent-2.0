# Šest uloga i dve kapije

Sistem ima šest uloga. Četiri pišu, jedna održava, jedna napada. Nijedna uloga
ne piše u tuđu zonu, i to ne čuva samo pristojnost nego dokazivost: ako svaka
izmena ima tačno jednog autora, onda se za svaku tvrdnju zna kome se vraća.

Istraživač pretvara izvor u nacrt i svaku tvrdnju vezuje za mesto u izvoru.
Ekstraktor radi isto, ali bez tumačenja: on samo prenosi ono što u dokumentu
stvarno piše, uključujući tabele i skenove, i uz svaki fragment ostavlja heš
bajtova izvora da se poreklo može proveriti.

Verifikator je drugi vendor i drugi pogled. On ne pita da li je nacrt lep, nego
da li je tačan, i svaki nalaz mora da nosi dokaz. Ako nalaz nema dokaz, to nije
nalaz nego mišljenje.

Red-team dolazi posle pečata i pre spajanja. Njegov nalaz nije tekst nego
skript koji se može pokrenuti. Kontrolni sloj uzme taj skript i pokrene ga u
svežem klonu zamrznute revizije. Ako se tvrdnja tamo obori, spajanje se
zaustavlja. Ako se ne obori, to je lažni nalaz i on se broji, ali ne blokira.

Konsolidator premešta verifikovan nacrt u produkciju. Bibliotekar održava ono
što je već u produkciji: duplikate, siročiće, oznake i pokvarene veze, i to samo
u opsegu koji mu je zadatkom dat.

Prva kapija je zona na spajanju: grana sme da menja samo zone znanja. Druga je
red-team: bez čistog nalaza nema spajanja. Obe kapije postoje zato što se agent
može pokvariti tiho, a ne glasno.
