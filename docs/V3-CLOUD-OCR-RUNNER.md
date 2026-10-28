# Moln-OCR för skannade fakturor

V3 innehåller en separat GitHub Actions-körning som använder samma svenska Tesseract-motor, dokumentkö och granskningsregler som den befintliga OCR-datorn. Efter godkänd produktionssättning kan bilder och skannade PDF-filer därför behandlas när användarens dator är avstängd. Ingen extern AI-tolkningstjänst eller ny betald OCR-API krävs.

**Leveransstatus:** Koden och syntetiska tester finns i PR-branchen. Detta dokument innebär inte att moln-OCR har aktiverats eller verifierats i GitHub Actions mot produktionssystemet. Befintliga bank-, Gmail- och backupjobb ändras inte av workflowfilen.

## Körning och dataväg

`.github/workflows/sites-cloud-ocr.yml` kör på en GitHub-hostad Ubuntu-maskin vid minuterna 7, 22, 37 och 52 varje timme. En manuell körning finns också. Båda är spärrade till granskad kod på `main` och den uttryckliga aktiveringsvariabeln `MG_CLOUD_OCR_ENABLED=true`.

Körningen anropar först Sites `/api/ocr-worker/process`, så att befintliga text-PDF-underlag kan behandlas och skannade PDF-filer flyttas till OCR-kön. Därefter behandlas högst sex dokument i följd. Varje dokument har en serverutfärdad, ägarbunden tidsbegränsad lease. Original hämtas från privat R2 via den autentiserade Sites-rutten, läses i processminnet och kontrolleras mot lagrad storlek och SHA-256 före OCR. Den befintliga tolkningsprocessen begränsar varje dokument till 90 sekunder, 15 MB, tio PDF-sidor och 12 miljoner bildpixlar. OCR-resultatet skickas tillbaka med samma lease och originalets hash. Endast ett godkänt, sparat serversvar räknas som klart.

Lokal och molnbaserad OCR använder samma beständiga kö och atomiska anspråk. De kan därför inte samtidigt slutföra samma dokument. Molnkörningen skickar `X-MG-OCR-Runner: cloud` och använder en egen token. Lokal konfiguration och lokal token behålls. En avbruten körning lämnar kön i Sites; serverns lease- och försöksregler avgör när ett nytt försök får ske. Maximalt tre försök per jobb gäller innan manuell kontroll behövs.

OCR förändrar inte verifieringskraven. Skannade fakturor behåller OCR-metod och lägre fältsäkerhet och kräver granskning enligt befintliga regler. OCR identifierar inte vem som betalade en bankinsättning.

## Aktivering efter godkänd produktionskontroll

1. Publicera den testade Sites-versionen inklusive den additiva databasändringen. Behåll samma D1-, R2-, ägar- och integrationsinställningar.
2. Sätt Sites-hemligheten `DOCUMENT_CLOUD_WORKER_TOKEN` till en ny kryptografiskt slumpmässig 32-byte base64url-token och `DOCUMENT_CLOUD_OCR_ENABLED=true`. Återanvänd inte den lokala tokenen. Behåll befintlig dokumentägare och automationskonfiguration.
3. Lägg samma token i GitHub-repositoryts Actions-hemlighet `MG_SITES_OCR_TOKEN`. Ange `MG_SITES_ORIGIN` som Actions-variabel (eller hemlighet) med exakt HTTPS-origin för den befintliga Siten, utan sökväg, användaruppgifter eller frågesträng. Hemligheter ska överföras via skyddat gränssnitt eller stdin, aldrig via kommandoradsargument, Git eller loggar.
4. Efter merge till `main`, sätt Actions-variabeln `MG_CLOUD_OCR_ENABLED=true`. Kör manuellt med ett syntetiskt underlag och kontrollera att jobbet slutförs medan Windows-jobbet är stoppat. Kontrollera Sites köstatus, sparad OCR-metod, granskningsstatus och bevarat original.
5. Kontrollera och återaktivera det **befintliga** timschemat för Gmail om det är pausat. OCR-jobbet tömmer redan importerade underlag; nya Gmail-bilagor kräver fortsatt det befintliga Gmail-jobbet. Skapa inget dubbelt Gmail-schema.

Arbetsflödet behöver endast `contents: read`. Git-checkout sparar inga autentiseringsuppgifter. OCR-tokenen lämnas endast till själva OCR-steget; installation och checkout får den inte. Extraktionsbarnprocessen får inte förälderns tokenmiljö. Workflowfilen har inga PR-triggers, exporterade artefakter, dokumentcache eller loggning av fakturatext, filnamn eller token. Starttider kan fördröjas av GitHub. En global concurrency-grupp med `cancel-in-progress: false` låter en pågående körning avsluta sin lease. Jobbets totala tidsgräns är 15 minuter.

## Övervakning och stopp

CLI skriver endast övergripande status och antal lyckade/misslyckade dokument. Ett dokumentfel eller misslyckat autentiserings-/slutförandeanrop ger felkod för GitHub-jobbet. Underlag och orsaker granskas i den ägaravgränsade Sites-kön. Körhistorik i GitHub och serverns senaste kontakt ska kontrolleras vid utebliven behandling. Att workflow finns i Git betyder inte att den är aktiv.

Stäng av nya molnkörningar genom `MG_CLOUD_OCR_ENABLED=false`; återkalla sedan molnbehörigheten med `DOCUMENT_CLOUD_OCR_ENABLED=false` och vid behov rotera token. Lokal OCR, Gmail, bank och backup behåller sina egna inställningar. Försök som redan fått lease skyddas fortfarande av serverns behörighetskontroll.

## Driftbegränsningar och källor

GitHub dokumenterar att scheman bara kör på standardbranchen, kan fördröjas eller tappas vid hög last och automatiskt kan inaktiveras efter 60 dagar utan aktivitet i ett publikt repository. Kvartsschemat är därför en planerad körfrekvens, ingen garanti för behandling inom 15 minuter. Se [GitHub: schedule](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

GitHub är här en ny plats för behandling av fakturornas person- och företagsuppgifter. Ingen faktura görs offentlig genom repositoryt; körningens läsåtkomst skyddas av separat Sites-token. Ubuntu-jobben använder tillfälliga GitHub-maskiner. Bedöm organisationens krav på databehandling och region före aktivering. Se [GitHub-hostade runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

Token lagras i Actions Secrets och lämnas via miljövariabel i det begränsade OCR-steget. Se [GitHub: användning av hemligheter](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

De lokala regressionstesterna omfattar ett sammanhängande flöde från verklig pull-runner via Sites jobb-API, privat lagringsfixture, svensk Tesseract och tillbaka till sparad OCR-tolkning. En syntetisk fakturabild ger fakturanummer 0606 och 3 750 kr, behåller originalet och kräver granskning utan lokal OCR-kontakt. Övriga tester täcker felaktig hash, begränsad kö, token/redirect-skydd, ogiltiga resultat, utgången lease, bekräftat serversparande och sekretess i CLI-fel. Sites integrationstest kräver även repositoryts rotberoenden (`npm ci --ignore-scripts`) för den riktiga Canvas-/Tesseract-processen. Faktisk schemaläggning i GitHub, produktionshemligheter, produktionsoriginal och drift med avstängd dator är ännu inte verifierade av dessa tester.
