// Independent CoreGraphics measurer for the P3.5 review (not derived from scripts/referee/measure.swift).
// usage: rmeasure jobs.json out.json   — jobs: [{pdf, page (0-based), dpi, windows:[{colour, rect:[x0,y0,x1,y1] mm y-down}], strays:[colours]}]
// For each window: coverage-weighted extents of the colour (straight-edge estimator), in page mm (y down).
import Foundation
import CoreGraphics

struct Win: Codable { let colour: String; let rect: [Double] }
struct Job: Codable { let pdf: String; let page: Int; let dpi: Double; let windows: [Win]; let strays: [String]? }
struct WinOut: Codable { let colour: String; let found: Bool; let bbox: [Double]; let area: Double }
struct JobOut: Codable { let pdf: String; let page: Int; let pageSizePt: [Double]; let mediaBox: [Double]; let windows: [WinOut]; let stray: [String: Int]; let pages: Int }

let K = 72.0 / 25.4
func cov(_ c: String, _ r: Double, _ g: Double, _ b: Double) -> Double {
  switch c {
  case "red": return r >= 200 ? max(0, (r - max(g, b)) / 255) : 0
  case "blue": return b >= 200 ? max(0, (b - max(r, g)) / 255) : 0
  case "green": return g >= 200 ? max(0, (g - max(r, b)) / 255) : 0
  case "magenta": return (r >= 200 && b >= 200) ? max(0, (min(r, b) - g) / 255) : 0
  case "black": return (max(r, g, b) - min(r, g, b) <= 14) ? max(0, 1 - max(r, g, b) / 255) : 0
  case "any": return max(0, 1 - min(r, g, b) / 255)
  default: return 0
  }
}
func render(_ page: CGPDFPage, _ hPt: Double, x0: Double, y0: Double, x1: Double, y1: Double, dpi: Double) -> (Int, Int, [UInt8]) {
  let s = dpi / 72.0
  let w = max(1, Int(((x1 - x0) * K * s).rounded(.up)))
  let h = max(1, Int(((y1 - y0) * K * s).rounded(.up)))
  var buf = [UInt8](repeating: 255, count: w * h * 4)
  let cs = CGColorSpaceCreateDeviceRGB()
  buf.withUnsafeMutableBytes { p in
    let ctx = CGContext(data: p.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: s, y: s)
    // window top-left (x0, y0 mm) must land at the bitmap's top-left; CG bitmap origin is bottom-left
    ctx.translateBy(x: -x0 * K, y: -(hPt - y0 * K) + Double(h) / s)
    ctx.drawPDFPage(page)
  }
  return (w, h, buf)
}
let args = CommandLine.arguments
let jobs = try! JSONDecoder().decode([Job].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
var outs: [JobOut] = []
for j in jobs {
  guard let doc = CGPDFDocument(URL(fileURLWithPath: j.pdf) as CFURL), let page = doc.page(at: j.page + 1) else {
    outs.append(JobOut(pdf: j.pdf, page: j.page, pageSizePt: [], mediaBox: [], windows: [], stray: [:], pages: 0)); continue }
  let mb = page.getBoxRect(.mediaBox)
  let hPt = Double(mb.height)
  var wo: [WinOut] = []
  for win in j.windows {
    let (w, h, buf) = render(page, hPt, x0: win.rect[0], y0: win.rect[1], x1: win.rect[2], y1: win.rect[3], dpi: j.dpi)
    var colP = [Double](repeating: 0, count: w), rowP = [Double](repeating: 0, count: h)
    var area = 0.0
    for y in 0..<h { for x in 0..<w {
      let i = (y * w + x) * 4
      let c = cov(win.colour, Double(buf[i]), Double(buf[i + 1]), Double(buf[i + 2]))
      if c > 0.02 { area += c; colP[x] = max(colP[x], c); rowP[y] = max(rowP[y], c) }
    } }
    func extent(_ p: [Double]) -> (Double, Double)? {
      guard let first = p.firstIndex(where: { $0 > 0.02 }), let last = p.lastIndex(where: { $0 > 0.02 }) else { return nil }
      let fullA = p.firstIndex(where: { $0 >= 0.97 }) ?? first
      let fullB = p.lastIndex(where: { $0 >= 0.97 }) ?? last
      var a = Double(fullA), b = Double(fullB + 1)
      if fullA > first { for k in first..<fullA { a -= p[k] } }
      if fullB < last { for k in (fullB + 1)...last { b += p[k] } }
      return (a, b)
    }
    let px = 25.4 / j.dpi
    if let ex = extent(colP), let ey = extent(rowP) {
      // bitmap memory row 0 = top of the window (verified with a hand-written PDF)
      let rows = ey
      wo.append(WinOut(colour: win.colour, found: true, bbox: [win.rect[0] + ex.0 * px, win.rect[1] + rows.0 * px, win.rect[0] + ex.1 * px, win.rect[1] + rows.1 * px], area: area * px * px))
    } else { wo.append(WinOut(colour: win.colour, found: false, bbox: [], area: 0)) }
  }
  var stray: [String: Int] = [:]
  if let cols = j.strays {
    let wmm = Double(mb.width) / K, hmm = hPt / K
    let dpi = 150.0
    let (w, h, buf) = render(page, hPt, x0: 0, y0: 0, x1: wmm, y1: hmm, dpi: dpi)
    let pxmm = 25.4 / dpi
    for c in cols {
      var n = 0
      for y in 0..<h { for x in 0..<w {
        let i = (y * w + x) * 4
        if cov(c, Double(buf[i]), Double(buf[i + 1]), Double(buf[i + 2])) > 0.5 {
          let xm = (Double(x) + 0.5) * pxmm, ym = (Double(y) + 0.5) * pxmm
          let inside = j.windows.contains { $0.colour == c && xm >= $0.rect[0] - 0.4 && xm <= $0.rect[2] + 0.4 && ym >= $0.rect[1] - 0.4 && ym <= $0.rect[3] + 0.4 }
          if !inside { n += 1 }
        }
      } }
      stray[c] = n
    }
  }
  outs.append(JobOut(pdf: j.pdf, page: j.page, pageSizePt: [Double(mb.width), hPt], mediaBox: [Double(mb.minX), Double(mb.minY), Double(mb.maxX), Double(mb.maxY)], windows: wo, stray: stray, pages: doc.numberOfPages))
}
try! JSONEncoder().encode(outs).write(to: URL(fileURLWithPath: args[2]))
print("measured \(outs.count) jobs")
