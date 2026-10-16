#!/usr/bin/env python3
"""Blind SVG fixture set for Maker Print (P3.5 review). Written from the SVG 1.1/2 + CSS specs, without reading
src/import. Truth = natural size in mm at a given ppi and per-feature rectangles (mm, natural frame, y down)."""
import json, math, os, base64
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'svg')
NS = 'xmlns="http://www.w3.org/2000/svg"'
XL = 'xmlns:xlink="http://www.w3.org/1999/xlink"'
IN = 25.4
exp = {}
def put(name, text, ppi, size, feats, report=None, note=''):
    open(os.path.join(D, name), 'w').write(text)
    exp[name] = {'ppi': ppi, 'size': size, 'features': feats, 'report': report or [], 'note': note}
def R(c, x0, y0, x1, y1): return {'colour': c, 'rect': [x0, y0, x1, y1]}

s = 25.4 / 96
put('b01-viewbox-only.svg', f'<svg {NS} viewBox="0 0 200 100"><rect x="50" y="25" width="100" height="50" fill="#ff0000"/></svg>',
    96, [200 * s, 100 * s, True], [R('red', 50 * s, 25 * s, 150 * s, 75 * s)], note='viewBox only -> ask ppi; 96')
s72 = 25.4 / 72
put('b01b-viewbox-only-72.svg', f'<svg {NS} viewBox="0 0 200 100"><rect x="50" y="25" width="100" height="50" fill="#ff0000"/></svg>',
    72, [200 * s72, 100 * s72, True], [R('red', 50 * s72, 25 * s72, 150 * s72, 75 * s72)])
put('b02-width-in.svg', f'<svg {NS} width="4in" height="2in" viewBox="0 0 400 200"><rect x="100" y="50" width="200" height="100" fill="#ff0000"/></svg>',
    96, [101.6, 50.8, False], [R('red', 25.4, 12.7, 76.2, 38.1)])
put('b03-width-cm-noviewbox.svg', f'<svg {NS} width="10cm" height="5cm"><rect x="0" y="0" width="96" height="48" fill="#ff0000"/>'
    '<rect x="50mm" y="10mm" width="2cm" height="1in" fill="#0000ff"/></svg>',
    96, [100, 50, False], [R('red', 0, 0, 25.4, 12.7), R('blue', 50, 10, 70, 35.4)], note='no viewBox: user unit = CSS px; mm units inside')
put('b03b-width-cm-noviewbox-72.svg', f'<svg {NS} width="10cm" height="5cm"><rect x="0" y="0" width="96" height="48" fill="#ff0000"/></svg>',
    72, [100, 50, False], [R('red', 0, 0, 25.4, 12.7)], note='physical width: the ppi answer must not matter')
put('b04-width-pt.svg', f'<svg {NS} width="144pt" height="72pt" viewBox="0 0 144 72"><rect x="36" y="18" width="72" height="36" fill="#ff0000"/></svg>',
    96, [50.8, 25.4, False], [R('red', 12.7, 6.35, 38.1, 19.05)])
put('b05-nested-transforms.svg', f'<svg {NS} width="100mm" height="100mm" viewBox="0 0 100 100">'
    '<g transform="translate(10,20)"><g transform="scale(2)"><g transform="rotate(90)"><rect x="0" y="-15" width="5" height="10" fill="#f00"/></g></g></g>'
    '<path transform="matrix(1,0,0.5,1,0,0) translate(50,50)" d="M0,0 h10 v10 h-10 z" fill="#00f"/>'
    '<g transform="rotate(45 70 80)"><rect x="65" y="75" width="10" height="10" fill="#0f0"/></g></svg>',
    96, [100, 100, False], [R('red', 20, 20, 40, 30), R('blue', 75, 50, 90, 60), R('green', 70 - 5 * math.sqrt(2), 80 - 5 * math.sqrt(2), 70 + 5 * math.sqrt(2), 80 + 5 * math.sqrt(2))])
put('b06-use-symbol.svg', f'<svg {NS} {XL} width="100mm" height="60mm" viewBox="0 0 100 60"><defs>'
    '<symbol id="sq" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></symbol>'
    '<symbol id="sq2" viewBox="0 0 10 10"><rect width="10" height="10" fill="#0f0"/></symbol>'
    '<rect id="b" width="4" height="4"/></defs>'
    '<use href="#sq" x="10" y="10" width="20" height="20"/>'
    '<use xlink:href="#b" x="50" y="10" fill="#00f" transform="translate(5,0)"/>'
    '<use href="#sq2" x="70" y="10" width="20" height="10"/></svg>',
    96, [100, 60, False], [R('red', 10, 10, 30, 30), R('blue', 55, 10, 59, 14), R('green', 75, 10, 85, 20)], note='symbol viewBox meet in use box; fill inherited from use')
put('b07-css-cascade.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50"><style>'
    '.st0{fill:#FF0000;} .st1{fill:#0000FF;} rect.st2{fill:#00FF00} #x{fill:#0000ff} .st3{fill:#00ff00 !important}</style>'
    '<rect class="st0" fill="#0000ff" x="5" y="5" width="10" height="10"/>'
    '<rect class="st0" style="fill:#0000ff" x="20" y="5" width="10" height="10"/>'
    '<rect id="x" class="st0" x="35" y="5" width="10" height="10"/>'
    '<rect class="st2" x="50" y="5" width="10" height="10"/>'
    '<rect class="st3" style="fill:#ff0000" x="65" y="5" width="10" height="10"/>'
    '<rect class="st0 st1" x="80" y="5" width="10" height="10"/></svg>',
    96, [100, 50, False], [R('red', 5, 5, 15, 15), R('blue', 20, 5, 30, 15), R('blue', 35, 5, 45, 15), R('green', 50, 5, 60, 15), R('green', 65, 5, 75, 15), R('blue', 80, 5, 90, 15)])
put('b08-polyline.svg', f'<svg {NS} width="100mm" height="100mm" viewBox="0 0 100 100">'
    '<polyline points="10,10 40,10 40,40" fill="none" stroke="#f00" stroke-width="2"/>'
    '<polygon points="60,10 90,10 75,40" fill="#00f"/></svg>',
    96, [100, 100, False], [R('red', 10, 9, 41, 40), R('blue', 60, 10, 90, 40)], note='miter join corner, butt caps')
put('b09-clip-path.svg', f'<svg {NS} width="100mm" height="100mm" viewBox="0 0 100 100">'
    '<clipPath id="c"><rect x="20" y="20" width="30" height="10"/></clipPath>'
    '<rect x="0" y="0" width="100" height="50" fill="#f00" clip-path="url(#c)"/>'
    '<clipPath id="o" clipPathUnits="objectBoundingBox"><rect x="0" y="0" width="0.5" height="0.5"/></clipPath>'
    '<rect x="60" y="60" width="20" height="20" fill="#00f" clip-path="url(#o)"/>'
    '<clipPath id="t"><rect x="0" y="0" width="10" height="10" transform="translate(10,80)"/></clipPath>'
    '<rect x="0" y="70" width="40" height="30" fill="#0f0" clip-path="url(#t)"/></svg>',
    96, [100, 100, False], [R('red', 20, 20, 50, 30), R('blue', 60, 60, 70, 70), R('green', 10, 80, 20, 90)], report=['objectBoundingBox clip (approximated or exact)'])
put('b10-text.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50"><text x="10" y="20" font-size="10">Hello</text>'
    '<rect x="60" y="10" width="10" height="10" fill="#f00"/></svg>', 96, [100, 50, False], [R('red', 60, 10, 70, 20)], report=['text notDrawn'])
put('b11-markers.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50"><defs><marker id="m" markerWidth="4" markerHeight="4" refX="2" refY="2">'
    '<rect width="4" height="4" fill="#00f"/></marker></defs><line x1="10" y1="25" x2="80" y2="25" stroke="#f00" stroke-width="2" marker-end="url(#m)"/></svg>',
    96, [100, 50, False], [R('red', 10, 24, 80, 26)], report=['marker notDrawn'])
put('b12-gradient.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/>'
    '<stop offset="1" stop-color="#00f"/></linearGradient></defs><rect x="5" y="5" width="40" height="40" fill="url(#g)"/>'
    '<rect x="60" y="5" width="20" height="20" fill="url(#missing) #00ff00"/></svg>', 96, [100, 50, False], [R('green', 60, 5, 80, 25)],
    report=['gradient approximated', 'missing paint server with fallback -> fallback colour'])
png1 = base64.b64encode(bytes.fromhex('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cfc0000003010100c9fe92ef0000000049454e44ae426082')).decode()
put('b13-embedded-image.svg', f'<svg {NS} {XL} width="100mm" height="50mm" viewBox="0 0 100 50"><image x="5" y="5" width="20" height="20" xlink:href="data:image/png;base64,{png1}"/>'
    '<image x="30" y="5" width="20" height="20" href="photo.jpg"/><rect x="60" y="10" width="10" height="10" fill="#f00"/></svg>', 96, [100, 50, False], [R('red', 60, 10, 70, 20)],
    report=['2 images notDrawn (embedded + external)'])
put('b14-injection.svg', '<?xml version="1.0"?>\n<!DOCTYPE svg [ <!ENTITY ext SYSTEM "file:///etc/passwd"> <!ENTITY inner "#ff0000"> ]>\n'
    f'<svg {NS} {XL} width="100mm" height="50mm" viewBox="0 0 100 50" onload="alert(1)">'
    '<script>alert(document.cookie)</script><script xlink:href="http://example.com/x.js"/>'
    '<a href="javascript:alert(2)"><rect x="5" y="5" width="10" height="10" fill="#f00"/></a>'
    '<use href="http://example.com/evil.svg#a"/><use xlink:href="file:///etc/passwd#x"/>'
    '<image href="file:///etc/hosts" width="10" height="10"/>'
    '<foreignObject width="50" height="50"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="http://example.com"/></div></foreignObject>'
    '<style>@import url("http://example.com/a.css"); rect.z{fill:url(http://example.com/p.svg#g) #0000ff}</style>'
    '<rect class="z" x="20" y="5" width="10" height="10" onclick="evil()"/>'
    '<rect x="40" y="5" width="10" height="10" fill="&inner;"/><text x="60" y="20">&ext;</text></svg>',
    96, [100, 50, False], [R('red', 5, 5, 15, 15), R('blue', 20, 5, 30, 15)], report=['script/foreignObject/external refs reported, nothing fetched'])
laughs = '<?xml version="1.0"?>\n<!DOCTYPE lolz [<!ENTITY lol "lol">' + ''.join(f'<!ENTITY lol{i} "' + ('&lol%s;' % (i - 1 if i > 1 else '')) * 10 + '">' for i in range(1, 10)) + ']>\n'
laughs = laughs.replace('&lol0;', '&lol;')
put('b15-billion-laughs.svg', laughs + f'<svg {NS} width="10mm" height="10mm" viewBox="0 0 10 10"><title>&lol9;</title><rect width="5" height="5" fill="#f00"/></svg>',
    96, [10, 10, False], [R('red', 0, 0, 5, 5)], report=['entity expansion must not explode'])
put('b16-percent.svg', f'<svg {NS} width="100%" height="100%" viewBox="0 0 300 150"><rect x="0" y="0" width="150" height="75" fill="#f00"/></svg>',
    96, [300 * s, 150 * s, True], [R('red', 0, 0, 150 * s, 75 * s)])
put('b17a-par-meet.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f00"/></svg>',
    96, [100, 50, False], [R('red', 25, 0, 75, 50)])
put('b17b-par-none.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="#f00"/></svg>',
    96, [100, 50, False], [R('red', 0, 0, 100, 50)])
put('b17c-par-slice.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 100" preserveAspectRatio="xMinYMin slice"><rect width="100" height="40" fill="#f00"/><rect y="60" width="100" height="10" fill="#00f"/></svg>',
    96, [100, 50, False], [R('red', 0, 0, 100, 40)], note='blue is outside the viewport: must not print')
put('b18-nested-svg.svg', f'<svg {NS} width="100mm" height="100mm" viewBox="0 0 100 100"><svg x="10" y="10" width="40" height="20" viewBox="0 0 4 2">'
    '<rect width="4" height="2" fill="#f00"/><rect x="3" y="1" width="5" height="5" fill="#00f"/></svg></svg>',
    96, [100, 100, False], [R('red', 10, 10, 50, 30), R('blue', 40, 20, 50, 30)], note='blue drawn over red; clipped by the nested viewport')
put('b19-inherit-currentcolor.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50">'
    '<g color="#ff0000" fill="currentColor"><rect x="5" y="5" width="10" height="10"/></g>'
    '<g fill="#00f"><rect fill="none" stroke="#0f0" stroke-width="2" x="30" y="5" width="10" height="10"/></g>'
    '<rect x="60" y="5" width="10" height="10"/></svg>', 96, [100, 50, False], [R('red', 5, 5, 15, 15), R('green', 29, 4, 41, 16), R('black', 60, 5, 70, 15)])
put('b20-hidden.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50"><g display="none"><rect fill="#f00" x="5" y="5" width="10" height="10"/></g>'
    '<rect visibility="hidden" fill="#00f" x="20" y="5" width="10" height="10"/><rect fill="#0f0" opacity="0" x="40" y="5" width="10" height="10"/>'
    '<g visibility="hidden"><rect visibility="visible" fill="#f00" x="60" y="5" width="10" height="10"/></g></svg>',
    96, [100, 50, False], [R('red', 60, 5, 70, 15)], note='only the visible child of a hidden group prints')
put('b21-arcs.svg', f'<svg {NS} width="100mm" height="100mm" viewBox="0 0 100 100"><path d="M10 50 A 20 20 0 0 1 50 50 Z" fill="#f00"/>'
    '<path d="M60,90a15,15 0 1,0 30,0a15,15 0 1,0 -30,0z" fill="#00f"/><path d="M10,70l20-0 0,20-20,0z" fill="#0f0"/></svg>',
    96, [100, 100, False], [R('red', 10, 30, 50, 50), R('blue', 60, 75, 90, 100), R('green', 10, 70, 30, 90)], note='blue circle partly outside viewBox -> clipped to 100')
put('b22-inkscape.svg', '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg width="210mm" height="297mm" viewBox="0 0 210 297" version="1.1" id="svg1" '
    'xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" '
    f'{NS} xmlns:svg="http://www.w3.org/2000/svg"><sodipodi:namedview id="nv" inkscape:document-units="mm"/>'
    '<g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1" transform="translate(-12.5,-7.25)">'
    '<rect style="fill:#ff0000;fill-opacity:1;stroke:none;stroke-width:0.264583" id="rect1" width="30" height="20" x="22.5" y="17.25" /></g></svg>',
    96, [210, 297, False], [R('red', 10, 10, 40, 30)])
put('b23-colours.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50">'
    '<rect style="fill: RGB(255, 0, 0)" x="5" y="5" width="10" height="10"/><rect style="fill:rgb(0%,0%,100%)" x="20" y="5" width="10" height="10"/>'
    '<rect fill="hsl(120,100%,50%)" x="35" y="5" width="10" height="10"/><rect fill="Red" x="50" y="5" width="10" height="10"/>'
    '<rect fill="#00F" x="65" y="5" width="10" height="10"/><rect fill=" lime " x="80" y="5" width="10" height="10"/></svg>',
    96, [100, 50, False], [R('red', 5, 5, 15, 15), R('blue', 20, 5, 30, 15), R('green', 35, 5, 45, 15), R('red', 50, 5, 60, 15), R('blue', 65, 5, 75, 15), R('green', 80, 5, 90, 15)])
put('b24-switch-a.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50"><switch><g requiredFeatures="http://example.com/none" systemLanguage="xx">'
    '<rect fill="#00f" x="5" y="5" width="10" height="10"/></g><rect fill="#f00" x="20" y="5" width="10" height="10"/></switch>'
    '<a href="https://example.com"><rect fill="#0f0" x="40" y="5" width="10" height="10"/></a></svg>',
    96, [100, 50, False], [R('red', 20, 5, 30, 15), R('green', 40, 5, 50, 15)], note='switch: first child whose conditions pass (systemLanguage xx fails)')
put('b25-negative-viewbox.svg', f'<svg {NS} width="100mm" height="100mm" viewBox="-50 -50 100 100"><rect x="-10" y="-10" width="20" height="20" fill="#f00"/></svg>',
    96, [100, 100, False], [R('red', 40, 40, 60, 60)])
put('b26-prefixed-root.svg', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" width="50mm" height="50mm" viewBox="0 0 50 50"><svg:rect x="10" y="10" width="20" height="20" fill="#f00"/></svg:svg>',
    96, [50, 50, False], [R('red', 10, 10, 30, 30)])
put('b27-no-xmlns.svg', '<svg width="50mm" height="50mm" viewBox="0 0 50 50"><rect x="10" y="10" width="20" height="20" fill="#f00"/></svg>',
    96, [50, 50, False], [R('red', 10, 10, 30, 30)], note='no xmlns: browsers refuse, cutters accept; any honest outcome OK')
put('b28-sci-notation.svg', f'<svg {NS} width="1e2mm" height="5E1mm" viewBox="0 0 1e2 50"><rect x="1e1" y="10" width="2E1" height=".5e1" fill="#f00"/>'
    '<path d="M50 10h20v.5e1h-20z" fill="#00f"/></svg>', 96, [100, 50, False], [R('red', 10, 10, 30, 15), R('blue', 50, 10, 70, 15)])
put('b29-recursive-use.svg', f'<svg {NS} width="50mm" height="50mm" viewBox="0 0 50 50"><g id="g1"><rect x="5" y="5" width="10" height="10" fill="#f00"/><use href="#g1" x="20"/></g>'
    '<use id="u2" href="#u2"/></svg>', 96, [50, 50, False], [R('red', 5, 5, 15, 15)], report=['recursive use reported, no hang'])
put('b30-shapes-dash.svg', f'<svg {NS} width="100mm" height="60mm" viewBox="0 0 100 60"><circle cx="15" cy="15" r="10" fill="#f00"/>'
    '<ellipse cx="45" cy="15" rx="12" ry="6" fill="#00f"/><line x1="65" y1="15" x2="95" y2="15" stroke="#0f0" stroke-width="4" stroke-linecap="square"/>'
    '<rect x="5" y="35" width="30" height="20" rx="5" fill="#f00"/></svg>',
    96, [100, 60, False], [R('red', 5, 5, 25, 25), R('blue', 33, 9, 57, 21), R('green', 63, 13, 97, 17), R('red', 5, 35, 35, 55)])
put('b31-space-unit.svg', f'<svg {NS} width="100 mm" height="50 mm" viewBox="0 0 100 50"><rect width="10" height="10" fill="#f00"/></svg>',
    96, None, [], note='"100 mm" is not a valid CSS length: refuse or ask, never a silent wrong size')
put('b32-css-units-in-style.svg', f'<svg {NS} width="100mm" height="50mm" viewBox="0 0 100 50"><style>rect {{ stroke-width: 1mm }}</style>'
    '<rect x="10" y="10" width="20" height="20" fill="none" stroke="#f00"/></svg>', 96, [100, 50, False],
    [R('red', 10 - 0.5 * 96 / 25.4 * 100 / 100 * 25.4 / 96 * 1, 0, 0, 0)], note='placeholder replaced below')
# b32: user unit = 1 mm (viewBox 100 for 100mm); 1mm in CSS = 3.7795 user px... inside a viewBox the CSS mm is 96/25.4 user units.
sw = 96 / 25.4  # 1mm expressed in user units (1 user unit = 1 CSS px before the viewport transform)
exp['b32-css-units-in-style.svg']['features'] = [R('red', 10 - sw / 2, 10 - sw / 2, 30 + sw / 2, 30 + sw / 2)]
exp['b32-css-units-in-style.svg']['note'] = 'stroke-width 1mm = 3.7795 user units (CSS px) -> rendered 3.78 mm wide on this 1 unit = 1 mm drawing'
json.dump(exp, open(os.path.join(D, 'expected.json'), 'w'), indent=1)
print(len(exp), 'svg fixtures')
