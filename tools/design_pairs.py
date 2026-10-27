#!/usr/bin/env python3
"""Before/after pairs for docs/ux/DESIGN.md. Usage:
python3 tools/design_pairs.py BEFORE_DIR AFTER_DIR OUT_DIR name[,name...]"""
import sys, pathlib
from PIL import Image, ImageDraw, ImageFont
b, a, out, names = sys.argv[1], sys.argv[2], pathlib.Path(sys.argv[3]), sys.argv[4].split(',')
out.mkdir(parents=True, exist_ok=True)
try: font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except OSError: font = ImageFont.load_default()
for n in names:
    ims = [Image.open(pathlib.Path(d) / f'{n}.png').convert('RGB') for d in (b, a)]
    phone = ims[0].width < 600
    scale = 1.0 if phone else 0.5
    ims = [im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS) for im in ims]
    w, h, gap, top = ims[0].width, ims[0].height, 16, 40
    can = Image.new('RGB', (2 * w + gap, h + top), (13, 19, 20))
    d = ImageDraw.Draw(can)
    for i, (im, label) in enumerate(zip(ims, ('Before', 'After'))):
        x = i * (w + gap); can.paste(im, (x, top)); d.text((x + 4, 8), label, fill=(173, 189, 185) if i == 0 else (143, 220, 188), font=font)
    can.save(out / f'{n}.webp', 'WEBP', quality=82, method=6)
    print('wrote', out / f'{n}.webp')
