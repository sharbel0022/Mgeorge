# Grenstädning med verifierad återställning

Hjälpskriptet tar bara bort uttryckligen angivna grenhuvuden som redan ingår i den exakta, godkända committen på `main`. Standardläget är en torrkörning. Skriptet sammanfogar ingen kod, skriver inte om main, tar inte bort arkivtaggar, kringgår inte grenskydd och tar inte bort sin egen körningsgren.

## Beställning av städning

Skapa `docs/cleanup/deletion-request.json` först när greninventeringen har granskats och det är bekräftat att kandidaterna inte längre används av medarbetare. Att en gren saknar en öppen PR bevisar inte att den är inaktiv. Hjälpskriptet kräver följande schema:

```json
{
  "version": 1,
  "execute": false,
  "expectedMain": "FULL_40_CHARACTER_LOWERCASE_MAIN_SHA",
  "knownActiveBranches": ["feature/95-saas"],
  "candidates": [
    { "name": "feature/completed-work", "sha": "FULL_40_CHARACTER_LOWERCASE_HEAD_SHA" }
  ]
}
```

Ersätt båda SHA-platshållarna med observerade, fullständiga commit-ID:n. Varje kandidatnamn får förekomma en enda gång. Lägg till alla andra aktiva grenar i `knownActiveBranches`. `main`, `feature/95-saas`, den utcheckade grenen och `release/cleanup-approved-20261107` är spärrade oberoende av den listan.

Utan `--execute` kontrollerar skriptet beställningen och registrerar besluten som `would-delete`, utan att skriva någon fjärrreferens. Ett manifest med `execute: false` ger också en torrkörning när flaggan anges. Om manifestet saknas utförs ingen städning.

```sh
node scripts/release/branch-cleanup.mjs --manifest docs/cleanup/deletion-request.json --output /tmp/mgeorge-cleanup-evidence
```

Autentiserade läsningar från GitHub använder den vanliga `GITHUB_TOKEN` som Actions tillhandahåller. Ingen personlig token, exporterad anslutningsuppgift, nytt beroende eller applikationshemlighet från produktionen behövs.

## Begränsad körning

Arbetsflödet reagerar endast på push till **`release/cleanup-approved-20261107`** och kan startas manuellt på samma gren. Jobbets villkor avvisar alla andra referenser och repositoryn; det finns ingen PR-utlösare. En manuell start med main eller en integrationsgren som vald gren kan inte köra jobbet. Skriptet kontrollerar dessutom självt vilket repository, vilken händelse och vilken exakt körningsreferens som Actions använder.

Arbetsflödet anger `--execute`, men radering kräver också att det utcheckade manifestet innehåller `execute: true`. Jobbet använder `contents: write` och `pull-requests: read` genom repositoryts vanliga token. Checkout behåller denna token för Git-transporten. Nekad åtkomst, otillgängligt tillstånd, saknad behörighet, grenskydd, tvetydiga API-svar eller misslyckad verifiering stoppar arbetet. Skriptet försöker inte kringgå spärrar eller byta till andra autentiseringsuppgifter.

För varje kandidat hämtar hjälpskriptet aktuella uppgifter om den exakta SHA:n för main och grenen via både GitHub och Git-transporten. Det läser samtliga sidor med öppna PR:er och kontrollerar både källgren och målgren, kräver uttryckligt `protected: false` och verifierar att kandidatens commit ingår i mains historik. En osäker kandidat stoppar hela omgången innan arkiv skrivs. Historiken måste styrka integrationen: verktyget tar inte bort osammanfogade grenar eller grenar vars ändringar endast bedömts vara innehållsmässigt likvärdiga.

## Återställning före radering

Varje exakt kandidatcommit får en deterministisk, annoterad tagg under `refs/tags/archive/branch-cleanup/`. Taggens sökväg innehåller hela commit-SHA:n och en SHA-256-summa av grenens namn. Taggar skickas utan tvångsuppdatering, läses tillbaka från fjärrrepositoryt och kontrolleras mot den exakta commit som taggobjektet pekar på. Befintliga taggar med motstridiga mål skrivs aldrig över.

När alla taggar är verifierade skapar skriptet `recovery.bundle`, verifierar den och återställer den i ett separat Git-repository utan arbetskopia (`bare`) och utan delning av lokala Git-objekt. Därefter kontrolleras varje kandidatcommit och återställningsreferensen för main, och `git fsck --full --strict` körs. SHA-256-summan och återställningskvittot skrivs före den första raderingen. De beständiga fjärrtaggarna kan användas för återställning även om körmiljön avbryts innan artefakterna laddas upp.

Omedelbart före **varje** radering upprepas kontrollerna av main, grenen, PR:er, skydd och historik. Git-raderingen använder uttryckligt `--force-with-lease=refs/heads/BRANCH:EXACT_SHA` och en tom källreferens. Denna spärr tillåter bara radering av just den angivna grenversionen; hjälpskriptet tvångsuppdaterar aldrig main eller någon annan gren. En samtidig uppdatering av grenen bevaras. GitHub fortsätter att tillämpa sina skydd på serversidan. Nya PR:er och ändringar av main kan inte låsas atomiskt tillsammans med en Git-radering. Verktyget begränsar därför tidsfönstret med färska kontroller och stoppar arbetet vid varje observerad förändring.

Körningsgrenen lämnas avsiktligt kvar. En återställningsgren kan bara tas bort om den uttryckligen anges och dess integration är styrkt. Den får samma beständiga arkiv och oberoende bundle-verifiering som alla andra kandidater.

## Bevis och återställning

`result.json` registrerar exakt beställda grenhuvuden, observerade kontroller, arkivreferenser, vilka grenar som raderades eller behölls och den slutliga fjärrinventeringen. `remaining-refs.json` registrerar separat de återstående grenhuvudena och arkivreferenserna. Arbetsflödet laddar upp båda filerna, `recovery-verification.json`, `recovery.bundle` och utdata från de fokuserade testerna med 90 dagars lagringstid. Arkivtaggarna är inte beroende av artefakternas lagringstid. Det isolerade, återställda repositoryt laddas inte upp, och ingen Git-konfiguration med autentiseringsuppgifter ingår.

En nedladdad bundle kan undersökas utan att det aktiva repositoryt ändras:

```sh
git clone --bare --no-local recovery.bundle recovered.git
git -C recovered.git fsck --full --strict
git -C recovered.git show-ref --tags
```

En repositoryansvarig kan senare återställa en arkiverad gren genom att skapa grenen vid den exakta commit som arkivtaggen pekar på. Återställningsbeslut och städning av körningsgrenen är separata åtgärder; hjälpskriptet utför aldrig någon av dem underförstått.

## Fokuserad verifiering

```sh
node --test test/branch-cleanup.test.js
```

Testerna använder isolerade lokala Git-repositoryn utan arbetskopia (`bare`) och ett simulerat API för läsning från GitHub. De utför verklig Git-arkivering, bundle-verifiering, återställning och radering med SHA-spärr mot syntetiska commits. Ingen GitHub-gren, produktionstjänst eller kunddata berörs.
