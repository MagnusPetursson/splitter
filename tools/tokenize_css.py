#!/usr/bin/env python3
"""One-shot: rewrite hard-coded colours, font sizes and font stacks in the
app stylesheets to design tokens (web/css/tokens.css). Prints the colour map
so every substitution can be reviewed. Usage: python3 tools/tokenize_css.py"""
import re, sys, colorsys, pathlib
root = pathlib.Path(__file__).resolve().parents[1] / 'web' / 'css'
tok = {}
for name, hexv in re.findall(r'--([a-z0-9-]+):\s*(#[0-9a-f]{6})\b', (root / 'tokens.css').read_text()):
    if name not in ('pin',): tok[name] = hexv
def lab(h):
    h = h.lstrip('#'); r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    r, g, b = f(r), f(g), f(b)
    x, y, z = (r * .4124 + g * .3576 + b * .1805) / .95047, r * .2126 + g * .7152 + b * .0722, (r * .0193 + g * .1192 + b * .9505) / 1.08883
    t = lambda v: v ** (1 / 3) if v > .008856 else 7.787 * v + 16 / 116
    return 116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))
def nearest(h):
    a = lab(h)
    return min(tok, key=lambda n: sum((p - q) ** 2 for p, q in zip(a, lab(tok[n]))))
def expand(h):
    h = h[1:]
    if len(h) in (3, 4): h = ''.join(c * 2 for c in h)
    return '#' + h[:6], (int(h[6:8], 16) / 255 if len(h) == 8 else 1)
SIZE = lambda px: 12 if px <= 12.5 else 14 if px <= 15 else 16 if px <= 18 else 20 if px <= 22 else 24 if px <= 28 else 32
seen = {}
def fix(text):
    # colours, except inside shadows (kept as neutral black/white glows)
    def col(m):
        raw = m.group(0)
        base, alpha = expand(raw)
        if base in ('#000000', '#ffffff'): return raw
        n = nearest(base); seen[raw] = n
        return f'var(--{n})' if alpha >= .999 else f'color-mix(in srgb, var(--{n}) {round(alpha * 100)}%, transparent)'
    out = []
    for line in text.split('\n'):
        if re.match(r'\s*:root\s*\{\s*--bg', line):
            keep = re.findall(r'--side:\s*[^;]+;', line)
            fontm = re.search(r'font:\s*([^;]+);', line)
            line = ':root { ' + ' '.join(keep) + ' }'
        elif re.match(r'\s*--(bg|acc):', line):
            continue  # app.css multi-line palette: superseded by tokens.css
        def body(b):
            def decl(d):
                if 'shadow' in d.split(':')[0]: return d
                return re.sub(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,4}\b', col, d)
            return '{' + ';'.join(decl(d) for d in b.group(1).split(';')) + '}'
        line = re.sub(r'\{([^{}]*)\}', body, line)
        line = re.sub(r'font-size:\s*([0-9.]+)px', lambda m: f'font-size:var(--fs-{SIZE(float(m.group(1)))})', line)
        line = re.sub(r'font:\s*(\d+\s+)?([0-9.]+)px', lambda m: f'font:{m.group(1) or ""}var(--fs-{SIZE(float(m.group(2)))})', line)
        line = line.replace('"Segoe UI",Roboto,Ubuntu,sans-serif', 'var(--font-sans)').replace('"Segoe UI",sans-serif', 'var(--font-sans)')
        line = line.replace('system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif', 'var(--font-sans)')
        line = re.sub(r'ui-monospace,\s*(SFMono-Regular,\s*Menlo,\s*)?monospace', 'var(--font-mono)', line)
        out.append(line)
    return '\n'.join(out)
for f in ('app.css', 'flow.css', 'merge.css'):
    p = root / f; p.write_text(fix(p.read_text()))
for raw, n in sorted(seen.items(), key=lambda kv: kv[1]): print(f'{raw:10s} -> --{n}')
