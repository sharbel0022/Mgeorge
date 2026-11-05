#!/usr/bin/env python3
"""Render frozen synthetic specifications; never import or invoke OCR/parsers.

The separate literal gold is intentionally not read by this renderer.
Always render to a fresh output directory, then inspect before freezing.
"""
import argparse
import hashlib
import json
from pathlib import Path

import PIL
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / 'test/fixtures/quality8/ocr-holdout-v2/documents.json'
FONTS = {
    'liberation-sans': ('/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'),
    'liberation-serif': ('/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf', '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf'),
    'dejavu-sans': ('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'),
    'dejavu-serif': ('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'),
    'noto-sans': ('/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf'),
}
WIDTH, HEIGHT = 1600, 2000
INK, MUTED, RULE = '#17232d', '#46515a', '#c4cbd0'
BOUNDS = []


def digest(data):
    return hashlib.sha256(data).hexdigest()


def render(doc):
    image = Image.new('RGB', (WIDTH, HEIGHT), 'white')
    draw = ImageDraw.Draw(image)
    normal, boldface = FONTS[doc['font']]
    cache = {}

    def font(size, bold=False):
        key = (size, bold)
        if key not in cache:
            cache[key] = ImageFont.truetype(boldface if bold else normal, size)
        return cache[key]

    def text(value, x, y, size=32, bold=False, color=INK, max_width=None, right=False):
        value = str(value)
        face = font(size, bold)
        box = draw.textbbox((0, 0), value, font=face, anchor='lt')
        width, height = box[2], box[3]
        if right:
            x -= width
        if x < 45 or x + width > WIDTH - 45 or y < 30 or y + height > HEIGHT - 25:
            raise ValueError(f'Text outside page: {doc["id"]}: {value}')
        if max_width is not None and width > max_width:
            raise ValueError(f'Text exceeds its column: {doc["id"]}: {value} ({width}>{max_width})')
        draw.text((x, y), value, font=face, fill=color, anchor='lt')
        BOUNDS.append({'id': doc['id'], 'text': value, 'x': x, 'y': y, 'width': width, 'height': height, 'fontPixels': size, 'font': doc['font'], 'bold': bold})
        return width

    def line(x1, y1, x2, y2, color=RULE, width=2):
        draw.line((x1, y1, x2, y2), fill=color, width=width)

    def panel(x, y, width, height, color='#eef2f5'):
        draw.rectangle((x, y, x + width, y + height), fill=color)

    def pair(label, value, x, y, stacked=False, width=660, bold=False):
        if stacked:
            text(label, x, y, 28, color=MUTED, max_width=width)
            text(value, x, y + 46, 34, bold=bold, max_width=width)
        else:
            text(f'{label}: {value}', x, y, 32, bold=bold, max_width=width)

    def supplier(x, y, labelled=True, org=True, width=720):
        if labelled:
            text('Leverantör', x, y, 28, color=MUTED, max_width=width)
            y += 44
        text(doc['party'], x, y, 34, bold=True, max_width=width)
        for offset, value in enumerate(doc['address'], 1):
            text(value, x, y + offset * 43, 28, color=MUTED, max_width=width)
        if org:
            pair('Org.nr', doc['organization'], x, y + 137, width=width)

    def recipient(x, y, width=660):
        text('Faktureras till', x, y, 28, color=MUTED, max_width=width)
        text(doc['recipient'], x, y + 44, 32, max_width=width)
        text('Handelsvägen 22', x, y + 88, 28, color=MUTED, max_width=width)
        text('123 40 Teststad', x, y + 127, 28, color=MUTED, max_width=width)

    def title(x=100, y=100, right=False):
        text('FAKTURA', x, y, 52, bold=True, right=right)

    def table(y, x=100, width=1400):
        panel(x, y, width, 58)
        text('Beskrivning', x + 18, y + 14, 28, bold=True)
        text('Antal', x + width - 535, y + 14, 28, bold=True, right=True)
        text('À-pris', x + width - 280, y + 14, 28, bold=True, right=True)
        text('Belopp', x + width - 18, y + 14, 28, bold=True, right=True)
        for n, (description, quantity, price, amount) in enumerate(doc['rows']):
            yy = y + 90 + n * 72
            text(description, x + 18, yy, 30, max_width=width - 600)
            text(quantity, x + width - 535, yy, 30, right=True)
            text(price, x + width - 280, yy, 30, right=True)
            text(amount, x + width - 18, yy, 30, right=True)
            line(x, yy + 49, x + width, yy + 49, '#dde2e5', 1)
        text('Samtliga radbelopp i SEK, exklusive moms.', x + 18, y + 251, 28, color=MUTED)

    def totals(x, y, width=630, stacked=False):
        labels = [doc['netLabel'], doc['vatLabel'], doc['totalLabel']]
        values = [doc['net'], doc['vat'], doc['total'] + ('' if doc['totalLabel'].endswith('SEK') else ' SEK')]
        for n, (label, value) in enumerate(zip(labels, values)):
            yy = y + n * (112 if stacked else 76)
            if stacked:
                text(label, x, yy, 28, color=MUTED, max_width=width)
                text(value, x, yy + 45, 36 if n == 2 else 34, bold=n == 2, max_width=width)
            else:
                if n == 2:
                    line(x, yy - 18, x + width, yy - 18)
                label_width = text(label, x, yy + 3, 30, bold=n == 2)
                value_width = text(value, x + width, yy, 36 if n == 2 else 32, bold=n == 2, right=True)
                if label_width + value_width + 16 > width:
                    raise ValueError(f'Overlapping summary columns: {doc["id"]}')

    def payment(x, y, width=660, stacked=True, terms=True):
        pair('Bankgiro', doc['bankgiro'], x, y, stacked=stacked, width=width, bold=True)
        pair(doc['referenceLabel'], doc['reference'], x, y + (112 if stacked else 65), stacked=stacked, width=width)
        if terms:
            text('Ange OCR-numret vid betalning.', x, y + (226 if stacked else 135), 28, color=MUTED, max_width=width)

    def footer(org=False):
        if org:
            pair('Organisationsnummer', doc['organization'], 100, 1814, width=900)
            text('Godkänd för F-skatt', 1500, 1814, 28, right=True)
        line(100, 1904, 1500, 1904)
        text('SYNTETISKT PROVUNDERLAG – ingen verklig affärshändelse', 100, 1940, 23, color=MUTED)
        text('Sida 1 (1)', 1500, 1940, 23, color=MUTED, right=True)

    layout = doc['layout']
    if layout == 'split-header-totals-right':
        supplier(100, 100, labelled=False)
        title(1500, 100, right=True)
        pair('Fakturanummer', doc['invoiceNumber'], 1070, 228, stacked=True, width=430, bold=True)
        pair('Fakturadatum', doc['issued'], 1070, 350, stacked=True, width=430)
        pair('Förfallodatum', doc['due'], 1070, 472, stacked=True, width=430)
        recipient(100, 445)
        pair('Kundnummer', doc['customerNumber'], 100, 685)
        pair('Er beställning', doc['orderNumber'], 850, 685)
        table(835)
        totals(870, 1240)
        text('Tack för ert uppdrag.', 100, 1250, 32)
        panel(80, 1580, 1440, 260, '#f0f3f5')
        pair('Bankgiro', doc['bankgiro'], 110, 1620, stacked=True, bold=True)
        pair(doc['referenceLabel'], doc['reference'], 850, 1620, stacked=True)
        text('Ange OCR-numret vid betalning. Valuta: SEK.', 110, 1760, 28, color=MUTED)
        footer()
    elif layout == 'formal-compact':
        title(620, 90)
        line(100, 168, 1500, 168)
        supplier(100, 230, labelled=False, org=False)
        recipient(880, 230, width=620)
        pair('Fakturanr', doc['invoiceNumber'], 100, 505, stacked=True, width=430, bold=True)
        pair('Fakturadatum', doc['issued'], 600, 505, stacked=True, width=400)
        pair('Betalas senast', doc['due'], 1100, 505, stacked=True, width=400)
        pair('Kundnummer', doc['customerNumber'], 100, 668)
        table(800)
        totals(100, 1210, width=650)
        payment(940, 1210, width=560, terms=False)
        text('Betalningsvillkor enligt avtal. Ange OCR vid betalning.', 100, 1640, 30)
        footer(org=True)
    elif layout == 'right-address':
        title(100, 92)
        supplier(850, 230, width=650)
        recipient(100, 230)
        pair('Fakturanummer', doc['invoiceNumber'], 100, 520, width=680, bold=True)
        pair('Fakturadatum', doc['issued'], 850, 520)
        pair('Förfallodatum', doc['due'], 850, 585)
        pair('Beställningsnummer', doc['orderNumber'], 100, 650)
        table(800)
        totals(100, 1220, width=690)
        panel(890, 1190, 630, 400, '#eef2f1')
        payment(920, 1225, width=570)
        text('Leveransen avser angiven beställning.', 100, 1710, 30)
        footer()
    elif layout == 'upper-payment-panel':
        panel(0, 0, 1600, 190, '#eaf0f6')
        title(100, 80)
        supplier(100, 250, labelled=False)
        pair('Bankgiro', doc['bankgiro'], 1050, 245, stacked=True, width=450)
        pair(doc['referenceLabel'], doc['reference'], 1050, 355, stacked=True, width=450)
        pair('Fakturanummer', doc['invoiceNumber'], 100, 535, width=700, bold=True)
        pair('Fakturadatum', doc['issued'], 850, 535)
        pair('Förfallodatum', doc['due'], 850, 605)
        recipient(100, 650)
        table(930)
        totals(810, 1350, width=690)
        text('Leveransadress enligt beställning.', 100, 1355, 30)
        text('Valuta: SEK', 100, 1412, 30)
        text('Ange fakturans OCR-nummer vid betalning.', 100, 1750, 30)
        footer()
    elif layout == 'ledger-form':
        title(100, 80)
        panel(80, 200, 1440, 165, '#f4f2ed')
        pair('Fakturanummer', doc['invoiceNumber'], 110, 228, stacked=True, width=420, bold=True)
        pair('Fakturadatum', doc['issued'], 610, 228, stacked=True, width=420)
        pair('Förfallodatum', doc['due'], 1110, 228, stacked=True, width=390)
        supplier(100, 420, org=False)
        recipient(850, 420)
        table(795)
        totals(840, 1210, width=660)
        payment(100, 1205, width=650)
        text('Betalningsvillkor: 20 dagar. Valuta: SEK.', 100, 1645, 30)
        footer(org=True)
    elif layout == 'stacked-summary':
        title(100, 90)
        supplier(100, 245, labelled=False)
        recipient(900, 245, width=600)
        pair('Fakturanr', doc['invoiceNumber'], 100, 525, width=700, bold=True)
        pair('Fakturadatum', doc['issued'], 100, 590)
        pair('Förfallodatum', doc['due'], 900, 525, stacked=True, width=600)
        table(790)
        payment(100, 1230, width=650)
        totals(1030, 1205, width=470, stacked=True)
        text('Tjänsterna avser månadsvis drift och support.', 100, 1680, 30)
        footer()
    elif layout == 'horizontal-summary':
        supplier(100, 95, labelled=False, org=False)
        title(1500, 95, right=True)
        pair('Fakturanummer', doc['invoiceNumber'], 100, 355, stacked=True, width=430, bold=True)
        pair('Fakturadatum', doc['issued'], 610, 355, stacked=True, width=420)
        pair('Förfallodatum', doc['due'], 1110, 355, stacked=True, width=390)
        recipient(100, 555)
        pair('Er beställning', doc['orderNumber'], 850, 605)
        table(840)
        panel(80, 1220, 1440, 175, '#edf2f4')
        pair(doc['netLabel'], doc['net'] + ' SEK', 110, 1245, stacked=True, width=430)
        pair(doc['vatLabel'], doc['vat'] + ' SEK', 610, 1245, stacked=True, width=420)
        pair(doc['totalLabel'], doc['total'] + ' SEK', 1110, 1245, stacked=True, width=390, bold=True)
        pair('Bankgiro', doc['bankgiro'], 100, 1530, stacked=True)
        pair(doc['referenceLabel'], doc['reference'], 850, 1530, stacked=True)
        text('Ange OCR-numret vid betalning.', 100, 1680, 30)
        footer(org=True)
    elif layout == 'side-rail':
        panel(0, 0, 50, HEIGHT, '#365c70')
        title(160, 100)
        supplier(160, 265, labelled=False, width=730)
        pair('Fakturanummer', doc['invoiceNumber'], 1080, 250, stacked=True, width=420, bold=True)
        pair('Fakturadatum', doc['issued'], 1080, 365, stacked=True, width=420)
        pair('Betalas senast', doc['due'], 1080, 480, stacked=True, width=420)
        recipient(160, 545)
        table(830, x=160, width=1340)
        payment(160, 1250, width=610)
        totals(830, 1250, width=670)
        text('Transporten är utförd enligt överenskommen beställning.', 160, 1705, 28)
        footer()
    elif layout == 'classic-footer':
        title(625, 95)
        line(100, 180, 1500, 180)
        supplier(100, 255, org=False)
        recipient(880, 255, width=620)
        pair('Fakturanummer', doc['invoiceNumber'], 100, 560, width=690, bold=True)
        pair('Fakturadatum', doc['issued'], 850, 560)
        pair('Förfallodatum', doc['due'], 850, 630)
        table(805)
        totals(820, 1220, width=680)
        text('Moms 25 % beräknas på nettobeloppet.', 100, 1230, 30)
        line(100, 1580, 1500, 1580)
        pair('Bankgiro', doc['bankgiro'], 100, 1630, stacked=True)
        pair(doc['referenceLabel'], doc['reference'], 850, 1630, stacked=True)
        footer(org=True)
    elif layout == 'paired-sections':
        title(100, 100)
        panel(80, 230, 700, 275, '#f3f5f6')
        panel(820, 230, 700, 275, '#f3f5f6')
        supplier(105, 255, org=False, width=650)
        recipient(845, 255, width=650)
        pair('Fakturanummer', doc['invoiceNumber'], 100, 580, stacked=True, width=430, bold=True)
        pair('Fakturadatum', doc['issued'], 610, 580, stacked=True, width=420)
        pair('Förfallodatum', doc['due'], 1110, 580, stacked=True, width=390)
        table(835)
        payment(100, 1260, width=650)
        totals(810, 1260, width=690)
        text('Valuta: SEK. Ange OCR-numret som betalningsreferens.', 100, 1670, 28)
        footer(org=True)
    else:
        raise ValueError('Unknown preregistered layout: ' + layout)
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise SystemExit('Refusing to overwrite an existing render directory')
    specs = json.loads(SPEC.read_text())
    assert len([d for d in specs['cases'] if d['population'] == 'normal-readable']) == 10
    assert len([d for d in specs['cases'] if d['population'] == 'stress']) == 2
    output.mkdir(parents=True)
    (output / 'images').mkdir()
    rendered, images = {}, []
    for doc in specs['cases']:
        if doc['population'] == 'normal-readable':
            image = render(doc)
        else:
            image = rendered[doc['sourceId']].copy()
            if doc['layout'] == 'lost-bottom-scan':
                ImageDraw.Draw(image).rectangle((0, 1165, WIDTH, HEIGHT), fill='white')
                ImageDraw.Draw(image).line((0, 1164, WIDTH, 1164), fill='#c6c6c6', width=3)
            elif doc['layout'] == 'defocused-tilted-photo':
                image = image.resize((400, 500), Image.Resampling.BILINEAR).resize((WIDTH, HEIGHT), Image.Resampling.BILINEAR)
                image = image.filter(ImageFilter.GaussianBlur(2.3))
                image = ImageEnhance.Contrast(image).enhance(0.36)
                image = image.rotate(1.7, Image.Resampling.BICUBIC, fillcolor='#c5c5c5')
            else:
                raise ValueError('Unknown stress transform')
        rendered[doc['id']] = image
        filename = 'images/' + doc['id'] + '.png'
        image.save(output / filename, format='PNG', compress_level=9, dpi=(200, 200))
        data = (output / filename).read_bytes()
        images.append({key: doc[key] for key in ['id', 'population', 'layout', 'metadata', 'notes']} | {'sourceId': doc.get('sourceId'), 'filename': filename, 'mimeType': 'image/png', 'width': WIDTH, 'height': HEIGHT, 'bytes': len(data), 'sha256': digest(data)})
    qa_font = ImageFont.truetype(FONTS['liberation-sans'][0], 23)
    for page, start in enumerate(range(0, len(specs['cases']), 4), 1):
        subset = specs['cases'][start:start + 4]
        sheet = Image.new('RGB', (1200, 1580), '#d7dce0')
        draw = ImageDraw.Draw(sheet)
        for n, doc in enumerate(subset):
            x, y = (n % 2) * 600, (n // 2) * 790
            draw.text((x + 16, y + 9), doc['id'], font=qa_font, fill=INK)
            sheet.paste(rendered[doc['id']].resize((584, 730), Image.Resampling.LANCZOS), (x + 8, y + 42))
        sheet.save(output / f'contact-{page}.png', format='PNG', compress_level=9)
    (output / 'rendered-text-bounds.json').write_text(json.dumps(BOUNDS, ensure_ascii=False, indent=2) + '\n')
    inventory = {'schema': 'mgeorge-holdout-render-v2', 'specificationSha256': digest(SPEC.read_bytes()), 'generatorSha256': digest(Path(__file__).read_bytes()), 'pillowVersion': PIL.__version__, 'fonts': {path: digest(Path(path).read_bytes()) for family in FONTS.values() for path in family}, 'images': images, 'noOcrInvoked': True}
    (output / 'render-inventory.json').write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'normal': 10, 'stress': 2, 'images': len(images), 'noOcrInvoked': True}))


if __name__ == '__main__':
    main()
