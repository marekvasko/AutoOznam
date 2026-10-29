# AutoOznam

Slovenská aplikácia na farské oznamy: React, TypeScript, Express 5, SQLite a OpenRouter. Produkcia: https://autooznam.spis-ai.com. Vyžaduje Node.js 24+.

## Použitie

1. Napíš oznam, meno a kontakt.
2. Vyber zverejnenie **túto nedeľu**, **budúcu nedeľu**, alebo obe.
3. Klikni na **Odošli oznam**. Obsah aj kontakt sa uložia ešte pred AI kontrolou.
4. Kontrola zobrazí čo/kde/kedy, extrahovaný nadpis, miesto a termín. Pri viac než 3 vetách alebo 80 slovách navrhne skrátenie. **Dlhý príklad** umožňuje funkciu vyskúšať.
5. Cez **Dátum udalosti** môžeš ručne opraviť dátum a čas. **Ulož zmeny** aktualizuje rovnaký záznam a pridá verziu do histórie.

Nedeľa zverejnenia a dátum udalosti sú samostatné údaje. Relatívne výrazy ako „zajtra“ alebo „v utorok“ sa vyhodnocujú od prvej vybratej nedele. Napríklad pri zverejnení 1. novembra 2026 znamená „zajtra“ 2. novembra. Ak vyberieš obe nedele, zostáva jeden oznam s jedným termínom udalosti, ktorý sa objaví v oboch vydaniach; relatívny text sa pri druhom vydaní neposúva.

Ručne zadaný termín má prednosť pred AI a zostáva zachovaný aj pri ďalších úpravách textu. **Použi termín z textu** zruší ručné nastavenie po uložení. Oznam zostáva uložený aj pri chýbajúcich údajoch alebo výpadku AI. Odoslanie znamená uloženie na spracovanie, nie automatické zverejnenie mimo tejto aplikácie ani odoslanie e-mailu.

## Prehľad a export

Na https://autooznam.spis-ai.com/prehlad alebo cez **Prehľad oznamov** vyber nedeľu a klikni na **Zobraz prehľad**. Dostaneš:

- Oznamy označené na zverejnenie vo vybranú nedeľu.
- Udalosti nasledujúceho týždňa, od pondelka do nasledujúcej nedele vrátane.
- Všetky neskoršie udalosti, aj ak boli oznámené skôr.
- Oznamy bez presného dátumu, aby sa nestratili napríklad opakované udalosti.

Termíny udalostí v prehľade vychádzajú z aktuálnej verzie a rešpektujú ručné opravy. Udalosti mimo vybraného týždňa v minulosti sa do kalendára týždňa ani budúcich udalostí nedostanú. Oznam výslovne označený na danú nedeľu zostáva v sekcii na zverejnenie bez ohľadu na jeho termín. Neúplné oznamy a neúspešné kontroly sú označené.

**Stiahni TXT** vytvorí text pripravený na čítanie, **Stiahni JSON** štruktúrované dáta, **Vytlač / PDF** otvorí tlač prehliadača. Kontakty nie sú súčasťou týždenného exportu. Prehľad sa vytvára na požiadanie; automatické doručovanie e-mailom nie je nastavené.

Podľa zadania sú prehľad, export aj úpravy verejné, bez prístupových práv a prihlasovania. Oznam má stále unikátne ID a odkaz `/#edit=ID`. Pôvodné odkazy `/#edit=ID.TOKEN` zostávajú funkčné. Každý s prístupom k aplikácii môže cez prehľad otvoriť a upraviť oznam vrátane jeho kontaktných údajov. Pôvodné meno a kontakt aj história verzií sa uchovávajú; ide o údaje zadané používateľom, bez overenia identity.

## Lokálne spustenie

```sh
npm ci
cp .env.example .env
# Doplň OPENROUTER_API_KEY.
npm run dev
```

Frontend: http://localhost:5173, API: http://localhost:3001. Vite preposiela `/api` na server. `OPENROUTER_MODEL` je voliteľný, predvolený je `google/gemini-3.1-flash-lite`. Model musí podporovať štruktúrovaný JSON Schema výstup. [OpenRouter Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs) sa validuje pomocou Zod.

Kľúč je iba na serveri. Model dostáva text a referenčný dátum zverejnenia, nie meno ani samostatné kontaktné pole. Ak je kontakt priamo v texte, odošle sa aj ten. Bez kľúča alebo pri výpadku OpenRoutera funguje ukladanie aj úpravy, s označením nedostupnej kontroly.

```sh
npm run build
npm start
```

Produkčný server spúšťa `build/server/index.js` a poskytuje frontend z `dist` na porte `PORT` (predvolene 3001). Po zostavení stačia produkčné závislosti.

## Dáta a termíny

SQLite je lokálne v `data/announcements.sqlite`; cestu určuje `DATABASE_PATH`. `announcements` obsahuje aktuálnu verziu a pôvodného autora, `announcement_versions` úplnú históriu. `publication_dates` obsahuje pole konkrétnych nedieľ, `event_override` ručne nastavený termín alebo `null`. Existujúce oznamy dostanú pri migrácii najbližšiu nedeľu po dátume vytvorenia vrátane toho dňa; existujúce termíny udalostí sa automaticky nemenia.

Stavy: `checking`, `pending` (kompletné), `needs_changes`, `review_failed`. `requestId` chráni pred duplikátom po strate odpovede, `baseRevision` pred prepísaním novších zmien zo starej karty. Kontrola staršej verzie neprepíše novšiu. Uložené oznamy, termíny a výsledky prežijú reštart.

`analysis.extracted` obsahuje `title`, `location`, `date` (`YYYY-MM-DD`), `time` (`HH:mm`), `timeZone` (`Europe/Bratislava`), `startsAt` (ISO 8601 UTC alebo `null`), `source`, `dateInferred` a `timingIssue`. Backend parsuje cez Temporal, frontend dáta validuje Zod schémou a formátuje cez Date/Intl v slovenskom časovom pásme. Dátum bez času nevytvorí polnoc. Nejednoznačný čas pri zmene letného času žiada upresnenie. Opakované a nejasné termíny zostávajú textom.

SQLite nemá natívny datetime typ. Ukladajú sa samostatné `event_title`, `event_location`, `event_date`, `event_time`, `event_time_zone` a `event_starts_at_ms` (UTC unix timestamp v milisekundách, INTEGER), pre aktuálny oznam aj históriu.

## API

- `POST /api/announcements`: JSON `id`, `requestId`, `baseRevision`, `text`, `name`, `contact`, `publishOn` (pole ISO nedieľ), `eventOverride` (`{date,time}` alebo `null`). Pri starších klientoch bez nových polí sa zachová predchádzajúce nastavenie, pri novom ozname sa použije najbližšia nedeľa.
- `GET /api/announcements/:id`: aktuálna verzia vrátane kontaktu a nastavení.
- `GET /api/reports/weekly?sunday=YYYY-MM-DD&format=json|txt`: verejný export pre konkrétnu nedeľu, bez kontaktov.
- `GET /api/health`: základná dostupnosť, bez volania AI.

API má limit 30 požiadaviek za 15 minút na IP a 35-sekundový timeout AI. `TRUST_PROXY=1` je pre jeden dôveryhodný reverzný proxy server. SQLite je určená pre jednu inštanciu s trvalým diskom.

## Docker a Traefik

`compose.yaml` používa externú sieť `web`, entrypoint `websecure`, resolver `tlschallenge` (TLS-ALPN-01) a doménu `autooznam.spis-ai.com`. Existujúci Traefik presmerúva HTTP na HTTPS. DNS A/AAAA musí smerovať na server, Traefik potrebuje porty 80/443.

```sh
docker compose up -d --build --wait
docker compose ps
docker compose logs --tail=50 app
curl --fail https://autooznam.spis-ai.com/api/health
```

Kontajner beží pod používateľom `node`, s read-only koreňovým systémom a trvalým volume `autooznam_data` na `/data`. Hostiteľský port sa nepublikuje. Produkčná databáza je `/data/announcements.sqlite`. `docker compose down` zachová dáta, `down -v` ich odstráni. Pred migráciou sa vytvára SQLite backup do `/data/backups`, vrátane dát vo WAL.

`.env` sa nekopíruje do image ani do GitHub repozitára. Po zmene kľúča: `docker compose up -d --force-recreate app`.

## Úplný administrátorský export

Oproti verejnému týždennému exportu obsahuje tento lokálny export aj pôvodné kontakty a históriu verzií:

```sh
npm run export -- ./oznamy.json
# Produkcia:
docker compose exec -T app node build/server/export.js /data/oznamy-export.json
docker compose cp app:/data/oznamy-export.json ./oznamy.json
```

Cieľový súbor ešte nesmie existovať. Lokálny export obsahuje kontakty; nepatrí do repozitára. Nastav si vlastnú dobu uchovávania dát a pravidelné zálohy.

## Overenie

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Testy používajú izolovanú SQLite a simulované AI odpovede, bez platených volaní. Overujú ukladanie pred AI, verzie, verejné úpravy, nedostupnú kontrolu, termíny/DST, nedele, ručné opravy, týždenné sekcie, export a správanie v prehliadači. Živé overenie modelu vyžaduje vlastný API kľúč.
