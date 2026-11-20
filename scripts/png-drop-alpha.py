#!/usr/bin/env python3
"""Rewrite 8-bit RGBA PNGs as RGB PNGs (App Store screenshots must not carry an alpha channel).
usage: png-drop-alpha.py <in.png> <out.png>   (standard library only; the alpha channel must be fully opaque)"""
import struct
import sys
import zlib


def chunks(data):
    pos = 8
    while pos < len(data):
        (n,) = struct.unpack(">I", data[pos:pos + 4])
        yield data[pos + 4:pos + 8], data[pos + 8:pos + 8 + n]
        pos += 12 + n


def paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    return a if pa <= pb and pa <= pc else (b if pb <= pc else c)


def main(src, dst):
    data = open(src, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    idat = b""
    for kind, body in chunks(data):
        if kind == b"IHDR":
            w, h, depth, ctype, _, _, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
    assert (depth, ctype, interlace) == (8, 6, 0), f"expected 8-bit RGBA, got depth={depth} type={ctype} interlace={interlace}"
    raw = zlib.decompress(idat)
    stride = w * 4
    prev = bytearray(stride)
    out = bytearray()
    pos = 0
    for _ in range(h):
        f = raw[pos]
        row = bytearray(raw[pos + 1:pos + 1 + stride])
        pos += 1 + stride
        for i in range(stride):
            a = row[i - 4] if i >= 4 else 0
            b = prev[i]
            c = prev[i - 4] if i >= 4 else 0
            if f == 1:
                row[i] = (row[i] + a) & 255
            elif f == 2:
                row[i] = (row[i] + b) & 255
            elif f == 3:
                row[i] = (row[i] + ((a + b) >> 1)) & 255
            elif f == 4:
                row[i] = (row[i] + paeth(a, b, c)) & 255
        prev = row
        assert all(row[3::4][j] == 255 for j in range(0, w, 97)), "alpha is not opaque"
        rgb = bytearray(w * 3)
        rgb[0::3] = row[0::4]
        rgb[1::3] = row[1::4]
        rgb[2::3] = row[2::4]
        out += b"\x00" + rgb

    def chunk(kind, body):
        c = struct.pack(">I", len(body)) + kind + body
        return c + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(out), 6)) + chunk(b"IEND", b"")
    open(dst, "wb").write(png)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
