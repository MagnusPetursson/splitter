#!/usr/bin/env python3
"""Inventory user-visible copy from source (HTML text/attributes, JS string
literals that look like prose, Markdown docs) into a CSV.

  python3 tools/copy-inventory.py > copy-audit/inventory-source.csv

Heuristic: a JS literal counts when it contains a letter and either a space or
starts with a capital letter, and is not an obvious selector, path, CSS or
identifier. Over-inclusion is intended; the review is manual.
"""
import csv, html, re, sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
rows = []


class Copy(HTMLParser):
    ATTRS = ('aria-label', 'title', 'alt', 'placeholder', 'aria-description')
    SKIP = {'script', 'style', 'svg'}

    def __init__(self, name):
        super().__init__(convert_charrefs=True)
        self.name, self.stack, self.ids = name, [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        self.stack.append(tag)
        self.ids.append(a.get('id') or (a.get('class') or '').split(' ')[0] or tag)
        for k in self.ATTRS:
            if a.get(k) and 'svg' not in self.stack:
                rows.append((f'{self.name}:{self.getpos()[0]}', f'attr:{k}', tag, a[k]))
        if tag in ('meta',) and a.get('name') == 'description':
            rows.append((f'{self.name}:{self.getpos()[0]}', 'meta', tag, a.get('content', '')))
        if tag in ('img', 'input', 'meta', 'link', 'br', 'use', 'path', 'circle', 'rect'):
            self.stack.pop(); self.ids.pop()

    def handle_endtag(self, tag):
        while self.stack:
            t = self.stack.pop(); self.ids.pop()
            if t == tag:
                break

    def handle_data(self, data):
        t = ' '.join(data.split())
        if not t or any(s in self.SKIP for s in self.stack):
            return
        tag = self.stack[-1] if self.stack else '-'
        kind = {'button': 'button', 'summary': 'disclosure', 'a': 'link', 'h1': 'heading', 'h2': 'heading',
                'h3': 'heading', 'title': 'page-title', 'label': 'label', 'option': 'option',
                'th': 'table', 'td': 'table', 'caption': 'table', 'dt': 'term', 'kbd': 'key'}.get(tag, 'text')
        rows.append((f'{self.name}:{self.getpos()[0]}', kind, tag, t))


for f in ('web/index.html', 'web/guide.html'):
    Copy(f).feed((ROOT / f).read_text())

LIT = re.compile(r"""'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`""")
NOISE = re.compile(r'^[#.\[]|^[a-z0-9_-]+$|^[\w./-]+\.(js|css|png|stl|obj|3mf|zip|wasm|json|svg)$|^(rgba?|#|var\()|^\d|^[a-z]+(-[a-z]+)+$|=>|^\s*$')
for f in sorted((ROOT / 'web/js').glob('*.js')):
    if f.name in ('wasm_exec.js',):
        continue
    src = f.read_text()
    for m in LIT.finditer(src):
        s = next(g for g in m.groups() if g is not None)
        if not re.search(r'[A-Za-z]', s) or NOISE.search(s):
            continue
        if not (' ' in s or re.match(r'^[A-Z][a-z]', s)):
            continue
        if re.search(r'querySelector|addEventListener|^\s*<(svg|path|symbol)|^(application|image|text)/', s):
            continue
        line = src.count('\n', 0, m.start()) + 1
        txt = ' '.join(re.sub(r'<[^>]+>', ' ', s).split())
        if len(re.findall(r'[A-Za-z]{2,}', txt)) < 1:
            continue
        rows.append((f'web/js/{f.name}:{line}', 'js-literal', '', txt[:400]))

for f in ['README.md', *sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'docs').glob('*.md'))]:
    for i, line in enumerate((ROOT / f).read_text().splitlines(), 1):
        if line.strip():
            kind = 'doc-heading' if line.startswith('#') else 'doc-text'
            rows.append((f'{f}:{i}', kind, '', line.strip()[:400]))

w = csv.writer(sys.stdout)
w.writerow(['location', 'kind', 'element', 'current text'])
w.writerows(rows)
