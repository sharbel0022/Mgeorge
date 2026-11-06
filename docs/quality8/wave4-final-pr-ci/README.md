# Förlustfritt bevarat CI-kvitto

Källa: `f488841afccdefba17a6b584320347581f60c3f4`. Originalrapporten och JSON-kvittona är byteidentiska med insamlarens underlag. De stora råloggarna är gzip-komprimerade utan informationsförlust; `storage-manifest.json` binder både ursprungsbytes och lagrade bytes.

[Originalrapport](REPORT.md) · [Maskinläsbart CI-kvitto](ci-receipt.json) · [Förvaringsmanifest](storage-manifest.json)

| Logg | Ursprungliga byte | SHA256 för ursprunget |
| --- | ---: | --- |
| [bankgiro_bridge-127695719110.log](logs/bankgiro_bridge-127695719110.log.gz) | 36951 | `b6b1095dc4452b614f046e41a79dad86fced9f59ea81b8ced1f63ebc0e6cd005` |
| [security_acceptance-127695718932.log](logs/security_acceptance-127695718932.log.gz) | 19837 | `84946943afbbe9871f8edab49bb3e588e2194228c431fd59a972bd7f222177b0` |
| [sites-127695718942.log](logs/sites-127695718942.log.gz) | 2236225 | `a485706db4e1a4cb6d33f87884b67dae432f41093096c92b1ae2934ebd532fd5` |
| [test-127695719068.log](logs/test-127695719068.log.gz) | 990590 | `28518562d10199d12bcb3fa6393ed188efba29a63a07a350b2b07da9d27cebb3` |

Originalrapportens loggnamn avser råfilerna. Använd gzip-länkarna ovan eller packa upp dem till dessa ursprungliga namn. `ORIGINAL-SHA256SUMS` är det oförändrade insamlingsmanifestet.
