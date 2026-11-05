# Sökning: beständigt återgångsfokus efter dialog, 2026-11-05

Livegranskning av Site 63 i avskilt demoläge visade att sökning på `1003` kunde öppnas med pil ned och Enter. Fakturadialogen visade korrekt att den historiska fördelningen behövde granskas. Fortsatt öppning av bankhändelsen och Escape lämnade fokus på sidnivå. Sökresultatets knapp hade försvunnit när sökfrågan tömdes.

Källgranskningen bekräftade att `WorkspaceSearch` öppnade dialogen och rensade frågan utan att först flytta fokus från resultatknappen. `Dialog` försöker återställa sitt fångade öppningsfokus, men en borttagen resultatknapp är inte ett beständigt mål. Befintlig fallback till huvudinnehållet ger inte tillbaka användarens plats i sökningen.

Två nya regressioner använder den faktiska extraherade sökkomponenten, dess händelsehantering och lokala fokusgränser. En fakturaträff respektive en bankträff fokuseras före aktivering. Modalens öppningscallback ska observera det kvarvarande sökfältet som återgångsmål. Testfixturen återrenderar callbacken före aktivering; en första ofullständig fixturkoppling rättades innan den egentliga red-körningen. Den korrekta red-körningen gav **0/2** och visade `invoice-3` respektive `bank-2` i stället för inmatningsfältet.

Aktivering använder nu samma befintliga stängning av sökresultat som Escape, inklusive fokus på sökfältet, före öppning av exakt valt objekt. Inga sökregler, bankfakta, fakturor eller bokningar ändras. **Hela sökkomponentfilen passerar 16/16**, inga överhoppade, på 908,554 ms med Node 24. Den nya fokusvägen behöver dessutom återobserveras i den publicerade versionen. Dessa komponentprov ersätter inte en webbläsarkontroll.

Den publicerade kombinationen `1003 3 200,00 11/10/2026` gav exakt faktura 1003 på 3 200,00 kr. Testet gjordes med fiktiva demodata. Produktens verkliga kunduppgifter lästes inte i webbläsaren.
