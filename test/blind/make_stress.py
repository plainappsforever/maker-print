#!/usr/bin/env python3
"""Recreates the reviewer's three ~45 MB stress files, which are not committed (P3.5 fix round). The originals were not
kept, so these are equivalents built from REVIEW_ENGINE.md's description: h01 = 45 MB of small rects (~526 000),
h02 = one 45 MB path, h10 = a ~44 MB PDF with 190 pages. Usage: python3 make_stress.py <out-dir>  (default: ./stress)"""
import os, sys, zlib, random
D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'stress')
os.makedirs(D, exist_ok=True)
TARGET = 45_000_000
head = '<svg xmlns="http://www.w3.org/2000/svg" width="500mm" height="500mm" viewBox="0 0 500 500">'
# h01: many rects
parts, size, i = [head], len(head), 0
while size < TARGET - 10:
    r = f'<rect x="{(i % 700) * 0.7:.2f}" y="{(i // 700) * 0.7 % 500:.2f}" width="0.5" height="0.5" fill="#ff0000"/>\n'
    parts.append(r); size += len(r); i += 1
parts.append('</svg>')
open(os.path.join(D, 'h01-many-rects-45mb.svg'), 'w').write(''.join(parts))
print('h01 rects', i)
# h02: one path
p, size, i = [head + '<path fill="none" stroke="#f00" stroke-width="0.1" d="M0 0'], 0, 0
while size < TARGET - 100:
    s = f'L{(i * 7) % 500} {(i * 13) % 500}'
    p.append(s); size += len(s); i += 1
p.append('"/></svg>')
open(os.path.join(D, 'h02-one-path-45mb.svg'), 'w').write(''.join(p))
print('h02 segments', i)
# h10: 190 pages, each with an incompressible ~230 KB image so the file is ~44 MB
rnd = random.Random(10)
objs = []
def add(b):
    objs.append(b); return len(objs)
pages = []
pages_id = 190 * 3 + 1
for n in range(190):
    w = h = 160
    data = bytes(rnd.getrandbits(8) for _ in range(w * h * 9))  # 3 × 160² RGB
    img = add(b'<< /Type /XObject /Subtype /Image /Width 480 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length %d >>\nstream\n' % len(data) + data + b'\nendstream')
    content = b'q 420 0 0 140 0 0 cm /Im0 Do Q 1 0 0 rg 10 10 30 20 re f'
    c = add(b'<< /Length %d >>\nstream\n' % len(content) + content + b'\nendstream')
    pages.append(add(b'<< /Type /Page /Parent %d 0 R /MediaBox [0 0 1190.55 1683.78] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>' % (pages_id, img, c)))
kids = b' '.join(b'%d 0 R' % k for k in pages)
pid = add(b'<< /Type /Pages /Kids [' + kids + b'] /Count 190 >>')
assert pid == pages_id, (pid, pages_id)
cat = add(b'<< /Type /Catalog /Pages %d 0 R >>' % pid)
out = bytearray(b'%PDF-1.7\n')
offs = []
for i, o in enumerate(objs, 1):
    offs.append(len(out)); out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
x = len(out)
out += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1) + b''.join(b'%010d 00000 n \n' % o for o in offs)
out += b'trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, cat, x)
open(os.path.join(D, 'h10-190pages-big.pdf'), 'wb').write(out)
print('h10 bytes', len(out))
