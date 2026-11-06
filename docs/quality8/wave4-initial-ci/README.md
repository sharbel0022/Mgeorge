# Första fulla CI på PR 58 — underkänd och bevarad

Exakt head `d4c0d624b3316fd7ce53381e344e0ce01307966f`, träd `a41b8d47f9c29724a8c75dd4eba18831a5ecaab5`. Payment control checks 42145805181 underkänd: Node **2312/2321**, Sites **4761/4775**, inga avbrutna eller överhoppade testfall. Det separata bridgejobbet och SaaS security acceptance 42145805217 passerade. Sites-bygget i CI startades inte efter testfelet.

Alla 23 felblock, exakta jobb-ID:n, råloggarnas SHA256 och gzip-hashar finns i [evidence.json](evidence.json). Råloggarna är komplett bevarade som deterministisk gzip. Inga förväntningar har ändrats i detta kvitto.

Felen gäller organisationsnummernas ogiltiga/upprepade förekomster, legitima normalfall, manuell fakturakorrigering och fem referensläsningar. Orsaker undersöks och rättas innan nytt fullständigt försök. Grön riktad granskning och 129 integrerade tester ersätter inte denna helgrind. Varken merge till main eller Sites-publicering gjordes på denna underkända kandidat. Ett lokalt förberett native-paket blev inte publicerat.
