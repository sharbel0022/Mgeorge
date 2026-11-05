# Mgeorge: minst 8/10 i samtliga 33 områden

Start: 2026-11-05. Utgångspunkt: `4ad205b84d1852ec7ed33cabd70fdadbe2f9d5c5`, Sites version 62.

Användaren har uttryckligen bett om arbete med hela systemet och gett mandat att genomföra det självständigt. Målet gäller varje område, inte ett avrundat medelvärde. Den tidigare poängsumman är 255/330 (7,73); den är historisk och bevisar inte aktuell drift.

## Gemensam bedömningsregel

8/10 kräver ett användbart normalflöde, relevanta fel- och gränsfall, inga kända fel som riskerar pengar, original eller åtkomstgränser, samt spårbara verifieringsresultat för den kod som levereras. Funktioner som beror på externa tjänster behöver dessutom aktuell driftobservation. En konfigurationsflagga, tom lyckad körning eller syntetiskt test är inte bevis för verklig bank-, Gmail- eller OCR-drift. Ett område får kvarstå under 8 om den relevanta observationen saknas. Betyg, antal godkända områden och medelvärde ska beräknas från samma tabell.

Syntetiska korpusar och negativa fall fryses före mätning. Testförväntningar får inte försvagas för att förbättra resultat. Mätningar ska ange population, täljare/nämnare, miljö, tid och begränsningar. Nya bankfakta kräver bankkälla; manuella uppgifter eller matchningsförslag får inte uppgraderas till bankbevis.

## Acceptanskriterier per område

| Nr | Område | Tidigare | Krav för minst 8 i denna cykel |
|---|---|---:|---|
| 1 | Design | 8 | Läsbara huvudvyer, tydlig informationshierarki och fungerande fel-/tomlägen; visuell kontroll av berörda vyer. |
| 2 | Startsida | 8,5 | Sammanfattningar motsvarar källdata; okänd och föråldrad status visas korrekt. |
| 3 | Navigation | 8,5 | Centrala arbetsflöden kan nås och lämnas med tangentbord och tydliga länkar. |
| 4 | Mobil | 8,5 | Berörda huvudflöden fungerar vid 320, 390, 768, 1024 och 1440 px utan blockerande överlapp. |
| 5 | Sök/filter | 7,5 | Kombinerade filter, svenska belopp/datum, referenser och tomträffar fungerar på båda implementationerna; relevanta prestandamätningar. |
| 6 | Minimal manuell hantering | 6,5 | Säkra normalfall går igenom den avsedda kön; avvikelser har konkreta granskningsskäl och återupptagning; verklig köprogress observeras. |
| 7 | Kundfakturor | 8 | Skapa, kontrollera och visa fakturor utan felaktiga betalstatusar eller ägarblandning. |
| 8 | Leverantörsfakturor | 8 | Belopp, datum, motpart och original bevaras med samma gränser och kontroller som kundflödet. |
| 9 | PDF | 8 | Text- och bild-PDF hanteras, sid-/storleksgränser gäller och trasiga dokument stoppas begripligt. |
| 10 | Bild-OCR | 7 | Fryst representativ rasterkorpus samt separata hållna fall; minst 85 % återfunna obligatoriska fält och minst 98 % fältprecision, utan felaktigt grönt ekonomiskt kritiskt fall. Redovisa även dokumentnivå och svåra fall. |
| 11 | Gmail | 7,5 | Aktuell lyckad hämtning, återförsök/dubblettskydd och synligt genomfört schema; inga mejl skickas av bakgrundsflödet. |
| 12 | Automatisk registrering | 8 | Endast verifierad motpart och grön tolkning; atomär idempotens och återhämtning efter förlorat svar. |
| 13 | Dubbletter | 8 | Samma original eller betalning kan inte dubbelräknas vid omkörning eller samtidighet. |
| 14 | Dokumentgranskning | 8 | Original och osäkerhet kan granskas; korrigering påverkar rätt dokument och lämnar spår. |
| 15 | Swedbank | 8,5 | Aktuell godkänd anslutning och verifierad läsning av rätt valt konto; utgångna/återkallade medgivanden stoppas. |
| 16 | Automatisk bankhämtning | 8 | Aktuell genomförd körning med befintligt samtycke, hållbara återförsök och korrekt nästa tid. |
| 17 | Bankgiro-import | 8,5 | Stödda originalformat bevaras och tolkas spårbart; manuell import och automatisk källa redovisas separat. |
| 18 | Verklig betalare | 7 | Källtyp och bevisnivå syns, korrekt betalare visas när bankunderlaget har den, saknad uppgift hålls okänd; verkligt underlag verifieras utan antaganden. |
| 19 | Verklig OCR/referens | 7 | Bankens explicit angivna referens bevaras skild från förslag och fakturanummer; verkligt original verifieras. |
| 20 | Automatisk matchning | 7,5 | Representativ separat acceptanskorpus med noll falskt säkra kopplingar, tydliga orsaker till avstående och atomärt idempotent resultat. |
| 21 | Delbetalning | 8 | Exakta heltalsören, korrekt restbelopp, återtag och samtidighetskontroller. |
| 22 | Överbetalning | 8 | Överskott särskiljs och kan inte automatiskt fördelas utan giltig grund. |
| 23 | Flera fakturor per betalning | 7,5 | Verifierade explicita fördelningar fungerar; tvetydiga delmängdssummor avstår; summor och samtidighet är säkra. |
| 24 | Historik | 8 | Källor och ändringar kan följas utan att förväxla tidigare och aktuella fakta. |
| 25 | Betalstatus | 8 | Status beräknas från giltiga allokeringar och tillgängliga bankfakta; inaktuella resultat markeras. |
| 26 | Kontrollera alla betalningar | 8 | Begränsad, återupptagbar körning med korrekt sammanfattning och felhantering. |
| 27 | Mejlförslag | 8 | Korrekt underlag och förhandsgranskning; uttryckligt godkännande krävs före sändning. |
| 28 | Schemaläggning | 6,5 | Befintliga scheman fungerar och minst en faktisk körning observeras; överlapp, paus och sen körning hanteras; ingen grön status från enbart konfiguration. |
| 29 | Backup | 7,5 | Aktuell krypterad backup är fullständigt kontrolläst; filantal, originalhashar och slutförandetid redovisas. |
| 30 | Säkerhet | 8,5 | Ägar-/företagsgränser, sekretess, godkännanden och ekonomisk integritet bevaras; relevanta negativa tester och beroendegranskning. |
| 31 | Katastrofåterställning | 5,5 | Isolerad återställningsövning med faktisk backup-/restore-kod, mätt RPO/RTO och kontroller av original, register, betalningar, korruption och fel ägare. Ingen återställning över produktion. |
| 32 | Kod/tester | 8,5 | Berörda regressioner, oberoende granskning och fulla obligatoriska CI-grindar på exakt levererad kod. |
| 33 | Verklig produktionsverifiering | 6,5 | Levererad version kopplas till exakt källträd; bank/Gmail/OCR/backup har relevanta aktuella observationer och ekonomiska skydd jämförs före/efter. |

## Arbetsordning och ansvar

1. Root bevarar utgångspunkten, granskar bank/schemaläggning och verifierar det samlade gränssnittet.
2. Dokumentspåret förbättrar mätbara extraktionsfel utan att ändra säkerhetskraven för grön faktura.
3. Betalningsspåret förbättrar sökning, bevispresentation och entydiga flerdelade betalningar utan att fabricera bankfakta.
4. Återställningsspåret slutför befintlig krypterad backup och genomför isolerad återställningsövning.
5. Varje spår levererar lokal commit, relevanta negativa tester och en bevisrapport. Root integrerar, granskar oberoende, kör obligatoriska grindar och publicerar befintlig Site genom normalt versionsflöde.
6. Produktionskontroller genomförs med minsta nödvändiga påverkan. Kundmejl och betalningar skickas inte. BankID eller nya bankmedgivanden kräver kontoinnehavarens faktiska medverkan.
7. Slutbedömningen uppdaterar scorecard och PROGRESS med faktiska resultat, exakta versioner och kvarstående beroenden. Målet rapporteras uppnått först när alla 33 rader har tillräckligt stöd.

## Kända begränsningar vid start

### Förtydligande av OCR-populationen före ny formatkorpus

Den äldre rastermätningen omfattar även ett avsiktligt förstört 25×25-prov. Hela dess ursprungliga utfall (96,67 % precision, 70,73 % recall) ska bevaras och redovisas. Den bilden är en kontroll av säkert avstående; förlorad text får inte gissas eller byggas in från facit. Den separata nya korpusen fryses före fix och rapporterar läsbara normalfall och oläsbara stressfall var för sig. 85/98-gränsen avser läsbara, stödda fakturaunderlag; stressfallen måste avstå från grön registrering. En höjning behöver bredare evidens än den gamla korpusen ensam, och den gamla totalsiffran får inte döljas genom att väga in fler enkla prov.

Banken står i återauktorisering efter en tidigare kontovalidering. Den senaste lyckade bankhämtningen är 2026-11-05 09:05 svensk tid. Ett framtida utgångsdatum räcker inte för att förklara medgivandet giltigt. Gmail hämtade underlag 17:19 men det externa schemat är pausat. Moln-OCR:s senaste kontakt är 11:45 och nya dokument väntar. Dagens backup har 362 kopierade men endast 35 kontrollästa original. Dessa observationer ska ersättas med färska slutresultat, inte återanvändas som godkännanden.
