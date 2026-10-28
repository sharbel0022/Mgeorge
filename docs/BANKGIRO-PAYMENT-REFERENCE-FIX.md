# Bankgiro: betalningsreferens och avsändare

## Bekräftat från användarens två skärmbilder
Bankgiros webblista visar en individuell post med avsändare **Café Gränden Bistro AB**, betalningsreferens **0599**, fältet **Bankgironummer/Avinummer** och belopp **625,00 kr**. MG Fakturakoll visar för 26 oktober en Swedbank-samlingspost på **625,00 kr** med okänd betalare och bankens egen referens. Det är **inte verifierat** att bilderna representerar samma transaktionsunderlag: datum och kontokoppling måste jämföras.

## Denna kodändring
Node-CSV-importen känner nu igen rubriken `Betalningsreferens` och behåller `0599` som betalningsreferens. Testet kontrollerar att den inte förvandlas till bankens `bank_reference` och att avsändarnamnet bevaras. Koden hittar inte av sig själv uppgifter inne på Bankgiros inloggade webbplats.

**Import av bankunderlag måste fortsatt innehålla datum och belopp i en stödd CSV/camt-fil.** En skärmbild är inte en signerad transaktionsspecifikation, och tabellen i bilden saknar datumkolumn. Ingen banktransaktion eller fakturabetalning skapas från skärmbilden.

## Återstår i Sites
Sites är en separat kodbas och uppdateras **inte** genom att slå ihop denna PR:

1. Låt den befintliga importdialogen acceptera riktig Bankgiro-CSV/camt.054 med individuell avsändare och betalningsreferens, eller en uttryckligen granskad komplettering med datum och konto. Låt originalfilen följa med.
2. Förhandsgranska varje betalningsrad med avsändare, `betalningsreferens` (som `0599`), belopp och eventuell källa. Kontrollera att filens summa, datum, valuta och företagskonto motsvarar Swedbanks samlingsinsättning. Knyt barnposterna till den redan bokförda samlingsposten, **inte som extra pengar**.
3. Visa i detaljvyn tydligt skilda fält: bankens referens, betalarens betalningsreferens/OCR, avsändare och *möjligt* fakturanummer. `Bankgironummer/Avinummer` får inte förväxlas med företagskontots Bankgiro eller bankens transaktions-ID.
4. Om faktura 0599 inte är registrerad, håll posten som **betalaridentifierad men faktura saknas**, med länk till faktura-/Gmail-granskning. Slå inte ihop mot en annan faktura bara därför att beloppet är 625 kr.
5. Bekräfta matchning endast med tillräckliga oberoende bevis för kund, faktura, konto och original. Alla kundmejl kräver separat manuellt godkännande.
6. Testa med syntetiska CSV-/camt-filer för korrekt summa, fel datum, fel konto, två poster i samma samlingsinsättning, saknad referens, dubletter, faktura som saknas och omimport. Kör Workers/D1-tester och publicera först efter att de passerat.

Inga produktionsnycklar eller scheman ändras av denna PR.
