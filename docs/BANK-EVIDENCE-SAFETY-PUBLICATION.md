# Publicering av bankbevis och återhämtning

Publicerad 28 oktober 2026 efter uttrycklig instruktion att uppdatera main och Sites.

- PR #12 mergad till main: `ad58e911bafdda379b300b2d06723ee8bd5e5536`.
- Föregående PR-head `2d4530395742530353409f002fb254d75d149fa0`: samtliga Node- och Sites-jobb godkända i GitHub CI.
- Sites-källrepository: `52aefc7d20b9642a5ff0171048b25c1dd9301f6c`, synkroniserad från main:s sites-katalog.
- Sites-version: **30**.
- Deployment: `appgdep_6ae278c75a2881919df77aabf3cb6e0d`, **succeeded**.
- Runtime-revision: **9**.
- Adress: https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site

Befintligt projekt, åtkomstläge, D1/R2-bindningar och bank-/Gmail-/backupscheman bevarades. Inga runtimehemligheter ändrades. Paketet innehåller den additiva migrationen 0011 för Gmail-väntetid. Plattformens lyckade publicering bekräftar leveransen; ingen verklig betalning, kundutskick eller bankimport kördes som publiceringstest. De externa rapportkraven i BANK-EVIDENCE-SAFETY-DELIVERY.md kvarstår.
