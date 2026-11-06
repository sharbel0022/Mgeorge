#!/usr/bin/env python3
"""Deterministic synthetic images; no parser/worker/corpus imports."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
from datetime import date, timedelta
import json, re, unicodedata
ROOT = Path(__file__).resolve().parent
FONT = Path('/usr/share/fonts/truetype/dejavu')
def font(size, bold=False):
    return ImageFont.truetype(str(FONT/('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')),size)
# Generate using left-to-right weighted digit sums; validate separately right-to-left.
def org_number(base):
    digits = [int(x) for x in base]
    total = sum((v*2//10+v*2%10) if i%2==0 else v for i,v in enumerate(digits))
    s = base+str((-total)%10)
    return s[:6]+'-'+s[6:]
def valid_org(value):
    if re.fullmatch(r'\d{6}-\d{4}', value) is None: return False
    clean=value.replace('-','')
    if int(clean[2]) < 2: return False
    checksum=0
    for index,char in enumerate(reversed(clean)):
        value=int(char)
        if index%2:
            value*=2
            if value>9: value-=9
        checksum+=value
    return checksum%10==0
names_sv=['Myrglimt Kontor AB','Granlyra Service AB','Fjällruta Teknik AB','Björkkompass Material AB','Solmossa Form AB','Ängsvåg Konsult AB']
names_en=['Ember Quay Services AB','Cedar Lantern Design AB','Silver Fern Office AB','Amber Brook Systems AB','Willow Orbit Supply AB','North Velvet Studio AB']
fields=['invoice_number','party','organization_number','issued_at','due_at','total_cents','net_cents','vat_cents','currency']
samples=[]
for i in range(14):
    lang='sv' if i<6 or i==12 else 'en'
    stress=i>=12
    n=i+1
    party=(names_sv[i] if i<6 else names_en[i-6] if i<12 else ['Mossglöd Verkstad AB','Maple Quartz Services AB'][i-12])
    issued=date(2026,9,n)
    net=[480000,125000,736000,298000,642000,186000,324000,468000,856000,212000,594000,378000,256000,432000][i]
    vat=net//4
    org=org_number('5598'+str(71000+n))
    assert valid_org(org),org
    gold=dict(invoice_number=f'{"SV" if lang=="sv" else "EN"}-260{n:02d}',party=party,organization_number=org,issued_at=issued.isoformat(),due_at=(issued+timedelta(days=30)).isoformat(),total_cents=net+vat,net_cents=net,vat_cents=vat,currency='SEK')
    sid=('stress-' if stress else 'normal-')+lang+f'-{n:02d}'
    sample=dict(id=sid,cohort='stress' if stress else 'normal',language=lang,layout=i%3+1,image=f'images/{sid}.png',mimeType='image/png',metadata={'direction':'supplier','direction_confident':True},gold=gold,conditions='rotation 1.2 degrees plus blur 0.7 px' if i==12 else 'downsample to 840px width, light gray background, blur 0.35 px' if i==13 else 'clean ordinary synthetic invoice')
    samples.append(sample)
    im=Image.new('RGB',(1400,1980),'white'); d=ImageDraw.Draw(im)
    def txt(x,y,s,size=30,bold=False,fill='#17212b'):
        box=d.textbbox((x,y),s,font=font(size,bold))
        assert box[2]<1360 and box[3]<1900,(sid,s,box)
        d.text((x,y),s,font=font(size,bold),fill=fill)
    def line(y): d.line((80,y,1320,y),fill='#87939d',width=2)
    sv=lang=='sv'
    title='FAKTURA' if sv else 'INVOICE'
    labels=['Fakturanummer','Fakturadatum','Förfallodatum'] if sv else ['Invoice number','Issue date','Due date']
    orglabel='Organisationsnummer' if sv else 'Organization number'
    supplier='Leverantör' if sv else 'Supplier'
    customer='Fakturamottagare' if sv else 'Bill to'
    layout=i%3
    if layout==0:
        txt(80,80,title,54,True);txt(80,175,party,38,True)
        txt(80,235,f'{orglabel}: {org}',28)
        txt(80,310,customer,26,True);txt(80,355,'Kundexempel Norden AB',28)
        txt(80,398,'Exempelvägen 8, 652 00 Karlstad',26)
        for k,key in enumerate(['invoice_number','issued_at','due_at']):
            txt(810,310+k*90,labels[k],24,True);txt(810,344+k*90,gold[key],30)
        top=650
    elif layout==1:
        txt(80,75,party,38,True);txt(80,137,f'{supplier} | {orglabel}: {org}',27)
        txt(80,240,title,54,True);line(320)
        for k,key in enumerate(['invoice_number','issued_at','due_at']):
            txt(80+420*k,360,labels[k],24,True);txt(80+420*k,405,gold[key],30)
        txt(80,510,f'{customer}: Kundexempel Norden AB',28)
        txt(80,555,'Exempelvägen 8, 652 00 Karlstad',26)
        top=685
    else:
        txt(80,80,title,54,True);txt(80,185,supplier,25,True)
        txt(80,230,party,35,True);txt(80,288,f'{orglabel}: {org}',27)
        txt(80,390,f'{customer}: Kundexempel Norden AB',28)
        txt(80,438,'Exempelvägen 8, 652 00 Karlstad',26)
        d.rectangle((780,180,1320,505),outline='#87939d',width=2)
        for k,key in enumerate(['invoice_number','issued_at','due_at']):
            txt(810,205+95*k,labels[k],24,True);txt(810,245+95*k,gold[key],30)
        top=640
    def money(c):
        s=f'{c/100:,.2f}'
        return s.replace(',',' ').replace('.',',') if sv else s.replace(',',' ')
    line(top)
    txt(80,top+25,'Beskrivning' if sv else 'Description',28,True)
    txt(880,top+25,'Antal' if sv else 'Qty',28,True)
    txt(1080,top+25,'Belopp' if sv else 'Amount',28,True)
    line(top+80)
    for k,amount in enumerate([net*3//5,net-net*3//5]):
        txt(80,top+115+k*90,['Kontorsservice','Materialleverans'][k] if sv else ['Office services','Materials delivery'][k],30)
        txt(910,top+115+k*90,'1',30)
        txt(1080,top+115+k*90,money(amount),30)
    line(top+305)
    sumtop=top+380
    for k,(label,key) in enumerate(zip(['Nettobelopp','Moms 25%','Att betala'] if sv else ['Net amount','VAT 25%','Amount due'],['net_cents','vat_cents','total_cents'])):
        if k==2: d.rectangle((735,sumtop+175,1320,sumtop+265),fill='#eef1f4')
        txt(760,sumtop+k*95,label,29,k==2)
        txt(1080,sumtop+k*95,money(gold[key]),30,k==2)
    txt(760,sumtop+305,('Valuta' if sv else 'Currency')+': SEK',30,True)
    txt(80,1500,'Betalningsvillkor: 30 dagar' if sv else 'Payment terms: 30 days',28)
    txt(80,1550,'Tack för er beställning.' if sv else 'Thank you for your order.',28)
    line(1760)
    txt(80,1810,'TEST — SYNTHETIC INVOICE — DO NOT PAY',25,True,fill='#525e68')
    if i==12: im=im.rotate(1.2,resample=Image.Resampling.BICUBIC,expand=False,fillcolor='white').filter(ImageFilter.GaussianBlur(.7))
    if i==13:
        im=im.resize((840,1188),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(.35))
        im=Image.eval(im,lambda v:int(25+v*.88))
    target=ROOT/sample['image']
    if target.exists(): raise RuntimeError('Refuse overwrite of corpus image')
    im.save(target)
assert len([s for s in samples if s['cohort']=='normal' and s['language']=='sv'])==6
assert len([s for s in samples if s['cohort']=='normal' and s['language']=='en'])==6
assert all(set(s['gold'])==set(fields) and s['gold']['currency']=='SEK' and s['gold']['net_cents']+s['gold']['vat_cents']==s['gold']['total_cents'] for s in samples)
(ROOT/'gold.json').write_text(json.dumps({'schemaVersion':1,'fields':fields,'samples':samples},ensure_ascii=False,indent=2)+'\n')
# Review aid only, never fed to OCR.
sheet=Image.new('RGB',(1400,1980),'#d5dce1')
for i,s in enumerate(samples):
    thumb=Image.open(ROOT/s['image']);thumb.thumbnail((350,470))
    x=(i%4)*350;y=(i//4)*495
    sheet.paste(thumb,(x,y));ImageDraw.Draw(sheet).text((x+8,y+470),s['id'],font=font(15),fill='black')
sheet.save(ROOT/'contact-sheet.jpg',quality=90)
print('Authored 14 images; normal 6 Swedish + 6 English; independent format/Luhn checks PASS')
