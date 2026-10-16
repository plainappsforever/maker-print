// Truth check for source PDFs with Apple's PDF engine: encryption state, boxes, rotation, red bbox as displayed.
import Foundation
import CoreGraphics
for path in CommandLine.arguments.dropFirst() {
  guard let doc = CGPDFDocument(URL(fileURLWithPath: path) as CFURL) else { print("\(path): CG cannot open"); continue }
  var line = "\((path as NSString).lastPathComponent): encrypted=\(doc.isEncrypted) unlocked=\(doc.isUnlocked)"
  if doc.isEncrypted && !doc.isUnlocked { _ = doc.unlockWithPassword(""); line += " afterEmpty=\(doc.isUnlocked) allowsPrinting=\(doc.allowsPrinting)" }
  guard doc.isUnlocked, let page = doc.page(at: 1) else { print(line + " pages=\(doc.numberOfPages)"); continue }
  let crop = page.getBoxRect(.cropBox); let rot = page.rotationAngle
  let dw = rot % 180 == 0 ? crop.width : crop.height, dh = rot % 180 == 0 ? crop.height : crop.width
  let s = 4.0  // px per pt
  let w = Int(dw * s), h = Int(dh * s)
  var buf = [UInt8](repeating: 255, count: w * h * 4)
  buf.withUnsafeMutableBytes { p in
    let ctx = CGContext(data: p.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.scaleBy(x: s, y: s)
    ctx.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: dw, height: dh), rotate: 0, preserveAspectRatio: true))
    ctx.drawPDFPage(page)
  }
  var minX = w, minY = h, maxX = -1, maxY = -1, green = 0, blue = 0
  for y in 0..<h { for x in 0..<w { let i = (y * w + x) * 4
    let r = Int(buf[i]), g = Int(buf[i+1]), b = Int(buf[i+2])
    if r > 200 && g < 60 && b < 60 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) }
    if g > 200 && r < 60 && b < 60 { green += 1 }
    if b > 200 && r < 60 && g < 60 { blue += 1 } } }
  let k = 25.4 / 72 / s
  line += String(format: " crop=[%.2f %.2f %.2f %.2f] rot=%d displayedPt=%.2fx%.2f red(mm,no UserUnit)=[%.3f %.3f %.3f %.3f] greenPx=%d bluePx=%d", crop.minX, crop.minY, crop.maxX, crop.maxY, rot, dw, dh, Double(minX) * k, Double(minY) * k, Double(maxX + 1) * k, Double(maxY + 1) * k, green, blue)
  print(line)
}
