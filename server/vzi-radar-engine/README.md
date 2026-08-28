# VZI Radar Engine — strežniški shadow pilot

Ta pilot premakne poceni, statični zajem javnih virov iz GitHub Actions na
gostovanje Hitrost.com. Ne piše v WordPress, ne objavlja manifesta in ne
potrebuje skrivnosti. GitHub ostaja vir kode, pregledov in izdaj.

## Varnostne meje

- dovoljen je samo HTTPS do vnaprej potrjenih gostiteljev iz registra;
- zasebni in rezervirani IP-naslovi so zavrnjeni pred vsakim zahtevkom;
- preusmeritve se preverijo posamično in ostanejo znotraj allowlista;
- pregledane preusmeritvene poddomene so ločeno zapisane v
  `config/redirect-hosts.json` in morajo ostati znotraj iste osnovne domene;
- `robots.txt` se preveri pred virom;
- največ 5 MB HTML-ja, omejeni timeouti, rotacijski paket in procesna ključavnica;
- shranijo se samo hash, kratki kandidati in status, ne celoten HTML;
- izhod se zapiše atomsko z dovoljenji `0600`;
- zdravstveno stanje virov se vodi ločeno; prvi trdi izpad je tih, obvestilo
  nastane šele po dveh zaporednih napakah, nato še enkrat ob obnovitvi;
- rezultat `review` ne sproža opozorila, ker ostane v obstoječem GitHub/browser
  fallbacku;
- omejeni outbox hrani največ 100 saniranih dogodkov brez URL-jev, HTML-ja,
  osebnih podatkov ali skrivnosti;
- način je vedno `shadow`: brez produkcijskih WordPress zapisov.

## Lokalni preizkus

```bash
php server/vzi-radar-engine/bin/shadow-harvest.php --self-test
VZI_RADAR_MAX_SOURCES=2 php server/vzi-radar-engine/bin/shadow-harvest.php
```

Privzeti rezultat je `server/vzi-radar-engine/var/shadow-report.json`. Mesto,
velikost paketa in rotacijo je mogoče določiti z `VZI_RADAR_SHADOW_OUTPUT`,
`VZI_RADAR_MAX_SOURCES` in `VZI_RADAR_ROTATION_SLOT`.

Stanje in sanirani outbox se privzeto zapišeta ob poročilo kot
`shadow-state.json` in `shadow-alert-outbox.json`. Poti je mogoče preusmeriti z
`VZI_RADAR_STATE_OUTPUT` in `VZI_RADAR_EVENT_OUTBOX`. Outbox nastane šele ob
dejanskem prehodu v ponovljeno napako ali ob obnovitvi.

## Prehod v produkcijo

Shadow pilot mora najprej zbrati primerljive rezultate brez vpliva na javno
stran. Šele nato sledi ločen podpisni ključ strežnika, podpisan manifest,
WordPress trust gate in povratni kanal napak v GitHub. Browser/JavaScript viri
ostanejo na omejenem GitHub fallbacku, dokler strežniško okolje ne zagotovi
enakovrednega renderiranja.
