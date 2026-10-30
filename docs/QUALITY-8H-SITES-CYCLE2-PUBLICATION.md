# Cykel 2 – publicerad version och kontrollerad produktion

**Sites-version 34 är publicerad med status succeeded.** Koden finns på [main 9d9a10c](https://github.com/sharbel0022/Mgeorge/commit/9d9a10c48e4725ec22e188f946da3c03cdfa5814). Båda jobben i [Actions 41099298812](https://github.com/sharbel0022/Mgeorge/actions/runs/41099298812) lyckades på exakt denna commit. Arbetet fortsätter inom den ursprungliga budgeten, senast till 2026-10-30 23:31:15 UTC.

## Leverans och bevarad drift

Det isolerade och testade GitHub-trädet är `ad434247b7f3d978c4b0d7571bc2dea7374c6f6b`. Samtliga 278 spårade Sites-filer jämfördes byte för byte mot källan som byggdes och pushades till samma befintliga projekt. Sites-källcommitten är `927a2cb666705e0ccfa2d88318bdcb443c3f0b08`; deployment `appgdep_6ae4d50bb3fc8191b48c6f93dc624e3f` lyckades 17:35:18 UTC med runtime-revision 9.

D1/R2-bindningarnas manifest, autentiseringsidentitet, åtkomstpolicy och alla tre externa scheman är bevarade. Gmail-schemat är fortsatt pausat. Inga hemligheter, bankbehörigheter, kundsändningar eller riktiga betalningar ändrades eller utfördes.

Före publicering kontrollerades befintlig backup: 191/191 original, 63 448 066 byte, verifieringsstämpel 01:27:38 UTC. Version 34 visar korrekt `copy_readback` och 0 filer i ett separat fullständigt manifestpass för denna äldre backup. Den gör inget retroaktivt påstående om den nya verifieringskoden. Återgångspunkt är version 33; den nya migrationen är additiv. Ingen destruktiv återställning eller full återställningsövning kördes i produktion.

## Nya produktionsobservationer

Den autentiserade statusläsningen fungerar genom det förstärkta MCP-gränssnittet. Gmail är anslutet men senast lyckad hämtning är 2026-10-29 15:00:48 UTC och status är stale. Det pausade externa timschemat förblir pausat. Bankanslutningen är aktiv med sex timmars intervall och senast lyckad hämtning 2026-10-30 14:09:57 UTC utan sparat fel.

Den nya, begränsade diagnostiken analyserade samtliga 183 granskningsdokument från sparade tolkningar. Kategorierna överlappar:

| Orsak | Antal |
| --- | ---: |
| Motpart inte verifierad | 182 |
| Låg tolkningssäkerhet | 138 |
| Datum saknas | 104 |
| Organisationsnummer saknas | 101 |
| Kund/leverantör saknas | 58 |
| Moms eller nettobelopp saknas | 55 |
| Belopp saknas | 50 |
| Fakturanummer saknas | 21 |

Inget analyserat underlag saknade helt en sparad tolkning; ingen möjlig dubblett flaggades av denna begränsade sammanställning. Detta bevisar inte att inga dubbletter finns eller att fälten är korrekta. Resultaten motiverar fortsatt säker förbättring av tolkning och motpartskontroll, inte automatisk massregistrering av osäkra fakturor. Moln-OCR:s senaste kontakt var 16:40:41 UTC och senaste sparade OCR-resultat från föregående dag. En lyckad körning som behandlat 0 dokument bevisar inte ett nytt OCR-resultat.

## Faktiskt webbläsarprov och nytt fel

Den inloggade startsidan visar fyra önskade kort och exakt en huvudknapp för `Kontrollera alla betalningar`. Ingen horisontell dokumentoverflow eller nytt konsolfel observerades vid denna kontroll.

I mobil 390×844 öppnades menyn med rätt initialfokus och granskningsvyn med fokus på huvudytan. Ett dokument öppnades med tangentbord och återgångsknappen aktiverades med tangentbord. Båda övergångarna tappade fokus till BODY när den föregående panelen doldes. Detta är ett **reproducerat kvarstående tillgänglighetsfel**, som rättas i nästa UI-cykel; det räknas inte som godkänt. Dokumentförhandsvisningen använder den levererade GET-vägen. Ingen uttrycklig registrering, synkstart, avstämning, kundsändning eller betalning gjordes. Viewporten återställdes och fliken lämnades på Översikt.

## Tester och gränser

Exakt levererad kandidat klarade **469 Node + 624 Sites = 1 093 tester**, 0 fel och 0 överhoppade. Syntaxkontroll av 69 filer, TypeScript, produktionsbygge och båda beroendegranskningarna passerade; inga kända sårbarheter rapporterades. Lokala tester använde isolerad syntetisk data.

API-originalens ytterligare integritetsrättning och navigering med URL/historik/formulärskydd är separata, ännu inte publicerade kandidater. Denna rapport verifierar inte autentiska individuella Swedbankrapporter, verklig ny OCR-registrering eller katastrofåterställning av produktionsdata. Exakta identifierare och säkra aggregat finns i [maskinläsbart publiceringsbevis](QUALITY-8H-SITES-CYCLE2-PUBLICATION.json).

