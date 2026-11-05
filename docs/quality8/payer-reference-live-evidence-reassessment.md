# Oberoende ombedömning av betalare och referens

2026-11-05. Läsbedömning av PLAN område 18–19 mot det sanerade kvittot i commit `f2e1ec28a6b09bb9225291b2ba2cd260ba1a4756`. Inga nya produktionsanrop, kundläsningar, tester eller ekonomiska writes utfördes i denna granskning. Den frysta `assessment-independent-candidate.json` lämnas oförändrad.

## Rekommendation

**Underlaget stöder villkorad 8/10 i både område 18 och 19 efter godkänd exakt leverans och efterkontroll av samma källpresentation. Det är ännu ingen ny slutlig produktionspoäng.** Kvarstående konto- och insättningsbevis hindrar att rapportuppgifterna tillskrivs AIS-insättningen eller används för en fakturakoppling. De kräver inte i sig under 8 för dessa två specifika presentationskriterier, så länge gränsen visas och upprätthålls.

| Område | Nytt relevant verkligt stöd | Begränsning som måste visas |
| --- | --- | --- |
| 18. Verklig betalare | Ägt rapportoriginal kontrolläst 22:27:49 UTC: en fullständig rad, betalaren finns och överensstämmer med den sparade rapportobservationen. Separata exakta betalningsläsningar 22:28:24 visar rapportens betalare och saknad individuell AIS-betalare. | Rapportens angivna betalare, inte en bankautentiserad betalare för AIS-insättningen eller bevisad fakturakund. |
| 19. Verklig OCR/referens | Samma original innehåller en uttrycklig referens som motsvarar den sparade rapporten. Rapportläsningen anger `structured`, betalningspresentationen generell `reference`; AIS-referensen är fortsatt `missing`. | Generell betalningsreferens, inte formell OCR, inte härledd från fakturanummer, sökträff eller manuellt förslag. |

Detta kompletterar kodgranskningens positiva och negativa källfall med en aktuell, faktisk originalobservation. PLAN 18 kräver att källtyp/bevisnivå syns, att befintlig betalare återges korrekt och att saknad uppgift förblir okänd. PLAN 19 kräver bevarad uttrycklig referens skild från förslag/fakturanummer samt kontroll av verkligt original. Ingen av raderna kräver att banken ska lämna ett individuellt fält som den aktuella AIS-posten saknar.

Den äldre kandidatens `remaining_for_8` lade dessutom på krav om bevisad konto-/rapportrelation. Det var för brett för just dessa två kriterier. Detta är en uttrycklig korrigering av bedömningens avgränsning, inte ett påstående att den nya integritetskontrollen har bevisat relationen.

## Villkor före slutlig höjning

1. Full obligatorisk CI ska vara grön för den kod som faktiskt publiceras, och den publicerade presentationen ska bindas till samma granskade källträd.
2. En avgränsad efterkontroll via ordinarie betalnings-/evidensvy ska behålla separata källor: rapportens värden visas med rapportens bevisnivå, AIS-fälten är okända och generell referens får ingen OCR-etikett.
3. `accountVerified: false`, `targetRelationProved: false`, ej ekonomiskt räknad rapport och noll bokade fakturakopplingar ska kvarstå om inget nytt separat behörigt bevis/beslut har tillkommit. Ett fältsteg `passed` får inte presenteras som ett godkännande av hela betalningen.
4. Integritetsförklaringen ska bevaras: kontrollsumma och storlek styrker det ägda originalets bytes, **inte bankens autenticitet**. `complete` och `snapshotCurrent` avser det avgränsade läsurvalet och arbetsytans revision 52, inte bankens fullständighet eller aktuell kontobehörighet.

Om dessa leverans-/presentationsvillkor inte uppfylls kvarstår bedömningen under 8 tills den konkreta bristen är stängd. Inget nytt bankmedgivande, verklig allokering eller verifierad rapport–AIS-relation behöver däremot skapas enbart för att bevisa korrekt visning i område 18–19. Dessa externa och ekonomiska krav kvarstår i sina respektive flöden.

## Underlag och granskningsgräns

- [PLAN](PLAN.md), gemensam regel och rader 18–19.
- [Färskt sanerat läskvitto](wave2-prepublication-observations.json), sparat före publicering på Site 63/main `bf24a3c`; SHA-256 `030858d677d2da75a36e71b3a08f0c8267595f9ae007d274c701829ba8c646a1`.
- `sites/lib/evidence-read.ts` vid `f2e1ec28`, särskilt `integrityMeaning` och ovillkorat `targetRelationProved: false`.
- [Oberoende käll-/översiktsgranskning](overview-evidence-independent-review.md) och [referensfixturernas negativa kontroller](invoice-candidates-ci-fixture-review.md).

Bedömningen använder roots sanerade, versionsbundna observationskvitto. Granskaren har inte själv läst privata original eller återupprepat produktionsanropen. En verifierad rapportobservation ger inte generell banktäckning och motiverar inte ett högre betyg än den avgränsade åttan.
