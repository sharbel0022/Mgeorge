# Offentliga informationssidor på Sites

MG Fakturakolls befintliga Site har projekt-ID `appgprj_6adf2f7f7e848191b64192161886b528`.

Publicerat på den befintliga Siten den 26 oktober 2026, version 4. Offentliga adresser:

- https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/integritetspolicy
- https://mg-fakturakoll-sharbel.asdasdsa213.chatgpt.site/anvandarvillkor

Sites-källkodens publicerade commit: `f8cdd8b1d06ac11058061da81e4d0e1d02d52364`. Båda dokumenten verifierades med HTTP 200, utan cookies eller åtkomsttoken. Sidornas `<main>`-innehåll motsvarar HTML-utkasten i GitHub. Sites/Cloudflare kan lägga till egen kod i HTTP-svaret. Faktura-API:t fortsätter att kräva den befintliga behörigheten.

Dokumentens källor är `public/integritetspolicy.html` och `public/anvandarvillkor.html`. De är uttryckligen märkta som utkast. Att URL:erna fungerar innebär inte att dokumenten är juridiskt granskade eller att Enable Banking har godkänt registreringen.

Den lokala Node-versionen serverar både dessa sökvägar och motsvarande `.html`-adresser. Den befintliga Sites-versionen har separat källkod, databas och behörighetskontroll.

Efter att den befintliga Sites-källkoden öppnats med Sites-arbetsflödet kan informationssidorna uppdateras från detta repository:

```text
node scripts/sync-sites-legal.mjs <absolut-sökväg-till-Sites-källkoden>
```

Skriptet kontrollerar projekt-ID och skriver endast två publika route handlers och `lib/legal-documents.json`. Det ändrar inte fakturaflöden, bankkonfiguration, åtkomstregler eller lagrad företagsdata. Bygg och publicera därefter den befintliga Siten via Sites. GitHub-push ensam publicerar inte den webbplatsen.

Verifiera efter publicering att båda adresserna svarar med HTTP 200 och rätt dokumenttext utan cookies, inloggning eller åtkomsttoken innan länkarna används i registreringsformuläret.
