# Åttatimmarsarbete – cykel 1A: verifierad Node-leverans

## Omfattning och resultat

Utgår från `c519eef47e5a084a35db7675a2553a554c55ec4c`, hämtad igen före integration. Uppdraget startade 2026-10-30 15:31:15 UTC med senaste stopp 23:31:15 UTC. Arbetet fortsätter; detta är en delleverans, inte en slutrapport eller ett uppnått 9,5-mål.

Node-rättningarna verifierades i en separat checkout med exakt den kod som ingår i denna leverans. Sites-koden i denna commit är oförändrad från startcommitten. De parallella Sites-rättningarna publiceras först efter egen oberoende granskning och slutkontroll.

## Rättade fel

1. **Stödoriginal för inlärd betalare:** en äldre allokering får inte längre lära upp andra betalningar om dess original saknas, är ändrat, har bankkonflikt, återbetalnings-/återföringsklassificering eller en återtagen automatisk koppling. Tidigare allokeringar och uttryckliga separata motpartsbeslut bevaras.
2. **Samlingspost och individrapport:** endast en verklig dokumenterad komplettering förklarar senare återspelning av en samlingspost. Ett godtyckligt XML-original räcker inte. Även en komplettering i samma databasrad behåller tidigare återbetalnings-/återföringsrestriktioner via den bevarade revisionshändelsen.
3. **Ärvda original och konflikter:** alla överordnade samlingsposter ingår i originalkontrollen, även när de redan undantagits ekonomiskt. Saknat original eller återbetalnings-/återföringsunderlag får inte släppa igenom barnets automatmatchning.
4. **Avvisad import:** motstridiga originalbytes, hash, filnamn, MIME och felorsak behålls efter rollback utan att en del av importens ekonomi skrivs. Upprepade försök är idempotenta; nya original kan knytas till samma konflikt.
5. **Ångrad koppling:** en beständig automatspärr gör att nästa avstämning inte omedelbart återskapar kopplingen. Den överlever omstart och återimport. Ett uttryckligt manuellt beslut måste fortfarande uppfylla övriga ekonomiska kontroller.
6. **Rätt kontoomfattning och CSV:** bank-ID jämförs inom konto; misstänkta kopior mellan konton kontrolleras med icke-tom betalare/referens. Den verkliga CSV-routens `text/csv; charset=utf-8` verifieras med normaliserad medietyp, utan att originalets MIME eller bytes skrivs om.
7. **Föråldrad kontroll av utebliven betalning:** konflikter och avvisade bankunderlag gör tidigare negativa slutsatser inaktuella. Betalda fakturor och befintliga delbetalningar bevaras, och tidigare kontrolluppgifter finns kvar i audit.
8. **Exakta fakturanummer:** dubblettkontrollen bevarar skiljetecken och nollprefix; exempelvis `AB-0594` och `AB0594` slås inte ihop.

Regelversion: `verified-reference-2026-10-30.3`. Databasändringen är additiv: `bank_transactions.automatic_match_hold`. Ingen destruktiv migrering ingår.

## Exakta slutgrindar för denna delleverans

| Kontroll | Resultat |
| --- | --- |
| Node installation | `npm ci --ignore-scripts`, exit 0 |
| Node syntax | 65 JavaScript-filer, exit 0 |
| Node full svit | **407/407**, 0 fel, 0 överhoppade |
| Sites installation | `npm run install:ci`, exit 0 |
| Sites TypeScript | `tsc --noEmit`, exit 0 |
| Oförändrad Sites full svit | **456/456**, 0 fel, 0 överhoppade |
| Båda beroendegranskningarna | **0** sårbarheter i samtliga allvarlighetsklasser |
| Sites produktionsbygge | Exit 0, `Build complete` |
| Oberoende avgränsad Node-granskning | Inga kvarstående Critical/Important-fynd i den granskade ändringen |

Totalt **863 godkända tester**. De nya bankfilerna innehåller 28 regressioner/positiva kontrollfall; två dokumentfall låser fakturanumrens skiljetecken. Detta är en ny körning i den isolerade leveranscheckouten, inte sammanblandning med den pågående Sites-sviten på 511 tester. Källornas hashvärden finns i `QUALITY-8H-NODE-CYCLE1.json`. GitHub-commit och Actions-resultat registreras efter faktisk push.

Alla utvecklingsdata var syntetiska. Den riktiga CSV-routen testades genom lokalt HTTP mot en tillfällig databas. Inga riktiga betalningar eller kundsändningar utfördes. Befintliga fakturor, bankoriginal och allokeringar raderades inte.

## Produktion och fortsatt arbete

Senaste verifierade Sites-publicering är fortfarande **32**. Denna Node-commit är ingen ny Sites-publicering och innebär inte att dess Node-regler har körts i den publicerade Sites-appen. Aktuell läsande status visar dagens backup 191/191 och bankhämtning 14:09:57 UTC. Gmail är stale med senaste lyckade hämtning 29 oktober 15:00:48 UTC; det externa schemat är pausat och förblir pausat.

Nästa leverans omfattar Sites original-/konfliktspärrar, OCR-köns original- och leasegränser och tillgänglig mobilnavigation. Fyra ytterligare Sites-fel hittades i oberoende granskning och rättas/verifieras separat före publicering.

Nästa utvecklingscykel har redan reproducerade fel: backup som slutförs trots en skadad tidigare kopia, Node-backup som bara verifierar databasstruktur, bortglömda accepterade kontroll-ID:n, lease som löper ut under väntan på skrivlås, samt registrering som lyckas men felrapporterats efter ett senare avstämningsfel. Dessa är öppna brister; ingen grön svit får dölja dem. Se aktuell 33-områdesdelta i `QUALITY-SCORECARD.md`.
