# MG Fakturakoll – förenkling och konsolidering

## Uppdrag och bas

Användarens fullständiga instruktion är bifogad i arbetskonversationen (2026-11-07). Den tillåter självständigt genomförande, vanlig PR/merge efter godkända obligatoriska kontroller och säker arkivering/rensning av inaktuella brancher. Produktionsdata, sekretessgrindar och pågående arbete ska bevaras. Aktuell hämtad bas är `4c7b210a0553314c2d9ce95804b892b891f4fe36`; PR 63 är redan mergad. Historiska rapporter är inte färska verifieringsresultat.

## Arkitekturbeslut

Vi behåller de två faktiska körmiljöerna: fristående Node med SQLite, statiska `public/`-filer och lokal OCR samt Sites/Vinext/React/Workers med D1/R2. Ett fullständigt filflyttningsprojekt skulle skapa onödiga leveransrisker. I stället införs tydliga offentliga domäningångar, tunna kompatibilitetsadaptrar och ett dokumenterat beroendekontrakt. Befintliga skydd och tester följer med. Sites måste kunna byggas från sin fristående källrot.

AI:s gemensamma implementation finns redan i `sites/lib/openai-invoices/` och används av Node. Den får ett stabilt offentligt API, exponerat också via `packages/ai/index.js`. Runtimeadaptrar behåller databas- och behörighetskontroller. Modellen väljs i serverkonfiguration; saknad eller ogiltig konfiguration ger befintlig OCR. Kundoriginal skickas endast efter befintliga sekretess-, säkerhets-, kostnads- och företagsgodkännanden. Budgetar och modellkostnadsantaganden ska vara beständiga och försiktiga.

`npm start` startar den självförsörjande lokala Node-appen med dess befintliga frontend och dokumentarbetare. Ingen separat frontendprocess behövs för den körmiljön. Sites behåller eget explicit lokalt dev-/byggflöde. Launcher kontrollerar versioner, installerar låsta lokala beroenden vid behov, skapar en säker förstagångskonfiguration, verifierar ledig port, kontrollerar verklig HTTP-beredskap och äger sin processlivscykel. Befintliga databaser får aldrig nya krypteringsnycklar automatiskt. `stop` får bara påverka en autentiserad launcher i samma checkout.

## Krav och verifiering

Node 22.23.4 och 24.22.1, Sites fulla svit, brygga, typ-/syntaxkontroll, byggning, beroendeaudit, säkerhetsacceptans, syntetiska 1/10/100 företag och Chromium ska verifieras. Launcher provas med ren installation, saknad .env/AI-nyckel, ogiltig modell, upptagen port, Ctrl+C, stopp och omstart. Nya beteenden får meningsfulla regressionstester. Ekonomisk och sekretessrelaterad testtäckning får inte försvagas.

Slutlig kod granskas oberoende och exakt slut-PR och nya main kör obligatorisk CI. En lyckad GitHub-merge är inte Sites-publicering eller externt produktionsgodkännande. Brancher kan bara raderas enligt en färsk, SHA-bunden inventering, verifierat återställningsarkiv och frånvaro av aktivt arbete. Skydd och samtidigt ändrade brancher lämnas kvar. Alla kvarstående externa hinder och alla 33 kvalitetspoäng redovisas utan uppblåsta anspråk.
