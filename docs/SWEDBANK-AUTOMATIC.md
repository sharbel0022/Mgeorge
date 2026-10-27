# Automatisk Swedbank-hämtning

Publicerad som Sites version 12, commit `36f2cb7c481ef40b55decb8121cc7e7e95eddc01`, deployment `appgdep_6ae106a468408191ab32e13cbd946ef9`, runtime-revision 3. Migrationsfilen lägger endast till ägarbundna inställningar och körningstider; befintliga bankmedgivanden och händelser bevaras.

## Funktion

- Automatisk hämtning är ett sparat val för den inloggade användarens befintliga bankanslutning. Den är aktiverad för den aktuella anslutningen enligt användarens begäran och kan pausas på `/bank`.
- Det länkade molnschemat **Uppdatera Swedbank i MG Fakturakoll** är sparat och aktiverat för 03:06, 09:06, 15:06 och 21:06 i `Europe/Stockholm`. Hemsidans privata MCP-verktyg används, med Sites autentiserade användaridentitet. Ingen lokal dator eller öppen webbläsare ska behövas för molnkörningen. Sparat schema bevisar inte i sig att en framtida körning lyckas.
- När sidan är öppen kontrolleras automatiken och sparade data vid fokus samt var femte minut. Banken kontaktas endast när den sparade hämtningsperioden är aktuell. Pågående formulär, sparningar och demoläge avbryts inte.
- Nästa automatiska försök reserveras till nästa fasta klockslag i Stockholm före bankanropet. Sidbesök och fördröjda körningar flyttar inte schemat. Sommar- och vintertid hanteras uttryckligen och är testade. Serverlåset stoppar samtidiga körningar och återspelade uppgifter. Ett fel ger ingen snabb återförsöksloop.
- Hämtningen överlappar den senaste lyckade hämtningen med tre dagar för sent bokförda händelser. Användarens valda tidigaste startdatum respekteras. Beständig kontoidentitet och bankreferens används för dubblettkontroll.
- Bakgrundskörningen skickar inga påhittade PSU-IP-adresser eller webbläsaruppgifter. En faktisk webbläsarkörning kan skicka sin riktiga, betrodda användarkontext. Bankmedgivande, valda SEK-konton, bokföringsstatus och ägargränser kontrolleras vid varje hämtning.
- Utgånget eller återkallat medgivande stoppar importen och kräver personlig förnyelse. Frånkoppling stänger också av automatiken. Inga betalningar eller automatiska fakturamatchningar införs.

## Gränssnitt och verifiering

Den publicerade hemsidan genomförde en riktig automatisk bankhämtning vid sidöppning, utan klick på hämtningsknappen. Inga nya dubbletter lades till. Inställningen, senaste hämtning och nästa planerade försök kan läsas tillbaka i den autentiserade bankvyn.

Molnschemats första körning slutfördes på en separat molnvärd och anropade både `bank_auto_sync` och `bank_auto_sync_status`. Hemsidans privata molnanslutning verifierades även direkt med en verklig bankhämtning utan webbläsarens PSU-kontext. Hämtningen lyckades utan nya dubbletter. Den sparade tidpunkten, nästa fasta körning och avsaknad av fel lästes tillbaka genom molnverktyget. Ett upprepat anrop före nästa tid gav `not_due` utan en ny bankhämtning.

`POST /api/bank/automatic` ändrar endast den autentiserade användarens inställning, med exakt origin och anslutnings-ID. `POST /api/bank/auto-sync` gör en förfallen automatisk hämtning. MCP-verktygen `bank_auto_sync` och `bank_auto_sync_status` accepterar inga ägar-, konto-, hemlighets- eller force-parametrar; deras ägare kommer enbart från Sites OAuth-identitet.

94 Sites-tester, TypeScript och produktionsbygget är godkända. Tillsammans med Node-versionens 123 tester omfattar verifieringen 217 tester. Nya tester täcker opt-in, främmande ägare, origin, verklig respektive utelämnad PSU-kontext, privata MCP-anrop, fel/backoff, överlappande datum, dubbletter och frånkoppling. Node-versionens granskning har även verifierat skydd för äldre importidentiteter och tömning av privat klientstate efter förlorad inloggning.

[Patch version 10→12](sites/swedbank-automatic.patch). [Aktuell produktionsstatus](SWEDBANK-PRODUCTION-STATUS.md).
