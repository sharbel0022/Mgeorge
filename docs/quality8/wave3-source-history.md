# Reproducerbar lokal integrationshistorik för wave3

GitHub-anslutningen publicerar en commit med det verifierade slutträdet. Dess commit-ID skiljer sig från de lokala integrationscommittarna. För att tidigare lokala mätkällor fortfarande ska gå att checka ut från en vanlig GitHub-klon finns den begränsade historiken i **wave3-source-history.bundle**.

- Bas/prerequisite: `819adee2f3848b474167eb6b15f82584caeb39af`, redan publicerad main.
- Sparad branch: `refs/heads/codex/rating8-followup-20261105`.
- Sista inkluderade commit: `49db400c1e4f0cead46b74974446a0cf388766c3`.
- Storlek: 1 327 011 byte.
- SHA-256: `975a512f42273e3341eb300340b9472a03c9f1b0d2850ced2fe45e1db55913de`.
- `git bundle verify` är genomförd och godkänd.

Historiken innehåller bland annat `635ca5e3bcf3c1c8ecff16b192a44cde35175d69`, den exakta källan för omtolkningen av sparad V2-text, samt de integrerade parser-, bank- och dokumentationsändringarna före paketet självt. Den innehåller inte V3-bilder/facit eller alla fristående producentbrancher; producenternas motsvarande produktfiler binds separat med de SHA-256 som finns i respektive granskningskvitto.

Återläs utan att flytta main eller skriva över en arbetsbranch:

```sh
git bundle verify docs/quality8/wave3-source-history.bundle
git fetch docs/quality8/wave3-source-history.bundle refs/heads/codex/rating8-followup-20261105:refs/remotes/quality8/wave3-preserved
```

Därefter går de sparade root-committarna att visa eller checka ut isolerat. Kända utvecklingsmätningar ska alltid skriva en ny resultatfil; de ursprungliga V1/V2-förstaproven får inte skrivas över.

