# Andra fulla PR 58-körningen: underkänd

Den exakta kandidaten `364232a393fe96257a2579aac77dfb8dcfb87999` har **7337/7349** godkända obligatoriska tester och **12 assertionsfel**. Node 2321/2321 och bridge 47/47 passerar; Sites 4969/4981. Sites produktionsbygge hoppades över. SaaS 1218/1218 är en separat överlappande population.

[Fullt originalkvitto](ci-receipt.json), [granskarens rapport](REPORT.md), [samtliga tolv felblock](sites-failure-blocks.json) och [exakt källbindning](source-verification.json) är kopierade utan ändrade byte. Kandidaten får inte mergas eller publiceras. Nuvarande produktion är Site 65.

Råloggarna lagras förlustfritt som gzip. [Lagringsmanifestet](storage-manifest.json) binder varje arkiv till den fulla avkodade loggens ursprungliga storlek och SHA256. Originalets SHA256SUMS ligger oförändrat i ORIGINAL-SHA256SUMS; dess loggvägar gäller efter dekomprimering. Alla elva originalfiler verifierades, och varje komprimerad logg dekomprimerades och jämfördes byte för byte. Ingen underkänd körning har ersatts av ett senare resultat.
