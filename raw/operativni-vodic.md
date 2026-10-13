# Operativni vodič asinhronog sistema

Sistem radi tako što svaki agent piše isključivo u svoju zonu: istraživač u
wiki/drafts/, verifikator u tasks/reviews/, a konsolidator u wiki/. Nijedan
agent ne piše u raw/, jer su izvori nepromenljivi i čuvaju se sa otiskom bajtova.

Pre nego što agent dira bazu, mora da drži vremenski zakup nad zadatkom. Zakup
sadrži vlasnika, vreme zaključavanja i vreme isteka. Ako agent pukne usred posla,
zakup istekne i kontrolni sloj vrati zadatak u opticaj zajedno sa radnim stablom.

Fizička izolacija se postiže git worktree mehanizmom: svaka uloga dobija
sopstveni direktorijum i sopstvenu granu, pa izmene jednog agenta ne mogu da
pokvare radni direktorijum drugog. U main se ulazi isključivo sekvencijalnim
spajanjem koje izvodi kontrolni sloj, i to posle rebase-a na aktuelno stanje.

Verifikaciju radi drugi model, ne autor nacrta. Verdikt je mašinski čitljiv:
pass ili fail. Odbijen nacrt se vraća istraživaču sa nalazima, a posle
dozvoljenog broja pokušaja zadatak se blokira i traži ljudsku intervenciju.

Indeks znanja je izveden artefakt. Generiše ga kontrolni sloj iz stvarnog stanja
skladišta posle svakog spajanja, pa nijedna grana ne nosi indeks i nema
konflikata tipa dodato na obe strane.

MCP server izlaže pretragu, čitanje zaglavlja, atomsku izmenu odeljka i
backlinkove. Upis kroz MCP zahteva zadatak pod zakupom, a za produkciju i
verifikacioni pečat.
