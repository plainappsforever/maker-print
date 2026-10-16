#!/usr/bin/env python3
"""Blind PDF fixtures (P3.5 review): hand-built PDFs with UserUnit, Rotate, CropBox != MediaBox, inherited attributes,
RC4-128 encryption with an empty user password, annotations, optional content, broken xref. Truth: displayed size (mm)
and the displayed bbox (mm, top-left origin, y down) of a red rectangle drawn in user space."""
import hashlib, json, os, struct
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pdf')
PAD = bytes.fromhex('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A')
MM = 25.4 / 72

def rc4(key, data):
    S = list(range(256)); j = 0
    for i in range(256):
        j = (j + S[i] + key[i % len(key)]) % 256; S[i], S[j] = S[j], S[i]
    i = j = 0; out = bytearray()
    for c in data:
        i = (i + 1) % 256; j = (j + S[i]) % 256; S[i], S[j] = S[j], S[i]; out.append(c ^ S[(S[i] + S[j]) % 256])
    return bytes(out)

def build(objs, fname, encrypt=None, broken_xref=False, root=1):
    """objs: list of (dict_bytes, stream_bytes|None). Object numbers 1..n."""
    fid = hashlib.md5(fname.encode()).digest()
    key = None; extra = b''
    if encrypt is not None:
        user, owner, P = encrypt
        n = 16
        h = hashlib.md5((owner.encode() + PAD)[:32]).digest()
        for _ in range(50): h = hashlib.md5(h[:n]).digest()
        okey = h[:n]
        O = rc4(okey, (user.encode() + PAD)[:32])
        for i in range(1, 20): O = rc4(bytes(b ^ i for b in okey), O)
        h = hashlib.md5((user.encode() + PAD)[:32] + O + struct.pack('<i', P) + fid).digest()
        for _ in range(50): h = hashlib.md5(h[:n]).digest()
        key = h[:n]
        U = rc4(key, hashlib.md5(PAD + fid).digest())
        for i in range(1, 20): U = rc4(bytes(b ^ i for b in key), U)
        U = U + b'\x00' * 16
        encnum = len(objs) + 1
        objs = objs + [(b'<< /Filter /Standard /V 2 /R 3 /Length 128 /P %d /O <%s> /U <%s> >>' % (P, O.hex().encode(), U.hex().encode()), None)]
        extra = b' /Encrypt %d 0 R' % encnum
    out = b'%PDF-1.6\n%\xe2\xe3\xcf\xd3\n'; offs = []
    for i, (d, s) in enumerate(objs):
        num = i + 1
        offs.append(len(out))
        body = d
        if s is not None:
            if key is not None and not (encrypt and num == len(objs)):
                k = hashlib.md5(key + struct.pack('<i', num)[:3] + b'\x00\x00').digest()[:16]
                s = rc4(k, s)
            body = d.rstrip(b'>').rstrip() + b' /Length %d >>\nstream\n' % len(s) + s + b'\nendstream'
        out += b'%d 0 obj\n' % num + body + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    for o in offs: out += b'%010d 00000 n \n' % (o + (37 if broken_xref else 0))
    out += b'trailer\n<< /Size %d /Root %d 0 R /ID [<%s> <%s>]%s >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, root, fid.hex().encode(), fid.hex().encode(), extra, xref + (11 if broken_xref else 0))
    open(os.path.join(D, fname), 'wb').write(out)

def red(x0, y0, x1, y1, rgb='1 0 0'):
    return f'{rgb} rg {x0} {y0} {x1 - x0} {y1 - y0} re f\n'.encode()

def displayed(box, uu, rot, rect):
    """user-space rect -> displayed mm bbox (top-left origin), box = effective box [x0 y0 x1 y1]"""
    bx0, by0, bx1, by1 = box; s = uu * MM
    Wd, Hd = (bx1 - bx0) * s, (by1 - by0) * s
    pts = [(rect[0], rect[1]), (rect[2], rect[1]), (rect[2], rect[3]), (rect[0], rect[3])]
    out = []
    for ux, uy in pts:
        X, Y = (ux - bx0) * s, (by1 - uy) * s
        r = rot % 360
        if r == 90: X, Y = Hd - Y, X
        elif r == 180: X, Y = Wd - X, Hd - Y
        elif r == 270: X, Y = Y, Wd - X
        out.append((X, Y))
    W, H = (Hd, Wd) if rot % 180 == 90 else (Wd, Hd)
    xs = [p[0] for p in out]; ys = [p[1] for p in out]
    return [W, H], [min(xs), min(ys), max(xs), max(ys)]

exp = {}
def page_pdf(name, page_extra, rect, box, uu=1, rot=0, pages_extra=b'', content_extra=b'', extra_objs=(), encrypt=None, broken=False, note='', report=()):
    content = red(*rect) + content_extra
    objs = [(b'<< /Type /Catalog /Pages 2 0 R >>', None), (b'<< /Type /Pages /Kids [3 0 R] /Count 1' + pages_extra + b' >>', None),
            (b'<< /Type /Page /Parent 2 0 R /Contents 4 0 R /Resources << >>' + page_extra + b' >>', None), (b'<< >>', content)] + list(extra_objs)
    build(objs, name, encrypt, broken)
    size, bb = displayed(box, uu, rot, rect)
    exp[name] = {'size': size, 'red': bb, 'note': note, 'report': list(report)}

page_pdf('p01-userunit-rot270-crop.pdf', b' /MediaBox [0 0 300 200] /CropBox [50 20 250 180] /UserUnit 2.5 /Rotate 270', [60, 30, 100, 50], [50, 20, 250, 180], 2.5, 270)
page_pdf('p02-rot90-origin.pdf', b' /MediaBox [100 200 400 600] /Rotate 90', [110, 210, 150, 230], [100, 200, 400, 600], 1, 90)
page_pdf('p03-inherited.pdf', b'', [20, 20, 60, 40], [10, 10, 350, 350], 1, 90, pages_extra=b' /MediaBox [0 0 360 360] /CropBox [10 10 350 350] /Rotate 90', note='MediaBox/CropBox/Rotate inherited from /Pages')
page_pdf('p04-rot-minus90.pdf', b' /MediaBox [0 0 595.28 841.89] /Rotate -90', [50, 50, 150, 100], [0, 0, 595.28, 841.89], 1, 270)
page_pdf('p05-rc4-empty-user.pdf', b' /MediaBox [0 0 595.28 841.89]', [100, 600, 200, 700], [0, 0, 595.28, 841.89], encrypt=('', 'owner-secret', -3904 & 0xFFFFFFFF if False else -3904), note='RC4-128 R3, empty user password, owner password set, printing allowed')
page_pdf('p06-user-password.pdf', b' /MediaBox [0 0 595.28 841.89]', [100, 600, 200, 700], [0, 0, 595.28, 841.89], encrypt=('user-secret', 'owner-secret', -4), note='needs a user password: must be refused (encrypted)')
annot = (b'<< /Type /Annot /Subtype /Square /Rect [300 300 400 400] /C [0 0 1] /IC [0 0 1] /F 4 /AP << /N 6 0 R >> >>', None)
apstream = (b'<< /Type /XObject /Subtype /Form /BBox [300 300 400 400] >>', b'0 0 1 rg 300 300 100 100 re f\n')
page_pdf('p07-annotation.pdf', b' /MediaBox [0 0 595.28 841.89] /Annots [5 0 R]', [100, 600, 200, 700], [0, 0, 595.28, 841.89], extra_objs=[annot, apstream],
         note='blue square is an annotation appearance (prints in Acrobat/Preview with Print=4 flag)', report=['annotation not printed -> must be reported'])
# optional content: green rect in a layer that is OFF by default
oc_cat = b'<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R] /D << /OFF [5 0 R] /Order [5 0 R] >> >> >>'
content = red(100, 600, 200, 700) + b'/OC /L1 BDC 0 1 0 rg 300 300 100 100 re f EMC\n'
build([(oc_cat, None), (b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>', None),
       (b'<< /Type /Page /Parent 2 0 R /Contents 4 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Properties << /L1 5 0 R >> >> >>', None),
       (b'<< >>', content), (b'<< /Type /OCG /Name (Size 12 - hidden) >>', None)], 'p08-hidden-layer.pdf')
size, bb = displayed([0, 0, 595.28, 841.89], 1, 0, [100, 600, 200, 700])
exp['p08-hidden-layer.pdf'] = {'size': size, 'red': bb, 'note': 'green rect is in an OCG that is OFF by default: viewers do not print it', 'report': ['hidden layer must not print, or be reported'], 'absent': {'green': displayed([0, 0, 595.28, 841.89], 1, 0, [300, 300, 400, 400])[1]}}
page_pdf('p09-broken-xref.pdf', b' /MediaBox [0 0 595.28 841.89]', [100, 600, 200, 700], [0, 0, 595.28, 841.89], broken=True, note='xref offsets wrong by 37 bytes (common damage): viewers repair')
page_pdf('p10-rot90-uu-crop-outside.pdf', b' /MediaBox [0 0 1000 800] /CropBox [-100 100 600 900] /UserUnit 0.5 /Rotate 90', [50, 150, 250, 250], [0, 100, 600, 800], 0.5, 90, note='CropBox partly outside MediaBox -> intersection')
page_pdf('p11-rot180-floats.pdf', b' /MediaBox [0.5 0.25 612.5 792.25] /Rotate 180', [72.5, 72.25, 144.5, 108.25], [0.5, 0.25, 612.5, 792.25], 1, 180)
json.dump(exp, open(os.path.join(D, 'expected.json'), 'w'), indent=1)
print(len(exp), 'pdf fixtures')
