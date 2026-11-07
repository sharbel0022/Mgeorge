# Node admin AI-status – riktad rättning efter slutgranskning

Datum: 2026-11-07. Arbetskopia `/workspace/scratch/2236a42849dc/worktrees/admin-fix`, branch `work/cleanup-admin-fix`, bas `9fc922739cb3522d34a3b9e854bc98262b6f32ba`.

Lokal commit: **`2a506575901637dc83a087c91920e3a1f86c5bd1`**, `Align Node AI diagnostics with the processing storage owner`.

## Fel och ändring

Den oberoende `final-review.md` visade att adminrouten använde inloggningsprincipal som AI-policyägare. Legacybearbetning använder däremot `node:legacy`. Giltigt godkännande för `node:legacy` rapporterades därför felaktigt som OWNER_NOT_APPROVED; godkännande enbart för `administrator` kunde omvänt rapporteras som tillräckligt trots att bearbetningen saknade godkännande.

Endast en produktionsrad ändrades: `invoiceAiPolicy(process.env, req.companyContext?.storageOwner || 'node:legacy')`. Detta matchar den befintliga Node-bearbetningens ägarval. Actor, session, företagsval, aktuellt medlemskap, manage_integrations, origin och hemlighetsfria svar behåller samma kontroller. Ingen provider-/dokumentbearbetning ingår.

## RED/GREEN med riktig HTTP-server

Utökade `test/admin-ai-status.test.js` använder den verkliga Node-servern, temporär syntetisk SQLite och autentiserade sessionscookies. Server och databaser stängs och temporära filer tas bort.

Före ändringen gav `node --test test/admin-ai-status.test.js` **6 pass / 2 fail**:

- Godkänd `node:legacy` gav felaktigt policyStatus blocked i stället för enabled.
- Godkänd `administrator` ensam gav felaktigt enabled i stället för blocked.

Efter enradersfixen gav samma kommando **8/8**, 0 fail, cancelled eller skipped, exit0. Loggar: `/tmp/admin-ai-status-red.log` och `/tmp/admin-ai-status-green.log`.

Nya tester täcker:

- Verklig autentiserad legacy-HTTP-begäran med konfigurerad modell/nyckel, alla godkännanden och endast `node:legacy` godkänd: configured + enabled, utan nyckel i svaret.
- Endast loginactor `administrator` godkänd: configured + blocked / OWNER_NOT_APPROVED.
- Verklig företagssession med exakt current storageOwner godkänd: configured + enabled.
- Samma företagssession med endast loginactor eller ett annat företags storageOwner godkänd: blocked / OWNER_NOT_APPROVED.

Befintliga tester för owner/admin, anonym/accountant/viewer, annat företag, origin, saknad nyckel, felaktig modell, health, återkallat medlemskap och sekretess passerar också.

Syntax: `node --check src/server.js` och `node --check test/admin-ai-status.test.js`, exit0. `git diff --check`, exit0. Ingen bred svit eller byggning kördes enligt uppdragsavgränsningen. Befintliga rootberoenden återanvändes genom en tillfällig lokal node_modules-länk, utan ominstallation eller förändring av rotens beroenden; länken togs bort efter testen.

Endast `src/server.js` och `test/admin-ai-status.test.js` ändrades. Arbetskopian är ren efter commit. Inga ändringar gjordes i rotarbetskopians kod. Ingen push, providerbegäran, kunddata, betalning eller produktionsändring förekom. Koordinatorn fortsätter med slutlig integrerad verifiering och CI.
