# Dataflöde: original → faktura → betalningsbevis → avstämning

## Dokumentintag

En behörig användare laddar upp ett dokument eller hämtar det genom ett giltigt Gmail-medgivande. Inmatningen begränsas i storlek och verklig filtyp. Företagskontexten etableras före läsning eller skrivning. Dokumentets original, källa och SHA-256 bevaras. Samma original får inte skapa nya fakturor genom upprepad import.

I Node lagras originalet i rätt SQLite-databas. Sites skriver originalet privat i R2 och metadata i D1. Köarbetet använder beständigt jobb-ID, lease, aktuellt företag och bounded retry. Ett processavbrott får lämna ett återhämtningsbart jobb, inte ett påhittat lyckat kvitto.

## Tolkning och validering

PDF-text läses först. Otillräcklig text leder till faktisk bildtolkning när rätt OCR-arbetare är tillgänglig. Fakturanummer, datum, belopp, moms, parter, referenser och rader bedöms tillsammans med sina källbelägg. Saknade fält, okända motparter och ekonomiska motsägelser går till granskning.

AI är ett valfritt steg. En avstängd eller felkonfigurerad AI ändrar inte möjligheten att köra befintlig OCR. Innan ett original får lämna servern krävs sekretess-/säkerhets-/kostnadsgodkännanden, rätt företag, bevarat original med verifierad hash, giltig input och en beständig budgetreservation. Avsändningen sker genom en gemensam Responses-adapter. Modellen kan inte själv ge behörighet eller betalningsbevis.

Efter anropet kontrolleras schema, källbelägg, beloppsrelationer, företag och aktuellt dokument igen. Resultatjournalen binder modellen, konfigurationen, originalet och användningskostnaden. Ett osäkert timeout-/nätverksutfall får inte leda till obudgeterad dubbelbehandling. Godkända tekniska AI-svar presenteras fortfarande som förslag för mänsklig granskning.

## Fakturaregistrering

Registrering går genom den befintliga fakturavalideringen och rätt företagsruntime. Bekräftelse i gränssnittet ersätter inte krav på original, identitet och ekonomisk rimlighet. Den konservativa befintliga automatregistreringen för kända entydiga underlag behålls; AI-förslag blir inte automatiskt gröna. Alla beslut bevarar audit och originalkopplingar.

## Bank- och Bankgirointag

Bankhämtning kräver aktuellt medgivande, rätt ägare/företag, valt godkänt konto och tillåtna scope. Bankens transaktions-ID, datum, belopp, referens och eventuella riktiga betalaruppgifter behålls med sin proveniens. Ingen läsadapter initierar en bankbetalning.

En Bankgirorapport måste komma från en konfigurerad och behörig rapportkälla eller en korrekt granskad import. Original, konto, rapportidentitet och totalsumma kontrolleras. Detaljer kan berika en samlingsinsättning först när de faktiskt kopplats till samma bankhändelse. `0599` får inte omvandlas till `599`; en generell referens får inte märkas som bankverifierad OCR utan rätt belägg.

## Förslag och finansiell commit

Läsande förhandsgranskning visar möjliga relationer. En föreslagen betalare, fakturakund och bankens verkliga betalare är olika uppgifter. Avstämningsmotorn kontrollerar belopp, uttrycklig referens, företag, konto, dokumentoriginal, bankoriginal och tidigare beslut. En blockerad bankanslutning eller motstridigt original får inte döljas av ett bra beloppsmatch.

Finansiella skrivningar görs atomiskt och med en sista kontroll av aktuell behörighet. Idempotens- och replaykontroller stoppar dubbla import-/allokeringsförsök. En återtagen koppling behåller sin audit och får inte återskapas automatiskt utan att dess spärr har hanterats på korrekt sätt.

## Presentation, backup och återhämtning

Gränssnittet visar registrerade saldon och aktuell verifieringsstatus separat. Det visar hämtningsstatus, köarbete och behov av granskning från faktiska serverkvitton. Administratörsdiagnostik är en behörig läsfunktion; den innehåller inga hemligheter och kan inte aktivera AI eller återauktorisera banken.

Backuper krypteras och verifieras mot sina frysta originalmanifest. En komplett backup bevisar inte att en återställning har testats. Isolerade återställningstester verifierar dataintegritet, referenser, företagsgränser och tokenkarantän. Produktions-RPO/RTO och verklig katastrofåterställning behöver egna uppmätta bevis.

## Felgränser

| Fel | Förväntat beteende |
|---|---|
| Saknad AI-nyckel/modell eller otillåten profil | Lokal app startar; befintlig OCR används; administratören ser konfigurationsstatus |
| Nekad budget eller saknat godkännande | Inget kundoriginal skickas till AI |
| Dokument/medlemskap ändras under jobbet | Senare skrivning avvisas och rätt återhämtningsstatus bevaras |
| Bankmedgivande löper ut | Återanslutning krävs; inga påhittade bankhändelser eller verifieringar |
| Bankgiro-källa saknas | Tydlig saknad källstatus; ingen automatisk rapporthämtning |
| Arbetare avbryts | Beständig kö och kvitton ger kontrollerad återhämtning; ingen falsk färdigmarkering |
| Port upptagen | Starten förklarar konflikten; inget främmande program stoppas |
| Databas finns men ursprungliga nycklar saknas | Setup stoppar och begär återställning av rätt privata konfiguration |

Källkomponenter och runtimegränser finns i [ARCHITECTURE.md](ARCHITECTURE.md). Aktuell, tidsbunden driftstatus hålls i leveransrapporten; diagrammet ersätter inte den.
