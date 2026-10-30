# Cykel 1B – faktisk publicering och produktionskontroll

**Sites-version33 är publicerad med status succeeded.** Leveransen finns på [main02d1f84](https://github.com/sharbel0022/Mgeorge/commit/02d1f84a18c1113f9e68641c384e1cef766f9558); båda jobben i [Actions41092098871](https://github.com/sharbel0022/Mgeorge/actions/runs/41092098871) lyckades på exakt denna SHA. Arbetet fortsätter inom samma åttatimmarsbudget.

## Käll- och driftbevis

GitHub-trädet `a624df8ebf9591fb15e77c27f7b00db849ca2cb8` matchade den isolerat testade kandidaten. Samtliga273 spårade Sites-filer jämfördes byte för byte mot den källcheckout som byggdes och pushades till befintligt Sites-projekt. Den separata Sites-källcommitten är `bcb916e570d88abaadf836af0e7a1c5c200e6b0e`.

Deployment `appgdep_6ae4c95241748191ae2f727fdc73261e` slutfördes 2026-10-30 16:44:31 UTC, med runtime-revision9. Befintligt projekt, manifestets D1/R2-bindningar, auth-client, åtkomstpolicy och samtliga tre externa scheman är bevarade. Gmail-timschemat är fortfarande pausat. Inga hemligheter eller bankbehörigheter ändrades.

Före publicering kontrollerades dagens befintliga backup:191/191 original,63 448 066 byte, verifieringsstämpel01:27:38 UTC. Den representerar tidigare copy/readback-omfattning; nästa cykels förbättrade manifestpass är inte retroaktivt utfört. Återgångspunkten är publicerad version32. Inget återställningsprov eller destruktivt databasarbete utfördes i produktion.

## Faktiskt inloggat UI-prov

I befintligt behörigt Chrome testades mobil390×844: menyöppning, dialogens namn och expanded-status, initialfokus, Shift+Tab från början till slut, Tab tillbaka till början, Escape och fokusretur till öppnarknappen. Kundfakturor, Leverantörsfakturor, Bank och Inställningar öppnades, stängde menyn och placerade fokus på rätt huvudvy. Ingen horisontell dokumentoverflow observerades.

Övergång till1440×900 stängde menyn, dolde mobilknappen och behöll användbart fokus. Viewporten återställdes efter provet. Startsidan visade exakt de fyra önskade korten och en huvudknapp `Kontrollera alla betalningar`. Inga nya konsolfel rapporterades i den avlästa errorloggen. Inga riktiga betalningar, registreringar, kundsändningar eller synkstarter utfördes i detta produktionsprov.

Ett faktiskt kvarstående navigationsfel dokumenterades: vyn byts utan URL-/historikuppdatering. Det rättas i nästa UI-cykel med tester för bakåt, framåt och omladdning. Produktionsprovet bevisar inte autentiska bankrapporter, kompletta betalningskedjor eller bild-OCR-resultat.

En tidig observation på version32 hade öppnat granskningsvyn där den äldre dokumentkomponenten kunde POST:a första tolkningen bara genom automatisk förhandsvisning. Ingen uttrycklig fakturaregistrering eller ekonomisk åtgärd gjordes, men den äldre visningen beskrivs därför inte som garanterat skrivfri. Cykel2 tar bort detta beteende i både klient och API. Version33-provet ovan undvek denna dokumentförhandsvisning.

Exakta identifierare och observationer finns i [maskinläsbart publiceringsbevis](QUALITY-8H-SITES-CYCLE1-PUBLICATION.json). Fullständiga lokala slutgrindar:407/407 Node,531/531 Sites, TypeScript, produktionsbygge och två beroendegranskningar utan kända sårbarheter. Inga lokala finansiella testdata var autentiska.
