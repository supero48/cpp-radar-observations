# Radar prve pomoči — strežniški shadow acceptance

`bin/first-aid-radar.php` je samo-bralna strežniška ovojnica za že aktivni
WordPress Radar prve pomoči 0.1.0. Ne prepisuje parserja in v shadow različici
ne kliče zbiralnega callbacka. Njena naloga je dokazati, da lahko gostovanje
zanesljivo preverja exact produkcijski owner, podatkovni kontrakt in javni
prikaz brez GitHub Actions.

## Exact meje

- WordPress root je zaklenjen na
  `/home/ocnk11/domains/vozniski-izpit.com/public_html/nova`;
- plugin je zaklenjen na `vzi-prva-pomoc-radar` 0.1.0, 51.054 B in SHA-256
  `9b6456078022adfd09e1f704a422eb437a8ee52ece57b980c6dcd8ce43beb75b`;
- bere le exact tabeli s priponama `vzi_pp_sources` in `vzi_pp_terms` ter
  nastavitev `vzi_pp_radar_settings`;
- primerja aktivne prihodnje termine, neposredni shortcode render in javni
  kanonični prikaz;
- zahteva svež `last_sync`/`last_seen`, nič aktivnih source napak in HTTP 200;
- rezultat, stanje in zadnji PASS zapisuje atomsko z dovoljenji `0600`;
- dve zaporedni stanji HOLD ustvarita en saniran `radar_degraded` dogodek,
  nato pa šele en `radar_recovered` ob obnovitvi;
- rutina ne kontaktira GitHuba in ne porablja Actions minut.

## Uporaba

```bash
php server/vzi-radar-engine/bin/first-aid-radar.php --self-test
php server/vzi-radar-engine/bin/first-aid-radar.php
```

Izhodi so pod
`/home/ocnk11/vzi-radar-state/first-aid-radar/`: `shadow-report.json`,
`shadow-acceptance.json`, `shadow-state.json`, pogojni
`shadow-alert-outbox.json` in samo ob PASS `last-good.json`.

`--trigger-sync` je v tej različici izrecno zavrnjen. PASS je šele dokaz za
naslednji ločeni korak: transakcijsko/rollback-varno strežniško proženje
obstoječega callbacka `VZI_Prva_Pomoc_Radar::sync_all_sources`, sveža ponovna
pariteta in nato reverzibilen preklop razporejevalnika. Do takrat ostane
obstoječi WordPress `vzi_pp_twice_daily` owner nespremenjen.

