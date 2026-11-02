# Utvecklingsberoenden – verifierad kompatibilitetsgräns

2026-11-02, efter kodleverans2410e4b/Sites54. Undersökningen ändrade inga paket, låsfiler, produktionsinställningar eller kontroller. Registryversioner kontrollerades2026-11-02T16:34Z; isolerade API-prober kördes utanför repositoryt med Node22.

## Kvarstående fynd

Full Sitesaudit visar16moderate-poster från en advisory och dess beroendekedjor, inte16olika fel. Två installerade minimatchkopior är3.1.5 och10.2.5. Den officiella versionsgränsen är `<11.0.1`, med rättning i11.0.1. Root- och Sites-produktionsaudit har0fynd. [Officiell advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249).

Den beskrivna attackvägen använder angriparstyrda globmönster och hög optimeringsnivå. Inga granskade direkta konsumenter anger den nivån; applikationskatalogerna importerar inte minimatch direkt. Det avgränsar observerad exponering men är inget undantag från advisoryns publicerade intervall. Fynden lämnas öppna.

## Faktisk beroende-/API-gräns

| Konsument | Installerad minimatchyta | Observerad gräns mot11 |
| --- | --- | --- |
| ESLint9, config-array, eslintrc |3.1.5, klassanrop och delvis ESM-default | Små CJS-klassprov fungerade; ESM-default saknas i11. |
| eslint-plugin-import2.32.0 |3.1.5 som anropbar export; även makeRe | Verkliga regler kastar med11; makeRe är borttaget. |
| eslint-plugin-react7.37.5 |3.1.5 som anropbar export | Verklig no-danger-regel kastar med11. |
| eslint-plugin-jsx-a11y6.10.2 |3.1.5 via defaultinteroperabilitet | Verklig label-regel kastar med11. |
| typescript-estree8.59.3 |10.2.5 via named minimatch | Smalt named-anrop och faktisk typad parser fungerar; detta löser inte3-kedjorna. |

Minimatchs egna ändringsloggar beskriver övergången till named exports och senare borttagning av regexrelaterade API:er. En global versionsoverride är därför mer än en säker patch. [Version9](https://raw.githubusercontent.com/isaacs/minimatch/v9.0.0/changelog.md), [version11.0.4](https://raw.githubusercontent.com/isaacs/minimatch/v11.0.4/changelog.md).

Isolerat prov med de verkliga installerade lintreglerna: baseline kördes utan kast; ersatt minimatch11.0.4 gav fyra regel-TypeErrors samt ett separat ESM-default-importfel. Klassbaserad filvandring/config och faktisk parseForESLint med allowDefaultProject passerade små positiva kontroller. Dessa prober fastställer konkreta kompatibilitetsfel, inte att varje10→11-anrop är trasigt eller att en hel modifierad installation har verifierats.

## Aktuella officiella versioner

- [ESLint10.14.0](https://registry.npmjs.org/eslint/10.14.0) kräver minimatch^10.2.6; enbart uppgradering till10 löser inte advisoryn.
- [config-array0.23.5](https://registry.npmjs.org/%40eslint%2Fconfig-array/0.23.5) kräver^10.2.4 och [eslintrc3.3.7](https://registry.npmjs.org/%40eslint%2Feslintrc/3.3.7) kräver^3.1.5.
- De aktuella [import](https://registry.npmjs.org/eslint-plugin-import/2.32.0)-, [react](https://registry.npmjs.org/eslint-plugin-react/7.37.5)- och [jsx-a11y](https://registry.npmjs.org/eslint-plugin-jsx-a11y/6.10.2)-pluginerna kräver fortfarande3-kedjan och deklarerar högstESLint9 som peer.
- [typescript-estree8.72.1](https://registry.npmjs.org/%40typescript-eslint%2Ftypescript-estree/8.72.1) behåller^10.2.2; [eslint-config-next16.4.4](https://registry.npmjs.org/eslint-config-next/16.4.4) tillför ingen komplett stödd11-kedja.

ESLint9 är dessutom utanför sin officiella supportperiod sedan2026-08-06. Att enbart gå till maintenance9.39.5 löser varken stödet eller minimatchintervallet. [Officiell supportmatris](https://eslint.org/version-support/), [registrymetadata](https://registry.npmjs.org/eslint/9.39.5). Det öppna [uppströmsärendet21463](https://github.com/eslint/eslint/issues/21463) är inte en publicerad kompatibilitetsgaranti.

## Beslut och fortsättning

Ingen publicerad, av hela kedjans egna dependency-/peerintervall accepterad och underhållen helhetslösning verifierades. Inga regler stängs av, inget auditkrav sänks och inga brytande nedgraderingar eller generella overrides används för ett missvisande nollresultat. En lyckad produktionbuild ersätter inte prov av lintreglernas API.

Nästa steg är en publicerad kompatibel helkedja eller en separat ägd verktygsmigrering/fork med ersatta import-/regexanrop, tydligt underhållsansvar och full Windows-/Linux-/glob-/typ-/regelverifiering. Kontrollera därefter exakta peers/lockfiler och projektets samtliga CI-grindar. Nuvarande16moderate-fynd och supportbegränsningen kvarstår; inga kvalitetspoäng höjs av denna skrivskyddade undersökning. Detaljerade prober/registryunderlag är beständigt sparade privat utanför Git.
