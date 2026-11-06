# Förlustfritt bevarat CI-kvitto

Källa: `0035ea89ef3cd60f0924f901503cad00d1ab1fca`. Originalrapporten och JSON-kvittona är byteidentiska med insamlarens underlag. De stora råloggarna är gzip-komprimerade utan informationsförlust; `storage-manifest.json` binder både ursprungsbytes och lagrade bytes.

[Originalrapport](REPORT.md) · [Maskinläsbart CI-kvitto](ci-receipt.json) · [Förvaringsmanifest](storage-manifest.json)

| Logg | Ursprungliga byte | SHA256 för ursprunget |
| --- | ---: | --- |
| [bankgiro-bridge-127698704025.log](logs/bankgiro-bridge-127698704025.log.gz) | 35875 | `d8220970d547c401ee52b6514c187b358c103ab1536b1174387e67d623f3c25d` |
| [node-127698704223.log](logs/node-127698704223.log.gz) | 989607 | `e9f323a9917b0c9c59aa181f43a1ba5058781672a6634ea8ff34a88514c9d525` |
| [sites-127698703819.log](logs/sites-127698703819.log.gz) | 2233824 | `c75d97d4701ceb952cac34d461e73bcbebe340297027daf0905e4fd3ac0e361f` |

Originalrapportens loggnamn avser råfilerna. Använd gzip-länkarna ovan eller packa upp dem till dessa ursprungliga namn. `ORIGINAL-SHA256SUMS` är det oförändrade insamlingsmanifestet.
