"""Compose round-4 before/after pairs: tools/pairs-r4.py BEFORE_DIR AFTER_DIR OUT_DIR [prefix]

Each pair is before (left) | after (right), labelled, as WebP. Phone shots
differ in density (r3 DPR 2, r4 DPR 3), so both sides are scaled to the same
CSS-pixel width before composing. Also writes a phone model close-up pair at
the after side's native density so the 3D crispness change is visible.
"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont

before, after, out = sys.argv[1:4]
prefix = sys.argv[4] if len(sys.argv) > 4 else ''
os.makedirs(out, exist_ok=True)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 22)
except OSError:
    font = ImageFont.load_default()


def css(img, name):
    w = 780 if name.startswith('phone') else img.width
    return img if img.width == w else img.resize((w, round(img.height * w / img.width)), Image.Resampling.LANCZOS)


def pair(a, b, label_a, label_b, path, scale: float=1):
    gap, bar = 16, 40
    W, H = a.width + b.width + gap, max(a.height, b.height) + bar
    c = Image.new('RGB', (W, H), (16, 22, 23))
    c.paste(a, (0, bar)); c.paste(b, (a.width + gap, bar))
    d = ImageDraw.Draw(c)
    d.text((10, 8), label_a, fill=(200, 210, 206), font=font)
    d.text((a.width + gap + 10, 8), label_b, fill=(120, 230, 190), font=font)
    if scale != 1:
        c = c.resize((round(W * scale), round(H * scale)), Image.Resampling.LANCZOS)
    c.save(path, 'WEBP', quality=84, method=6)
    print('wrote', path, c.size)


for name in ['desktop-fit', 'laptop-fit', 'phone-fit', 'phone-fit-sheet', 'desktop-turned', 'laptop-turned', 'phone-turned', 'phone-turned-sheet']:
    pa, pb = os.path.join(before, name + '.png'), os.path.join(after, name + '.png')
    if not (os.path.exists(pa) and os.path.exists(pb)):
        continue
    a, b = css(Image.open(pa).convert('RGB'), name), css(Image.open(pb).convert('RGB'), name)
    pair(a, b, 'Before · round 3 (e28b747)', 'After · round 4', os.path.join(out, prefix + name + '.webp'), 0.75 if not name.startswith('phone') else 0.6)

# Phone 3D close-up at native density: CSS box x 40–350, y 220–600.
for name in ['phone-fit']:
    pa, pb = os.path.join(before, name + '.png'), os.path.join(after, name + '.png')
    if not (os.path.exists(pa) and os.path.exists(pb)):
        continue
    A, B = Image.open(pa).convert('RGB'), Image.open(pb).convert('RGB')
    da, db = A.width / 390, B.width / 390
    box = (40, 220, 350, 600)
    a = A.crop((round(box[0]*da), round(box[1]*da), round(box[2]*da), round(box[3]*da))).resize((round(310 * 2), round(380 * 2)), Image.Resampling.LANCZOS)
    b = B.crop((round(box[0]*db), round(box[1]*db), round(box[2]*db), round(box[3]*db))).resize((round(310 * 2), round(380 * 2)), Image.Resampling.LANCZOS)
    ra, rb = (json.load(open(os.path.join(d, 'metrics.json')))['metrics'][name].get('dpr') for d in (before, after))
    pair(a, b, f'Before · canvas at {ra} x', f'After · canvas at {rb} x, edge line', os.path.join(out, prefix + name + '-closeup.webp'))
