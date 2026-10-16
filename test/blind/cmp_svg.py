import json, os
H = os.path.dirname(os.path.abspath(__file__))
exp = json.load(open(f'{H}/svg/expected.json')); summ = json.load(open(f'{H}/../out/svg-summary.json'))
meas = {os.path.basename(j['pdf']).replace('.pdf', '.svg'): j for j in json.load(open(f'{H}/../out/svg-measured.json'))}
TOL = 0.05
tot = bad = 0
for name, e in exp.items():
    s = summ[name]; lines = []
    if e['size'] is None:
        lines.append(f"  size: expected refusal/ask; got ok={s['ok']} natural={s.get('naturalMm')} needsPpi={s.get('needsPpi')}")
    else:
        tot += 1
        n = s.get('naturalMm')
        ok = n and abs(n['w'] - e['size'][0]) <= 1e-6 and abs(n['h'] - e['size'][1]) <= 1e-6 and s.get('needsPpi') == e['size'][2]
        if not ok: bad += 1
        lines.append(f"  size {'ok ' if ok else 'BAD'} exp {e['size'][0]:.4f}x{e['size'][1]:.4f} needsPpi={e['size'][2]} got {n and round(n['w'],4)}x{n and round(n['h'],4)} needsPpi={s.get('needsPpi')} err={s.get('error')}")
    m = meas.get(name)
    if m:
        for f, w in zip(e['features'], m['windows']):
            tot += 1
            ex = [f['rect'][0] + 20, f['rect'][1] + 20, f['rect'][2] + 20, f['rect'][3] + 20]
            if not w['found']: bad += 1; lines.append(f"  {f['colour']:5s} BAD not found, expected {[round(v-20,3) for v in ex]}"); continue
            d = max(abs(a - b) for a, b in zip(ex, w['bbox']))
            if d > TOL: bad += 1
            lines.append(f"  {f['colour']:5s} {'ok ' if d <= TOL else 'BAD'} dev {d:.4f} mm  exp {[round(v-20,3) for v in ex]} got {[round(v-20,3) for v in w['bbox']]}")
        st = {k: v for k, v in m['stray'].items() if v}
        tot += 1
        if st: bad += 1; lines.append(f"  STRAY ink outside windows: {st}")
    iss = [(i.get('code'), i.get('severity'), i.get('count')) for i in s.get('issues', [])] if s.get('issues') else []
    print(f"{name}: ok={s['ok']} {s.get('error') or ''} {s['ms']}ms warnings={s.get('warnings')} notes={s.get('notes')}\n  issues={iss}  {('NOTE: ' + e['note']) if e['note'] else ''}")
    print('\n'.join(lines))
print('TOTAL checks', tot, 'bad', bad)
