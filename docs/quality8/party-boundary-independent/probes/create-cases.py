from pathlib import Path
import json,hashlib
root=Path(__file__).resolve().parent
number='5560160680'
tail='\nFakturanummer: INDEP-843\nFakturadatum: 2026-11-01\nFörfallodatum: 2026-12-01\nNetto: 480,00 SEK\nMomsbelopp: 120,00 SEK\nAtt betala: 600,00 SEK\nValuta: SEK\nBetalningsreferens: 537924'
cases=[]
def add(name,group,direction,head,want,org=number,owner=True,extra='',otherName=None):
 ownerline=('Leverantörens' if direction=='supplier' else 'Mottagarens')+' organisationsnummer: 556016-0680'
 text='FAKTURA\n'+head+('\n'+ownerline if owner else '')+extra+tail
 cases.append(dict(name=name,group=group,direction=direction,text=text,party=want,organization=org,otherName=otherName,green=want is not None and org is not None))
negatives=[
 ('recipient then supplier','customer','Faktureras till: Oberoende Söder AB Leverantör Oberoende Norr AB'),
 ('supplier then recipient','supplier','Leverantör: Oberoende Söder AB Faktureras till Oberoende Norr AB'),
 ('recipient then customer','customer','Faktureras till: Oberoende Söder AB Kund Oberoende Norr AB'),
 ('repeated English recipient','customer','Bill to: Independent North AB bill to Independent South AB'),
 ('repeated supplier','supplier','Supplier: Independent North AB supplier Independent South AB'),
 ('upper case roles','supplier','SUPPLIER: Independent North AB CUSTOMER Independent South AB'),
 ('lowercase legal form','customer','Faktureras till: Oberoende Söder ab leverantör Oberoende Norr AB'),
 ('period after legal form','customer','Faktureras till: Independent North AB. supplier Independent South AB'),
 ('comma after legal form','customer','Faktureras till: Independent North AB, customer Independent South AB'),
 ('semicolon after legal form','customer','Faktureras till: Independent North AB; recipient Independent South AB'),
 ('parenthesized legal form','customer','Faktureras till: Independent North (AB) supplier Independent South AB'),
 ('tab before new role','customer','Faktureras till: Oberoende Söder AB\tLeverantör Oberoende Norr AB'),
 ('column spaces before new role','customer','Faktureras till: Oberoende Söder AB    Leverantör Oberoende Norr AB'),
 ('tab after explicit colon','customer','Faktureras till:\tOberoende Söder AB Leverantör Oberoende Norr AB'),
 ('HB before new role','supplier','Leverantör: Oberoende Söder HB Kund Oberoende Norr AB'),
 ('KB before new role','customer','Faktureras till: Oberoende Söder KB Leverantör Oberoende Norr AB'),
 ('single-letter prefix','customer','Faktureras till: A AB Leverantör B AB'),
]
for name,direction,head in negatives:add(name,'bare-role-boundary',direction,head,None)
positives=[
 ('literal supplier in name','supplier','Leverantör: Original supplier AB','Original supplier AB'),
 ('literal customer in name','customer','Kund: Synthetic customer AB','Synthetic customer AB'),
 ('literal middle Customer','supplier','Leverantör: North Customer Support AB','North Customer Support AB'),
 ('literal leading Kund','supplier','Leverantör: Kund AB','Kund AB'),
 ('literal middle Supplier','customer','Kund: Svenska Supplier Support AB','Svenska Supplier Support AB'),
 ('uppercase literal role word','supplier','Leverantör: Original SUPPLIER AB','Original SUPPLIER AB'),
 ('literal leading Customer','customer','Kund: Customer Care AB','Customer Care AB'),
 ('hyphenated literal role word','supplier','Leverantör: North Customer-Support AB','North Customer-Support AB'),
 ('role fragment','supplier','Leverantör: Suppliership AB','Suppliership AB'),
 ('legal-form suffix fragment','supplier','Leverantör: North AAB Customer Support AB','North AAB Customer Support AB'),
 ('tab after colon with literal role','supplier','Leverantör:\tOriginal supplier AB','Original supplier AB'),
 ('tab within explicit recipient label','customer','Faktureras\ttill: Synthetic customer AB','Synthetic customer AB'),
 ('wrapped explicit supplier name','supplier','Leverantör:\nOriginal supplier AB','Original supplier AB'),
 ('repeated Kund as literal value','customer','Kund: Kund AB','Kund AB'),
 ('plain complete name','customer','Faktureras till: Oberoende Avtalsbyrån AB','Oberoende Avtalsbyrån AB'),
]
for name,direction,head,want in positives:add(name,'literal-name-positive',direction,head,want)
add('two separately explicit colon roles','explicit-roles-positive','customer','Leverantör: Original supplier AB Kund: Synthetic customer AB','Synthetic customer AB',extra='\nLeverantörens organisationsnummer: 559762-3114',otherName='Original supplier AB')
for name,direction,head in [
 ('unowned number after recipient then supplier','customer','Faktureras till: Oberoende Söder AB Leverantör Oberoende Norr AB'),
 ('unowned number after supplier then recipient','supplier','Leverantör: Oberoende Söder AB Faktureras till Oberoende Norr AB'),
 ('unowned number after repeated recipient','customer','Faktureras till: Oberoende Söder AB Kund Oberoende Norr AB'),
]:add(name,'owner-census',direction,head,None,None,False,'\nOrganisationsnummer: 556016-0680')
add('inline unowned number after new bare role','owner-census','customer','Faktureras till: Oberoende Söder AB Leverantör Oberoende Norr AB Organisationsnummer: 556016-0680',None,None,False)
add('unknown field cannot donate ownership','owner-census-control','supplier','Leverantör: Original supplier AB','Original supplier AB',None,False,'\nAvtal: Oberoende notering\nOrganisationsnummer: 556016-0680')
add('invalid unowned number before owned number holds census','owner-census-control','supplier','Organisationsnummer: 0000000000\nLeverantör: Original supplier AB','Original supplier AB',None)
add('different unowned number after scalar holds census','owner-census-control','supplier','Leverantör: Original supplier AB','Original supplier AB',None,True,'\nFakturanummer: INDEP-843\nOrganisationsnummer: 559762-3114')
add('equal unowned duplicate preserves independently owned number','owner-census-control','supplier','Leverantör: Original supplier AB','Original supplier AB',number,True,'\nAvtal: Oberoende notering\nOrganisationsnummer: 556016-0680')
p=root/'cases.json';p.write_text(json.dumps({'schema':'independent-party-boundary-cases-v1','baseline':'dd968c1fd10b4e21c2479a939df548e390f5c6d6','cases':cases},ensure_ascii=False,indent=2)+'\n')
print('Frozen case rows:',len(cases),'Node/Sites x pdf/ocr:',len(cases)*4,'SHA256:',hashlib.sha256(p.read_bytes()).hexdigest())
