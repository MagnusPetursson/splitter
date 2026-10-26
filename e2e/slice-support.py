#!/usr/bin/env python3
"""Slice exported, print-oriented STLs using one fixed stock preset.
Usage: python3 e2e/slice-support.py EXPORT_DIR VENDOR_INI
Requires installed Flatpak com.prusa3d.PrusaSlicer. Does not print anything.
The exported report.json determines part multiplicities (including pins).
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

case, vendor = map(lambda s: Path(s).resolve(), sys.argv[1:3])
out = case / 'slice'
out.mkdir(exist_ok=True)
sections, current = {}, None
for line in vendor.read_text().splitlines():
    match = re.match(r'^\[(\w+):(.+)\]$', line)
    if match:
        current = tuple(match.groups())
        sections[current] = {}
    elif current and '=' in line and not line.lstrip().startswith('#'):
        k, v = line.split('=', 1)
        sections[current][k.strip()] = v.strip()

def resolve(kind, name):
    section, result = sections[kind, name], {}
    for parent in section.get('inherits', '').split(';'):
        if parent.strip():
            result.update(resolve(kind, parent.strip()))
    result.update({k: v for k, v in section.items() if k != 'inherits'})
    return result

profiles = {
    'printer': 'Prusa CORE One 0.4 nozzle',
    'print': '0.20mm STRUCTURAL @COREONE 0.4',
    'filament': 'Generic PLA @COREONE',
}
for kind, name in profiles.items():
    config = resolve(kind, name)
    for key in ('compatible_printers_condition', 'compatible_prints_condition', 'renamed_from'):
        config.pop(key, None)
    (out / (kind+'.ini')).write_text(''.join(f'{k} = {v}\n' for k,v in config.items()))
(out/'override.ini').write_text('support_material = 1\nsupport_material_auto = 1\nsupport_material_buildplate_only = 0\n')
cli = ['flatpak', 'run', '--env=LC_ALL=C.UTF-8', '--env=LANG=C.UTF-8', f'--filesystem={case}', '--command=prusa-slicer', 'com.prusa3d.PrusaSlicer']
report = json.loads((case/'report.json').read_text())
counts = {p['label']:p.get('count',1) for p in report['parts']}
results = {'profiles':profiles, 'vendorSHA256':hashlib.sha256(vendor.read_bytes()).hexdigest(), 'parts':[], 'total_seconds':0, 'total_grams':0}
for model in sorted((case/'parts').glob('*.stl')):
    gcode = out / (model.stem+'.gcode')
    command = cli.copy()
    for kind in [*profiles, 'override']:
        command.extend(['--load', str(out/(kind+'.ini'))])
    command.extend(['--export-gcode','--binary-gcode=0','--output',str(gcode),str(model)])
    process = subprocess.run(command, capture_output=True, text=True, timeout=3600)
    (out/(model.stem+'.log')).write_text(process.stdout+'\n'+process.stderr)
    if process.returncode != 0:
        raise RuntimeError(f'{model.name}: PrusaSlicer exit {process.returncode}; see log')
    text = gcode.read_text(errors='replace')
    def get(key):
        found = re.search(r'^; '+re.escape(key)+r' = (.*)$',text,re.M)
        if not found:
            raise ValueError(f'Missing G-code field {key}')
        return found[1]
    clock = get('estimated printing time (normal mode)')
    seconds = sum(int(n)*{'d':86400,'h':3600,'m':60,'s':1}[u] for n,u in re.findall(r'(\d+)([dhms])',clock))
    grams = float(get('total filament used [g]'))
    count = counts[model.stem]
    record={'file':model.name,'sha256':hashlib.sha256(model.read_bytes()).hexdigest(),'count':count,'seconds':seconds,'grams':grams,'time':clock,'support_material':get('support_material'),'layer_height':get('layer_height'),'nozzle_diameter':get('nozzle_diameter')}
    results['parts'].append(record)
    results['total_seconds']+=seconds*count
    results['total_grams']+=grams*count
    print(json.dumps(record),flush=True)
    (out/'results.json').write_text(json.dumps(results,indent=2))
if not results['parts']:
    raise RuntimeError('No exported parts found')
print('TOTAL',results['total_seconds']/3600,'h',results['total_grams'],'g',flush=True)
