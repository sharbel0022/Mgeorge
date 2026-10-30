# Fortsätta kvalitetsarbetet

Läs `PROGRESS.md`, `QUALITY-SCORECARD.md` och den senaste länkade leveransrapporten innan en ny utvecklingscykel. Hämta aktuell `origin/main` och jämför med den senast verifierade committen. Återanvänd redan utförd verifiering endast när dess kod, miljö och omfattning fortfarande gäller.

Prioritera ekonomisk korrekthet, bevarade original och åtkomstkontroll. En betalningsreferens, kundidentitet, manuellt verifierad relation och bankens faktiska uppgifter är olika slags evidens. Förslag får inte ändra saldon. Båda applikationerna, Node och `sites/`, behöver bedömas när gemensamma regler ändras.

Använd syntetiska data i tester. Publicera aldrig kundoriginal, kontouppgifter eller hemligheter i repositoryt. Följ den aktuella användarinstruktionens behörigheter för push och publicering; en gammal rapport ger inte nya behörigheter att skicka kundmejl, genomföra betalningar eller ändra produktionsdata.

Obligatoriska kodkontroller finns i `.github/workflows/payment-control-ci.yml`: rotens installation, syntaxkontroll, tester och audit; motsvarande installation, typkontroll, tester, audit och produktionsbygge för Sites. Läs de aktuella skripten före körning. Bevara det befintliga Sites-projektet och dess identitet, DB/R2, hemligheter och scheman.

Uppdatera framsteg och alla berörda poäng med testbevis och kvarstående begränsningar. Skilj GitHub-push från Sites-publicering, lokal testframgång från faktisk drift, och en ansluten integration från ett verifierat schema. Höj inte ett produktionsberoende område till 9,5 utan den nödvändiga evidensen. Dokumentera en exakt fortsättningspunkt om körningen avslutas.
