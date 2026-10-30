# Cykel 3 – verifierad main-leverans och Sites35

**API-originalkandidaten är levererad på main och publicerad som version35 i det befintliga Sites-projektet.** Kvittot är verifierat **2026-10-30T20:24:00Z**. Den senare cykel4-kandidaten ingår inte i denna publicering.

Maskinläsbart bevis: [QUALITY-8H-SITES-CYCLE3-PUBLICATION.json](QUALITY-8H-SITES-CYCLE3-PUBLICATION.json). Filen är en oförändrad kopia av samordnarens säkra publiceringskvitto. Lokal verifiering och avgränsad review av den levererade API-koden beskrivs i [cykel3rapporten](QUALITY-8H-CYCLE3.md).

## GitHub och exakt CI

| Fält | Verifierat värde |
| --- | --- |
| Main-commit | `6660bd712ba523b0cdbcb619e30c3bf43d9bc9b9` |
| Git-träd | `ed6d1e9461e179bbf31b76e869b5eb25ea1dde8a` |
| Actions | [41102309328](https://github.com/sharbel0022/Mgeorge/actions/runs/41102309328), **success** |
| Sites-jobb | `124221471837`, samma head SHA, success, 17:54:21–17:56:26 UTC |
| Node-jobb | `124221472099`, samma head SHA, success, 17:54:21–17:54:54 UTC |
| Före leverans | 469/469 Node + 692/692 Sites = **1 161**; 0 fel/överhoppade/avbrutna; syntax69, TypeScript/bygge godkända; audits0/0 |

## Sites-identitet och artefakter

| Fält | Verifierat värde |
| --- | --- |
| Befintligt projekt | `appgprj_6adf2f7f7e848191b64192161886b528` |
| Version / versions-ID | **35** / `appgprj_6adf2f7f7e848191b64192161886b528~appgver_8aaab7263bf08191aa810f4cfaaa4c21` |
| Sites-källcommit | `3366846830144e66b933b53be16d38ef8e0fd5d1` |
| Deployment | `appgdep_6ae4dbf0ce608191b17b71c52970ec2a` |
| Resultat / tid | **succeeded**, `2026-10-30T18:04:29.900273+00:00` |
| URL | [https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site](https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site) |
| Runtime-revision | **9** |
| Jämförda källfiler | **284**, samtliga lika |
| Auth-klient / åtkomstpolicy / automationskonfiguration | Oförändrade enligt kvittot |
| Gmail-schema | Fortsatt **avstängt** |
| Återgångspunkt | Sites34, källa `927a2cb666705e0ccfa2d88318bdcb443c3f0b08` |

Arkivhasharna gäller **olika byteföljder** och ska inte jämföras som om de vore samma fil:

| Arkiv | Storlek | SHA-256 |
| --- | ---: | --- |
| Lokalt komprimerat GZip-arkiv | **16 316 453 byte** | `89acbcf9dca1be0ed695fdcf85d1f10afd867fe2643c6550e923b638a3c7ce21` |
| Serverns TAR-arkiv | **39 321 600 byte**, 329 filer | `749be76c10a1f9a310c6313a1fdadb461d0a998f53de35e0f6c1432d58ddbada` |

Källjämförelsen284/284 är ett separat bevis från de två arkivkontrollsummorna.

## Läsande produktionskontroller och deras gräns

| Område | Observerat efter Site35 | Begränsning |
| --- | --- | --- |
| Bank | Ansluten, sex timmars intervall, senaste synk `2026-10-30T14:09:57.164Z`, inget rapporterat fel | Detta är observerad status, ingen ny genomförd hämtning eller full verifiering av individuellt bankunderlag. |
| Gmail | Ansluten, **stale**, senaste lyckade hämtning `2026-10-29T15:00:48.512Z`, 183 granskningsdokument, aftercheck_pending0 | Timschemat är pausat. Ingen ny hämtning, registrering eller aktuell automatik bevisas. |
| Backup | Statusfält **complete** för2026-10-30, files191/copied191, 63 448 066 byte; tidigare tid `2026-10-30T01:27:38.129Z` | **copy_readback**, verified_files0, API-evidens **unassessed**. Inget nytt fullständigt verifieringspass eller återställningsprov. |

Autentiserad produktionswebbläsare efter Site35 var **inte tillgänglig**: originating browser context unavailable. Senaste faktiskt verifierade autentiserade produktionsbrowser är version34. Lokal syntetisk Chromium-QA för cykel4 räknas separat.

Inga produktionsmutationer testades; **0 riktiga mejl** skickades och **0 riktiga betalningar** utfördes. API-kvittona avser bevarad parsad JSON, inte bankunderskrivna överföringsbytes. B1–B6 och Gmail-pausen kvarstår. Ett senare lokalt backupfynd redovisas öppet i [cykel4rapporten](QUALITY-8H-CYCLE4.md); detta publiceringskvitto påstår inte katastrofsäkerhet eller full återställbarhet.
