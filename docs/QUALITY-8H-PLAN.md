# Mgeorge – åtta timmars kvalitetsarbete

**Goal:** Fortsätt från senaste verifierade main mot samtliga 33 acceptansområden, med ekonomisk korrekthet först och faktisk evidens för varje leverans.
**Architecture:** Behåll Node/SQLite och Sites/React/D1/R2. Rätta fel i befintliga original-, avstämnings- och kögränser. Separera bankens originaluppgifter, mänskliga beslut och fakturaförslag. Arbeta i oberoende filområden och granska integrerad kod före leverans.
**Tech Stack:** Node >=22.13, JavaScript/TypeScript, React, SQLite, Cloudflare D1/R2 och befintliga Sites-byggverktyg.
**Spec:** Användarens uttryckliga 8-timmarsuppdrag 2026-10-30; samtliga 33 acceptansområden i `QUALITY-SCORECARD.md`.

## Budget och start

- Start: **2026-10-30T15:31:15Z**. Maximal väggklockebudget: 8 timmar; senaste stopp **2026-10-30T23:31:15Z**. Tid i parallella agenter summeras inte som extra väggklocketimmar. Faktisk tid ska rapporteras separat.
- Startcommit: `c519eef47e5a084a35db7675a2553a554c55ec4c`, ren och hämtad från origin/main.
- Startbetyg: 245/330 = **7,42/10**; **0/33** på minst 9,5. Sites **32**.
- Ny baslinje: **377/377 Node +456/456 Sites**, 0 fel/överhoppade; syntax och TypeScript godkända. Startcommitens Actions **41079705471: success**, båda jobb.
- Senaste leverans: `docs/QUALITY-33-DELIVERY.md`; publiceringsbevis: `docs/QUALITY-33-PUBLICATION.json`.

## Globala begränsningar

- Endast isolerade syntetiska data i utvecklingstester; starta inte Node med företagets `.env`.
- Inga riktiga kundsändningar, bankbetalningar, raderingar, destruktiva återställningar, nya betaltjänster, ändrade produktionshemligheter eller bankmedgivanden.
- Det externa Gmail-schemat är pausat och ska förbli pausat utan ny uttrycklig instruktion.
- Main-integration och publicering i samma Sites-projekt är redan godkända. Inget force-push; bevara DB/R2, identitet, domän, historik och schema-ID/lägen.
- Nödvändiga autentiska bank-/produktionsbevis ersätts inte av syntetiska tester. Poäng ändras endast med dokumenterad förbättring eller ny evidens.
- Användaren har begärt självständigt utförande; rutinval avgörs inom det mandatet utan extra godkännandeloop.

## Granskningsfokus

1. Ett saknat eller förändrat original får inte indirekt godkänna en annan betalning genom en äldre motpartsrelation.
2. Återimport, samlingsposter, avbrott och rollback ska bevara både konflikter och ekonomiska totalsummor.
3. OCR-resultat efter utgången lease eller förlorat original får inte registreras som verifierat.
4. Mobil navigering ska ha meningsfulla namn, stängning, fokusordning och fokusretur utan åtkomst till dold bakgrund.
5. Ett misslyckat statusanrop eller en pausad integration får inte visas som verifierad nollsumma eller fungerande automatik.

## Cykel 1 – reproducerade integritetsfel och navigation

### A. Node bankbevis

Filer: `src/bank-evidence.js`, `src/db.js`, `src/reconciliation.js`, riktade `test/*quality*.test.js`.

- [ ] Reproducera återimport som undertrycker en relevant bankkonflikt och inlärd betalare vars stödoriginal inte längre kan verifieras.
- [ ] Rätta bara verifierade orsaker; bevara ursprungliga bankfakta, tidigare allokeringar och revisionshistorik.
- [ ] Kontrollera bevarande av inkommande filoriginal vid konflikt/rollback; testa återförsök och omstart.
- [ ] Kör riktade regressioner och hela Node-sviten; dokumentera exakta utfall.

### B. Sites bankgränser

Filer: `sites/lib/domain.ts`, `sites/lib/reconciliation*`, `sites/lib/bankgiro-service.ts`, `sites/app/api/state/route.ts`, banktester.

- [ ] Kontrollera samma ekonomiska felklasser genom verkliga routes och isolerad D1/R2.
- [ ] Reproducera eventuell förlorad spärr, valideringsbudgetlucka eller omtolkad manuell rättelse.
- [ ] Rätta med positiva/negativa fall; förhandsvisningar ska vara utan ekonomiska skrivningar.
- [ ] Kör Sites-sviten och TypeScript.

### C. Dokument, Gmail och OCR

Filer: dokument-, Gmail- och OCR-moduler i `src/` och `sites/lib/`, avgränsade tester.

- [ ] Kontrollera originalintegritet på nytt när asynkront OCR-resultat slutförs.
- [ ] Spåra återförsök, checkpoints och konsumenter av gamla tolkningsresultat; skriv regression före rättning.
- [ ] Behåll verklig osäkerhet i granskningskön; ingen sänkt motpartskontroll för att minska antalet poster.
- [ ] Kör riktade tester och berörda fulla sviter.

### D. Navigation och användbarhet

Filer: `sites/app/dashboard.tsx`, navigationkomponent/hjälpare vid behov, `sites/app/globals.css`, UI-regressioner.

- [ ] Reproducera mobilmenyns fokus-/stängningsproblem i riktig webbläsare och kontrollera sidsemantik.
- [ ] Ta bort den äldre genvägen med hårdkodade uppgifter från användarens bankbilder utan att röra sparade ekonomiska poster.
- [ ] Gör dold mobilnavigation otillgänglig för tangentbord; ge öppnad meny korrekt dialogbeteende, Escape och fokusretur.
- [ ] Lägg till tydlig aktiv navigation och genväg till huvudinnehåll. Behåll svartvit design, fyra kort och huvudknappen.
- [ ] Verifiera 320/390/768/1024/1440 px, tangentbord, tom-/felläge och riktad React-granskning.

## Efterföljande cykler

- [ ] Granska samlad diff oberoende, rätta ekonomiska/säkerhetsfynd med regressioner och kör obligatoriska slutgrindar.
- [ ] Integrera till aktuell main utan att skriva över andra ändringar; verifiera commit och CI. Publicera en stabil leverans i befintligt Sites-projekt efter backup-/återgångskontroll.
- [ ] Nästa kandidat: en strukturerad, revisionsbar process för bankkonflikter. Ett fritt textfält får inte häva konflikten. Beslutet måste knytas till exakt konfliktversion och kontrollerade original; finansiella skillnader och befintliga kopplingar får inte tyst skrivas om.
- [ ] Fortsätt med integritets-/köfynd, tillgänglighet, säkra driftkontroller och återställningsbevis som ryms inom tillgänglig miljö och tid.
- [ ] Uppdatera alla 33 områden med föregående/ny poäng, förbättring, testbevis, produktionsbevis, brist och nästa åtgärd. Spara maskinläsbar checkpoint i `PROGRESS.md`.

## Leveransgrindar per stabil programleverans

Node: `npm ci`, `npm run check`, `npm test`, `npm audit`. Sites: `npm run install:ci`, `npm run check`, `npm test`, `npm audit`, `npm run build`. Läs faktisk output; knyt slutresultat till exakt källträd/commit. Produktionskontroller är läsande och får inte förväxlas med ett fullständigt autentiserat verksamhetsflöde.

Stopp endast vid uppnått mål, förbrukad budget, faktisk teknisk körgräns eller när allt återstående arbete kräver otillgängliga externa förutsättningar. Inga påståenden om automatisk fortsättning utan en konfigurerad körning.
