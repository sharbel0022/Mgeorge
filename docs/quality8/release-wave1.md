# Leverans 1: exakt kod, publicering och verklig drift

2026-11-05. Detta kompletterar [den första integrationsgranskningen](integration-review-wave1.md). Dess tidigare misslyckade körningar ligger kvar som historik. **Version 63 är publicerad och dess slutliga obligatoriska CI passerar. Målet minst 8 i alla 33 områden är ännu inte verifierat.** Maskinläsbara uppgifter finns i [release-wave1.json](release-wave1.json).

## Levererad kod och godkända grindar

[PR 48](https://github.com/sharbel0022/Mgeorge/pull/48) mergades normalt, med kontrollerat förväntat huvud, till `bf24a3c52ffc637d1e7bbc4d4f64a1732dcd9fee`. Den lokalt slutgranskade commiten `0c570a03bac9945388eb5b7030ed7916242eb830`, PR-huvudet `e42b05a8b78e77a3210be00da0b0231454a29233` och main har samma repositoryträd: `f74752c5146d9867342828edfb766f07db570a7e`.

| Grind | Slutligt resultat |
|---|---|
| [Full obligatorisk CI på exakt main](https://github.com/sharbel0022/Mgeorge/actions/runs/42081012356) | Godkänd. Node 1 997/1 997, Sites 3 850/3 850, bridge 47/47; inga fel eller överhoppade prov. Sites typkontroll och produktionsbygge godkända. |
| Full obligatorisk PR-CI, körning 42079230293 | Godkänd på samma källträd. |
| [SaaS-säkerhetsacceptans på PR](https://github.com/sharbel0022/Mgeorge/actions/runs/42079230295) | Godkänd. Node 325/325 och Sites 788/788. Dessa prov ingår även i de fulla sviterna och adderas inte till deras antal. |
| [Säkerhetsartefakt 13440665202](https://github.com/sharbel0022/Mgeorge/actions/runs/42079230295/artifacts/13440665202) | Bevarad ZIP, SHA-256 `047af96e2e4972b5464511faf54e0047d68b8d7bd4f6ef25e4083b44cbb5db69`. |
| Oberoende slutgranskning av testladdardeltat `0c570a0` | Inga kvarstående Critical, Important eller Minor. Befintliga assertions behölls. |

Det fulla 5 894-provsresultatet gäller denna första leverans. Senare OCR- och flerdelningsändringar måste passera egna integrerade grindar. Den äldre lokala körningen med 88 Sites-fel och bygget med exit 137 omklassificeras inte till godkända.

## Publicerad Site

Den befintliga [MG Fakturakoll-appen](https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site) publicerades som **version 63**. Deploy-statusen är `succeeded`, med slutförandetid **18:12:36.530631 UTC**. Publikens befintliga inställning, lagring och tre befintliga scheman behölls.

Sites-underträdet är `ec997f7d5e43af779b1119a5a88939b946ef4c7c`, exakt samma som main. Den officiella publiceringsrutinen byggde efter slutförd källkopiering, skapade den nativa källcommiten `b79213c21c955b1a23813a4cfaebeffafcb5a600` och publicerade det sparade paketet. En tidigare fristående lokal byggkörning startade medan kopieringen ännu pågick; den används därför inte som slutligt proveniensbevis.

Den uppladdade gzip-filen är 18 503 122 byte med SHA-256 `aa318ca29559f499b8fed86cc37628342955aa15e151703771a96dc2b8a9905c`. Serverns uppackade tar-representation är 47 779 840 byte, 431 filer, med SHA-256 `2fa6da505429fdca2aaed7fdc3c34bb47bca8f721f9b56e15fa52a993fb634d3`. Hasharna avser olika representationer och förväntas inte vara lika.

### En avgränsad konfigurationsändring

Miljörevisionen ändrades 9 → 10 vid 17:57:48.138258 UTC. Endast den icke-hemliga inställningen `ENABLE_BANKING_REDIRECT_URL` lades till, med värdet `https://mg-fakturakoll-sharbel.sharbelrasho.chatgpt.site/api/bank/callback`. Övriga 17 nycklar ändrades inte. Bankleverantörens registrerade callback ändrades **inte** av detta. En ny auktorisering kräver fortfarande att leverantörens registrering faktiskt accepterar appens exakta callback.

## Verklig OCR-progress

Två separata lyckade körningar på `bf24a3c` har verifierats i både GitHub-loggar och appens status:

| Körning | Utlösare | Dokument | Fel | Slutfört resultat i logg, UTC |
|---|---|---:|---:|---|
| [42081905168](https://github.com/sharbel0022/Mgeorge/actions/runs/42081905168) | Lyckad obligatorisk CI på main | 6 | 0 | 18:13:37.6565119 |
| [42083409804](https://github.com/sharbel0022/Mgeorge/actions/runs/42083409804) | Befintligt schema | 6 | 0 | 18:23:32.3522858 |

Den väntande OCR-kön minskade **23 → 17 → 11** innan nästa hämtning lade till nya dokument. Granskningskön ökade samtidigt **350 → 356 → 362**. Det är verklig behandling av tolv dokument, men ingen av dessa observationer visar automatisk fakturaregistrering: underlagen kräver fortfarande granskning. Appens senaste slutförandetid för moln-OCR är 18:23:31.509 UTC.

Den tidigare luckan mellan schemakörningarna är bevarad i historiken. Orsaken till luckan är inte fastställd; återupptagen drift bevisar inte retroaktivt varför den uppstod.

## Gmail: schema, efterkontroll och separat köredovisning

Det redan existerande timschemat är aktiverat. Plattformens körningshistorik visar både körningen planerad 17:00 UTC och körningen planerad 18:00 UTC som slutförda. Den senare startade 18:04:04.607069 och avslutades 18:06:26.109376 UTC; dess resultats ID och tid matchar samma körning. Dess dåtida meddelande om offline-OCR föregår återhämtningen ovan och används inte som aktuell status. Plattformens leveransstatus till användaren är okänd.

Vid efterkontrollen av version 63 hade en Gmail-hämtning sparat dokument men lämnat status `completed_pending`. Den befintliga säkra avstämningen kördes och gav **0 automatiska matchningar**, med 121 granskningsfynd. En därefter tillåten vanlig `gmail_auto_sync` slutförde hela efterkontrollen:

- 9 importerade bilagor, 0 dubbletter, 10 hittade meddelanden; ytterligare sidor återstår.
- Lyckad hämtning 18:28:50.457 och slutfört systemanrop 18:28:53.535 UTC.
- `last_outcome=completed`, `postprocess_warning=null` och `aftercheck_pending=0`.
- 362 jobb i granskning, 2 registrerade jobb, 13 väntande på OCR och 7 köade efter den nya importen.
- Inga kundmejl skickades. Registrerade jobb och separata registrerade Gmail-källor har olika räknare och blandas inte ihop.

Appen rapporterar korrekt `fetch_ready=true`. `background_ready=false` kvarstår därför att appen själv inte kan verifiera den externa schemaplattformen. Det är ingen grund för att sätta en grön flagga manuellt. Plattformens observerade körningar redovisas separat.

## Ekonomisk jämförelse och kvarstående bankgräns

En avgränsad jämförelse togs 18:10:52.489 UTC före publicering och återupprepades 18:26:24.346 samt 18:29:24.114 UTC efter OCR och Gmail-återhämtning. De två utvalda radernas belopp, datum, valuta, ekonomiska räknestatus, fakturakopplingar och konfliktstatus är oförändrade. Bara en av de två källobservationerna räknas ekonomiskt, båda har noll bokförda fakturakopplingar och arbetsytans revision är fortsatt 52. Detta är en jämförelse av utvalda fakta, inte en fullständig revision av hela registret. Evidenssvarets fullständighetsflaggor är fortfarande falska och döljs inte.

Banken rapporterar fortfarande **frånkopplad**, med senaste lyckade hämtning 08:05:14.646 UTC. Den nya samtyckeskontrollen är driftsatt men exponeras ännu inte som anropbart verktyg i denna konversations anslutning. Ingen färsk kontroll mot banken eller ny verifierad läsning av valt konto har genomförts. Varken ett framtida lagrat samtyckesdatum, lyckad CI eller en publicerad callback gör banken godkänd i drift.

## Backup och visuella begränsningar

Den redan frysta krypterade backupen är verifierad med **362/362 original och 142 968 213 byte**, slutförd 16:55:10.290 UTC. [Återställningsrapporten](recovery-evidence.md) redovisar den separata syntetiska övningen och dess tydliga RPO/RTO-gränser. Senare Gmail-importer ingår inte i den äldre frysta backupen; verifieringens sluttid är inte datans återställningspunkt.

Den hanterade förhandsvisningen startade inte inom sin tillåtna tidsgräns trots avgränsad felsökning. Efter publicering fick molnwebbläsaren timeout för både DOM- och skärmbildsläsning. Den begärda visuella verifieringen på fem bredder är därför fortfarande **inte genomförd**. Komponenttester och lyckat bygge ersätter inte denna observation.

Nästa leverans omfattar OCR-ordbevis, den granskade manuella flerfakturafördelningen samt nya integrerade tester. Slutbetygen ska följa samma 33 kriterier i [PLAN.md](PLAN.md) och får inte höjas utifrån enbart denna mellanleverans.

### Ytterligare genomförd Gmail-schemakörning

Det redan aktiverade timschemats tredje observerade körning var schemalagd till **19:00 UTC**. Plattformen registrerade start **18:58:11.923** och slutförande **19:01:55.217**, med ett matchande resultat om **åtta nya importerade underlag** och inga skickade mejl. Efterläsningen i applikationen visar en lyckad hämtning **18:59:26.053**, slutförd efterkontroll **18:59:50.683**, `completed`, ingen efterkontrollvarning och noll väntande efterkontroller.

De nya importerna gjorde att den observerade OCR-kön därefter innehöll **28** väntande underlag; **362** låg på granskning och **2** bearbetningsjobb var registrerade. Dessa 28 räknas inte som OCR-bearbetade. De två tidigare OCR-körningarnas 12 faktiskt behandlade underlag och respektive tidpunkter står kvar. Appens bakgrundsstatus är fortfarande inte grön eftersom den själv saknar ett verifierat externt schemakvitto; plattformskvittot ovan ändrar inte appens sparade flagga.

### Senare publik UI-uppföljning samma dag

En ny flik återställde åtkomsten till den publicerade appens offentliga vy. Den utloggade översikten visade streck för okända belopp och inaktiverade ekonomiska kontroller. I det befintliga isolerade demoläget verifierades översikt, kombinerad svensk sökning, öppning med pil ned/Enter samt faktura- och bankdialogens källmarkeringar. Observerad viewport var 1 363 × 936 CSS-pixlar; klient- och innehållsbredd var båda 1 348, utan horisontell dokumentöverströmning. Detta är en enda desktopbredd. Normal fönsterändring ändrade inte bredden, och de fem accepterade bredderna är fortfarande overifierade.

Granskningen hittade två konkreta presentation-/navigationsproblem för nästa leverans: översikten använde en svagare verifieringsbedömning än detaljvyn, och dialogöppning från en sökträff saknade ett beständigt återgångsfokus. [Sökfyndet och dess regression](search-focus-review.md) är dokumenterade separat. Inget av dessa fynd gav en ekonomisk skrivning i produktion; demonstrationen använder fiktiva data.

Den vanliga inloggningslänken ledde till OpenAI:s inloggningsval och krävde användarens val av metod/uppgifter. Ingen hemlig uppgift efterfrågades eller angavs genom ett modelläsbart fält. Den autentiserade bankinställningen är fortfarande inte nådd.
