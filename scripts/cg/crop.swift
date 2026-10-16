// crop.swift pdf page(0-based) x0 y0 x1 y1 (mm, y down) dpi out.png
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
let a = CommandLine.arguments
let doc = CGPDFDocument(URL(fileURLWithPath: a[1]) as CFURL)!, page = doc.page(at: Int(a[2])! + 1)!
let x0 = Double(a[3])!, y0 = Double(a[4])!, x1 = Double(a[5])!, y1 = Double(a[6])!, dpi = Double(a[7])!
let K = 72 / 25.4, s = dpi / 72, hPt = Double(page.getBoxRect(.mediaBox).height)
let w = Int((x1 - x0) * K * s), h = Int((y1 - y0) * K * s)
let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
ctx.scaleBy(x: s, y: s); ctx.translateBy(x: -x0 * K, y: -(hPt - y0 * K) + Double(h) / s); ctx.drawPDFPage(page)
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: a[8]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, ctx.makeImage()!, nil); CGImageDestinationFinalize(dest)
