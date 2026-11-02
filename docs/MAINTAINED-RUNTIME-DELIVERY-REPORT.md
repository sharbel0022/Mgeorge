# Avgränsad leverans: beroendebackport och betalarindex

2026-11-02. Baslinje main807b654/Sites55. Status före push: lokala slutkontroller och leverans pågår; ingen ny Sites-version påstås. Användarens nya instruktion kräver avslut och push inom fem minuter. Därför ingår bara T1/T2 som har oberoende scoped och samlad READY. Sju ofärdiga Task3-filer är hashverifierat bevarade privat utanför repositoryt; ingen ny export- eller restorefunktion levereras.

## Kod och bevis

- Exakt ägd minimatch10.2.5-backport av uppströms77a0f5c; CJS/ESM, inbäddad TypeScript och källkartor är hashbundna. Okänd version/bytes stoppar före skrivning, känd avbruten blandning går att reparera. Postinstall kompletteras med explicit kontroll i båda installerarna och läsande kontroll före build/check/lint. Paketversioner/integriteter och BlueOaklicens bevaras; endast hasInstallScript tillkommer i lockmetadata. Version3.1.5 och auditklassningen ändras inte.
- Betalarrelationer indexeras bara inom samma analys på strikt konto och normaliserad betalare. Faktiska fakturaobjekt återanvänds; alla identitets-/original-/konto-/saldo-/konkurrensomkontroller kvarstår. Oberoende6442 kompletta fyndjämförelser mot respektive basmotor var identiska, indata oförändrad. Lokalt200Sitespar22006,49→5041,76ms med identiska fynd/allokering/input/originalhashar. Ingen produktions-SLA.
- Permanent RED före båda ändringarna. Scoped payerreview158/158 och separat differential READY. Backport Windows37pass/3Linux-onlyskip; åtta compiler-/kartjämförelser och17filhashar oberoende verifierade. Linuxcontainer39pass/1miljöfel eftersom curl saknades; Ubuntu-CI får inte ersättas med den körningen. Samlad integration READY.

## Slutkontroller

Färsk rootinstallation och syntax105 passerar; rootaudit0. Första kompletta Nodekörningen gav1028pass/27PDFfel/8befintliga WindowsEPERMskip. Tre representativa fel passerade separat; exakt transientorsak kan inte bevisas eftersom workerns originalfel saknas i loggen. Full omkörning passerade:1063tester,1055pass/0fail/8befintliga faktiska WindowsEPERMskip. Den första felkörningen behålls som begränsning; ingen exakt transientorsak är styrkt.

Färsk Sitesinstallation verifierade1mål/4backportskrivningar och explicit efterkontroll0skrivningar. Sites TypeScript och produktionsbygge passerar. Full Sites1912:1909pass/0fail/3uttryckliga Linux-managed-onlyskip på Windows. Full audit16moderate/0high/critical kvarstår; separat highgrind passerar och produktionsaudit0. ESLints supportgap är öppet.

## Produktionsbevis och gränser

Faktisk ägarinloggad Chrome observerad på Sites55. Kundfakturor, banknavigation, båda0599-dialogerna, referenssökning2rader och specifikationsfilter1AISrad verifierades läsande. Dialoggeometri/fokus ryms320/390/768/1024/1440; visuella screenshots inspekterades320/defaultdesktop. Escape återförde fokus. Tillfälliga filter och viewport återställdes. Detta är ingen fysisk mobil, produktionsuppladdning, logout-/revokationsresa eller verklig allokeringskörning.

Färsk ansluten läskontroll: revision42, AIS ekonomiskt1/rapport0, inga allokeringar, automaticEligiblefalse, komplett målregister0; bred referenssökning inte komplett. Originalintegritet visar intakt i aktuell kontroll. Bankstyrkt kontoalias, gemensam insättning, individuell AIS-betalare, fakturaregistrering och kundrelation saknas fortsatt. Ingen bankdetaljretry med okänd deadline, registrering, allokering, betalning eller kundmejl utfördes. Befintliga tre Sites-scheman/auth/policy bevaras; ingen pausad extern Gmailautomation aktiverades.

Den historiska Nodebackupen från28oktober verifierades/återställdes privat med riktig kandidatnyckel:24tabeller, integritet/FKpass,0fakturor/0original, källarkiv oförändrat. Detta är inte kund-/SitesDR. Senaste Sitesbackup är historiskt complete195; inte färskt omverifierad mot de nya reglerna. Lokal DPAPI-kandidat kan dekrypteras till giltig64hex i minnet, men inget aktuellt Sitesarkiv har autentiserats eller återställts. Full operativ katastrofåterställning kvarstår.

## Kvalitet och fortsatt punkt

Samtliga33områden behåller sina tidigare före-/efterpoäng:255/330=7,73;0/33på9,5. Nya bevis stärker områden6/20/26/32 (index/verktyg),1/3/4/5/7/18/19/25/30/33 (avgränsad inloggad läsvy),29/31 (tom historisk Nodeövning); de uppfyller inte hela områdets acceptans. Alla övriga områdens tidigare fynd, rättningar och kvarstående gränser gäller fortsatt enligt [scorecard](../QUALITY-SCORECARD.md) och [föregående leverans](ORIGINAL-REFERENCE-INTEGRITY-REPORT.md).

Nästa punkt, om nytt arbete beställs: utred intermittent PDFworkerdiagnostik utan privat felläckage; slutför/reviewa den privat bevarade Task3-designen och kör faktisk ägarbunden krypterad Sitesexport/nyckelverifiering/isolaterad evidensrestore. Separata bank-/verksamhetsbeslut, representativ OCRkorpus och faktisk schemakörning återstår. Ingen fortsatt obemannad körning lovas.

GitHubpush, exakt main-CI och Sitespublicering redovisas separat nedan när de faktiskt är verifierade. Endast main finns sedan tidigare godkänd branchrensning; ingen ny radering behövdes.

## GitHub och Sites vid överlämning

Denna commit är den granskade leveransen. Normal fast-forward-push tillmain görs efter samtliga lokala slutkontroller; exakt GitHub Actions-status ska läsas separat efter push. Sites55 är fortsatt senast verifierade publicering; ingen ny Sites-version eller driftverifiering påstås för dessa ändringar. Publicering av denna testade källa återstår.
