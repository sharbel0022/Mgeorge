from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageEnhance
from pathlib import Path
import json, hashlib, random, datetime

BASE=Path(__file__).resolve().parent
RAW=Path('/workspace/scratch/aab0f7dc06f9/independent-ocr-raw/completion-independent-20261106')
RAW.mkdir(parents=True,exist_ok=True)
FONT_DIR=Path('/usr/share/fonts/truetype/dejavu')
W,H=1654,2339
SEED=611062026

def font(n,bold=False,serif=False):
    name=('DejaVuSerif' if serif else 'DejaVuSans')+('-Bold' if bold else '')+'.ttf'
    return ImageFont.truetype(str(FONT_DIR/name),n)

def make_case(i,stress=None):
    sv=(i%2==1)
    names=['Testfirma Fjällviolett AB','Demo Cedar Loom Ltd','Testbolag Silverkotte AB','Demo Amber Harbor Ltd','Testfirma Molnlinje AB','Demo Quiet Maple Ltd','Testbolag Pappersö AB','Demo Copper Finch Ltd','Testfirma Grön Ruta AB','Demo Woven Birch Ltd','Testbolag Månsten AB','Demo Indigo Orchard Ltd','Testfirma Tallcirkel AB','Demo Violet Meadow Ltd','Testbolag Stilla Vik AB','Demo Golden Fern Ltd','Testfirma Skymningsblå AB','Demo Paper Lantern Ltd','Testbolag Röda Rutan AB']
    party=names[i-1]
    num=f'SYN-{2026+i}-{370+i*17}'
    org=f'000000-{1000+i*37:04d}'
    day=2+i
    issued=datetime.date(2026,9,day)
    due=issued+datetime.timedelta(days=30)
    net=48000+i*7200
    vat=net//4
    total=net+vat
    currency='SEK' if sv else 'EUR'
    gold=dict(invoice_number=num,party=party,organization_number=org,issued_at=issued.isoformat(),due_at=due.isoformat(),total_cents=total,net_cents=net,vat_cents=vat,direction='incoming',currency=currency,reference=None,bankgiro=None)
    return dict(id=('S' if stress else 'N')+f'{i if not stress else i-16:02d}',population='stress' if stress else 'normal',language='sv' if sv else 'en',layout=(i-1)%4,variation=stress or ['clean','grayscale','rotation','scan'][(i-1)//4],gold=gold,review_required=bool(stress),metadata=dict(direction_semantics='incoming',received_at='2026-10-25T12:00:00.000Z',synthetic=True),stress=stress)

def money(c,sv):
    a=f'{c/100:,.2f}'
    return a.replace(',',' ').replace('.',',') if sv else a

def render(c):
    sv=c['language']=='sv'; g=c['gold']; lay=c['layout']
    im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im); rows=[]
    ink=(24,28,34); accent=[(31,64,94),(74,43,85),(35,77,55),(84,62,32)][lay]
    def text(x,y,s,n=28,bold=False,serif=False):
        d.text((x,y),s,font=font(n,bold,serif),fill=ink); rows.append(s)
    def label(x,y,k,v): text(x,y,k,25,True); text(x,y+39,v,31)
    title='FAKTURA' if sv else 'INVOICE'
    invlabel='Fakturanummer' if sv else 'Invoice number'
    orglabel='Organisationsnummer' if sv else 'Company registration number'
    issue='Fakturadatum' if sv else 'Invoice date'
    due='Förfallodatum' if sv else 'Due date'
    recipient='Mottagare: Syntetisk Testkund AB' if sv else 'Bill to: Synthetic Test Customer Ltd'
    if lay==0:
        d.rectangle((90,90,W-90,110),fill=accent)
        text(100,160,title,58,True);text(100,270,g['party'],37,True)
        text(100,330,orglabel+': '+g['organization_number'])
        text(100,380,'Exempelgatan 0, 000 00 Teststad' if sv else '0 Example Street, Test City 00000')
        text(100,430,'invoice@example.invalid',25)
        label(1040,180,invlabel,g['invoice_number']);label(1040,300,issue,g['issued_at']);label(1040,420,due,g['due_at'])
        text(100,590,recipient,29)
        y=760
    elif lay==1:
        d.rectangle((90,90,310,H-130),fill=(240,242,244))
        text(355,110,g['party'],42,True,True);text(355,190,orglabel+': '+g['organization_number'],27)
        text(355,260,title,61,True,True)
        text(355,370,invlabel+': '+g['invoice_number'],30)
        text(355,425,issue+': '+g['issued_at'],29);text(355,480,due+': '+g['due_at'],29)
        text(355,585,recipient,28);text(355,635,'0 Sample Road, Fictional City',26)
        y=790
    elif lay==2:
        text(100,110,title,61,True);text(870,130,g['party'],33,True)
        text(870,190,orglabel,24);text(870,230,g['organization_number'],29)
        d.line((100,320,W-100,320),fill=accent,width=4)
        label(100,390,invlabel,g['invoice_number']);label(650,390,issue,g['issued_at']);label(1120,390,due,g['due_at'])
        text(100,600,recipient,30);text(100,655,'Fiktiv leveransadress, Teststad' if sv else 'Fictional delivery address, Test City',27)
        y=830
    else:
        text(150,120,g['party'],47,True,True)
        text(150,205,orglabel+': '+g['organization_number'],28)
        text(150,310,title,56,True,True)
        d.rectangle((140,405,W-140,670),outline=(140,140,140),width=2)
        text(170,440,invlabel+': '+g['invoice_number'],31)
        text(170,505,issue+': '+g['issued_at'],29)
        text(800,505,due+': '+g['due_at'],29)
        text(170,580,recipient,28)
        y=850
    x=355 if lay==1 else 140
    desc='Syntetisk konsulttjänst' if sv else 'Synthetic consulting service'
    text(x,y,'Beskrivning' if sv else 'Description',28,True)
    text(1070,y,'Belopp' if sv else 'Amount',28,True)
    d.line((x,y+55,1500,y+55),fill=(140,140,140),width=2)
    text(x,y+90,desc,29);text(1070,y+90,money(g['net_cents'],sv)+' '+g['currency'],30)
    text(x,y+170,'Antal: 1' if sv else 'Quantity: 1',25)
    ty=y+360
    text(840,ty,('Summa exkl. moms: ' if sv else 'Net amount: ')+money(g['net_cents'],sv)+' '+g['currency'],28)
    text(840,ty+70,('Moms 25 %: ' if sv else 'VAT 25%: ')+money(g['vat_cents'],sv)+' '+g['currency'],28)
    d.line((820,ty+132,1515,ty+132),fill=accent,width=3)
    text(800,ty+170,('Att betala: ' if sv else 'Total due: ')+money(g['total_cents'],sv)+' '+g['currency'],34,True)
    if c['stress']=='conflicting_totals':
        text(800,ty+260,('Att betala: ' if sv else 'Total due: ')+money(g['total_cents']+2100,sv)+' '+g['currency'],34,True)
    text(x,1900,'Betalningsvillkor: 30 dagar' if sv else 'Payment terms: 30 days',26)
    text(x,1960,'Endast syntetiskt testmaterial. Ingen betalning ska göras.' if sv else 'Synthetic evaluation only. Do not make any payment.',24)
    text(x,2010,'Identiteter och belopp är påhittade.' if sv else 'All identities and amounts are fictional.',24)
    text(x,2140,'Sida 1 av 1' if sv else 'Page 1 of 1',22)
    v=c['variation']
    if v=='grayscale': im=ImageEnhance.Contrast(im.convert('L')).enhance(.84)
    elif v=='rotation': im=im.rotate(.65 if sv else -.7,resample=Image.Resampling.BICUBIC,fillcolor='white')
    elif v=='scan':
        im=im.convert('L').resize((1323,1871),Image.Resampling.BICUBIC).resize((W,H),Image.Resampling.BICUBIC).filter(ImageFilter.GaussianBlur(.42))
        rng=random.Random(SEED+int(c['id'][1:])); pix=im.load()
        for _ in range(8000):
            xx=rng.randrange(W);yy=rng.randrange(H);pix[xx,yy]=max(0,pix[xx,yy]-rng.randrange(4,32))
    elif v=='low_contrast': im=ImageEnhance.Contrast(im.convert('L')).enhance(.12).filter(ImageFilter.GaussianBlur(1.8))
    elif v=='cropped': im=im.crop((0,540,W,H))
    path=RAW/(c['id']+'.png');im.save(path,format='PNG',compress_level=6)
    c['image_path']=str(path);c['image_sha256']=hashlib.sha256(path.read_bytes()).hexdigest();c['image_bytes']=path.stat().st_size;c['source_text']='\n'.join(rows)
    return c

cases=[render(make_case(i)) for i in range(1,17)]+[render(make_case(17,'low_contrast')),render(make_case(18,'cropped')),render(make_case(19,'conflicting_totals'))]
(BASE/'corpus.json').write_text(json.dumps(dict(id='completion-independent-20261106',seed=SEED,synthetic_only=True,cases=cases),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(cases=len(cases),normal=16,stress=3,raw_locator=str(RAW),total_image_bytes=sum(c['image_bytes'] for c in cases))))
