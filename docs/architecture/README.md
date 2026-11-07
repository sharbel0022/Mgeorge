# Arkitektur – börja här

MG Fakturakoll har två riktiga körmiljöer: den lokala Node-appen och den publicerade Sites-appen. De delar flera rena regler och hela AI-kärnan, men har **separata databaser och olika identitetsingångar**.

- [Arkitektur och svar på de 14 orienteringsfrågorna](ARCHITECTURE.md)
- [Dataflöde från original till avstämning](data-flow.md)
- [Produktionsdiagram, SVG](architecture.svg)
- [Produktionsdiagram, redigerbar Mermaid](architecture.mmd)
- [Lokal körmiljö, Mermaid](local.mmd)
- [Moduler och offentliga API:er](../../packages/README.md)
- [Start och felsökning](../operations/local-start.md)
- [OpenAI-konfiguration och godkännanden](../integrations/openai.md)

Diagrammen beskriver källkodens komponenter. En ritad extern integration betyder att koden har en anslutningspunkt; faktisk behörighet, modellåtkomst, schemakadens och produktionsacceptans kräver egna verifieringskvitton. Aktuell leveransstatus finns i [acceptansrapporten](../cleanup/ACCEPTANCE.md).

Vid kodändringar: följ den offentliga ingången först, läs sedan implementationen. Gemensamma regler kräver tester i båda runtime-miljöerna. Lägg inte företagsdata eller nycklar i dokumentationen.

## Återskapa SVG

Kör `node scripts/architecture/render.mjs` från root med Graphviz `dot` installerat. Renderaren läser samma namngivna noder, riktade kanter och etiketter som `architecture.mmd` och avslutar vid syntax som den inte stöder. SVG-layouten görs av Graphviz; Mermaid-filen förblir redigerbar och kan även visas av en Mermaid-kompatibel läsare. Denna lösning kräver ingen webbläsarprocess.
