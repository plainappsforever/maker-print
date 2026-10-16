import json, collections
c = json.load(open('cases.json')); e = json.load(open('engine.json'))
mis = collections.defaultdict(list); n = collections.Counter()
def close(a, b, tol=1e-6): return abs(a - b) <= tol
def chk(cls, ok, info):
    n[cls] += 1
    if not ok: mis[cls].append(info)
for i, (a, b) in enumerate(zip(c['mmToPt'], e['mmToPt'])): chk('units.mmToPt.exactDouble', a['pt'] == b, (a, b))
w1 = c['w1']; ew = e['w1']
chk('W1.a4pt', ew['a4pt'] == w1['a4pt'], (ew['a4pt'], w1['a4pt'])); chk('W1.letterpt', ew['letterpt'] == w1['letterpt'], ew['letterpt']); chk('W1.100mm', ew['pt100'] == w1['pt100'], ew['pt100'])
for (t, l, u, mm), r in zip(w1['parse'], ew['parse']): chk('units.parse.ok', r.get('ok') and close(r['mm'], mm, 1e-9), (t, l, u, mm, r))
for (t, l, u), r in zip(w1['parseErr'], ew['parseErr']): chk('units.parse.err', not r.get('ok'), (t, r))
for k, p in c['papers'].items():
    q = e['papers'].get(k)
    chk('paper.size', q and q['w'] == p['w'] and q['h'] == p['h'], (k, p, q))
    chk('paper.margin', q and q['margin'] == p['margin'], (k, q and q['margin']))
    s = q and q['safe']; chk('paper.safe', s and all(close(x, y, 1e-9) for x, y in zip([s['x'], s['y'], s['w'], s['h']], p['safe'])), (k, s, p['safe']))
chk('paper.catalogue.extra', set(e['papers']) == set(c['papers']), set(e['papers']) ^ set(c['papers']))
for i, (a, b) in enumerate(zip(c['tiling'], e['tiling'])):
    if 'threw' in b: chk('tiling.threw', False, (a, b)); continue
    chk('tiling.mode', a['mode'] == b['mode'], (i, a['W'], a['H'], a['key'], a['choice'], a['m'], a['o'], a['mode'], b['mode']))
    chk('tiling.orientation', a['orientation'] == b['orientation'], (i, a['W'], a['H'], a['key'], a['choice'], a['m'], a['o'], a['orientation'], b['orientation'], a['pages'], b['pages']))
    chk('tiling.counts', (a['cols'], a['rows']) == (b['cols'], b['rows']), (i, a['W'], a['H'], a['key'], a['m'], a['o'], a['orientation'], (a['cols'], a['rows']), (b['cols'], b['rows'])))
    if 'tiles' in a and 'tiles' in b:
        chk('tiling.tileCount', len(a['tiles']) == len(b['tiles']), (i, len(a['tiles']), len(b['tiles'])))
        for ta, tb in zip(a['tiles'], b['tiles']):
            chk('tiling.label', ta['label'] == tb['label'], (ta['label'], tb['label']))
            r = tb['region']; chk('tiling.region', all(close(x, y) for x, y in zip(ta['region'], [r['x'], r['y'], r['w'], r['h']])), (i, ta['label'], ta['region'], r))
            v = tb['visible']; chk('tiling.visible', all(close(x, y) for x, y in zip(ta['visible'], [v['x'], v['y'], v['w'], v['h']])), (i, ta['label'], ta['visible'], v))
        A = sorted((round(x, 6), round(y, 6)) for x, y in a['reg']); B = sorted((round(p['x'], 6), round(p['y'], 6)) for p in b['reg'])
        chk('registration.points', A == B, (i, a['W'], a['H'], a['key'], a['m'], a['o'], a['orientation'], a['cols'], a['rows'], len(A), len(B), [p for p in A if p not in B][:4], [p for p in B if p not in A][:4]))
for a, b in zip(c['named'], e['named']): chk('W3-W5.named', [a['portrait'], a['landscape']] == b, (a, b))
chk('labels', c['letters'] == e['letters'], [(i, x, y) for i, (x, y) in enumerate(zip(c['letters'], e['letters'])) if x != y][:5])
for a, b in zip(c['calibration'], e['calibration']):
    chk('cal.scale', close(a['s'], b['scale'], 1e-12), (a, b)); chk('cal.correction', close(a['c'], b['correction'], 1e-12), (a, b))
    chk('cal.verdict', a['verdict'] == b['verdict'], (a['N'], a['M'], a['verdict'], b['verdict']))
    chk('cal.causes', sorted(a['causes']) == sorted(b['causes']), (a['N'], a['M'], a['s'], a['verdict'], a['causes'], b['causes']))
for a, b in zip(c['correction'], e['correction']): chk('cal.correctionMap', close(a['q'][0], b['x'], 1e-9) and close(a['q'][1], b['y'], 1e-9), (a, b))
chk('W7', close(e['w7']['a']['correction'], c['w7']['c'], 1e-12) and close(e['w7']['x20'], c['w7']['x20'], 1e-9) and e['w7']['a']['verdict'] == 'explain', e['w7'])
for a, b in zip(c['fill'], e['fill']):
    if a['cols'] < 1 or a['rows'] < 1: chk('fill.none', b is None, (a, b)); continue
    if b is None: chk('fill.counts', False, (a, None)); continue
    chk('fill.counts', (a['cols'], a['rows']) == (b['cols'], b['rows']), (a['key'], a['w'], a['h'], a['deg'], a['gx'], a['gy'], (a['cols'], a['rows']), (b['cols'], b['rows'])))
    chk('fill.position', close(a['x'], b['x'], 1e-6) and close(a['y'], b['y'], 1e-6), (a, b))
for a, b in zip(c['trim'], e['trim']):
    if 'threw' in b: chk('trim.threw', False, b); continue
    for side, exp in a['sides'].items():
        got = b['bySide'][side]
        if exp is None: chk('trim.omitted', side in b['omitted'] and not got, (side, a['rooms'][side], got[:1], b['omitted'])); continue
        G = sorted([round(s['x0'], 6), round(s['y0'], 6), round(s['x1'], 6), round(s['y1'], 6)] for s in got)
        E = sorted([round(v, 6) for v in s] for s in exp)
        chk('trim.segments', G == E, (side, a['rooms'][side], E[:2], G[:2], len(E), len(G)))
for a, b in zip(c['ppi'], e['ppi']):
    chk('ppi.value', close(a['ppi'], b['ppi'], 1e-9 * a['ppi']), (a, b)); chk('ppi.band', a['band'] == b['band'], (a, b))
chk('W2', all(close(x, y, 1e-6) for x, y in zip(c['w2'], e['w2'])), (c['w2'], e['w2']))
chk('W10', e['w10'] and close(e['w10']['factor'], c['w10']['k'], 1e-12) and close(e['w10']['w'], c['w10']['w'], 1e-9), (c['w10'], e['w10']))
for a, b in zip(c['svg'], e['svg']):
    if 'err' in a: chk('svg.noSize', not b['ok'], (a, b)); continue
    if not b['ok']: chk('svg.size', False, (a, b)); continue
    chk('svg.size', close(a['wMm'], b['wMm'], 1e-9 * max(1, a['wMm'])) and close(a['hMm'], b['hMm'], 1e-9 * max(1, a['hMm'])), (a, b))
    chk('svg.needsPpi', a['needsPpi'] == b['needsPpi'], (a, b))
for a, b in zip(c['pdf'], e['pdf']):
    if 'threw' in b: chk('pdf.threw', False, (a, b)); continue
    chk('pdf.size', close(a['wMm'], b['wMm'], 1e-9 * max(1, a['wMm'])) and close(a['hMm'], b['hMm'], 1e-9 * max(1, a['hMm'])), (a, b))
    chk('pdf.rotate', a['rotate'] == b['rotate'], (a['rot'], b['rotate']))
tot = sum(n.values()); bad = sum(len(v) for v in mis.values())
print('checks', tot, 'mismatches', bad)
for k in sorted(n): print(f'  {k:28s} {n[k]:6d}  mismatches {len(mis[k])}')
for k, v in mis.items():
    print('==', k, len(v));
    for x in v[:6]: print('   ', x)
