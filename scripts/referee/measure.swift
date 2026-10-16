// Referee measurer (D25, SPEC §14 A2/A3): renders output PDFs with Apple CoreGraphics — a PDF engine independent of
// pdf-lib — and measures coloured features. It knows nothing about the plan: it gets windows in page millimetres
// (origin top-left, y down) and reports what ink it finds there.
//
// Build: swiftc -O scripts/referee/measure.swift -o artifacts/referee/measure   (run.mjs does this)
// Usage: measure pdf <request.json>   → JSON on stdout
//        measure imageinfo <file>...  → ImageIO's view of image files (pixel size, orientation, dpi)
//
// Colour classes on white paper: red/green/blue/magenta (pure ink, coverage = chroma), ink (anything not white,
// coverage = 1 − mean). Window statistics: area (mm²), coverage-weighted centroid, sub-pixel extents (first/last
// column/row with coverage, edge placed by that pixel's coverage), and "ticks": clusters of columns (axis x) or rows
// (axis y) whose ink height exceeds a threshold, with their baseline-corrected weighted centres. Ink weights are
// coverage × darkness: a 40 % grey line weighs 0.4, so thresholds are in "weighted mm".
import CoreGraphics
import Foundation
import ImageIO

let MM_PER_PT = 25.4 / 72.0

struct Window: Codable { let id: String; let rect: [Double]; let colour: String; let mode: String?; let axis: String?; let minTickMm: Double? }
struct PageReq: Codable { let index: Int; let margins: [Double]?; let windows: [Window]; let allowed: [String: [[Double]]]? }
struct Request: Codable { let pdf: String; let dpi: Double; let coarseDpi: Double; let pages: [PageReq] }

struct WinOut: Codable {
  let id: String; var area: Double; var cx: Double?; var cy: Double?
  var l: Double?; var t: Double?; var r: Double?; var b: Double?; var ticks: [Double]?
}
struct PageOut: Codable {
  let index: Int; let mediaBoxPt: [Double]; var marginInk: [Double]?; var marginPixels: Int?
  var coarse: [String: [Double]]; var strays: [String: Int]; var windows: [WinOut]
}
struct DocOut: Codable { let pageCount: Int; let printScaling: String?; var pages: [PageOut] }

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(2)
}

/// Renders the page region [x, y, w, h] mm (y down) at dpi into RGBA bytes; returns (pixels, width, height, pxMm).
func render(_ page: CGPDFPage, _ rect: [Double], dpi: Double) -> ([UInt8], Int, Int, Double) {
  let media = page.getBoxRect(.mediaBox)
  let s = dpi / 72.0
  let pxMm = 25.4 / dpi
  let w = max(1, Int((rect[2] / pxMm).rounded(.up)))
  let h = max(1, Int((rect[3] / pxMm).rounded(.up)))
  var data = [UInt8](repeating: 255, count: w * h * 4)
  let cs = CGColorSpaceCreateDeviceRGB()
  data.withUnsafeMutableBytes { buf in
    guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("no context") }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.interpolationQuality = .high
    // window top-left (mm, y down) → PDF points; bitmap row 0 is the window's top
    let x0 = media.minX + rect[0] / MM_PER_PT
    let yTop = media.maxY - rect[1] / MM_PER_PT
    ctx.translateBy(x: 0, y: CGFloat(h))
    ctx.scaleBy(x: CGFloat(s), y: CGFloat(s))
    ctx.translateBy(x: CGFloat(-x0), y: CGFloat(-yTop))
    ctx.drawPDFPage(page)
  }
  return (data, w, h, pxMm)
}

/// Coverage of one pixel for a colour class (0…1).
@inline(__always) func coverage(_ p: UnsafePointer<UInt8>, _ cls: Int) -> Double {
  let r = Double(p[0]) / 255, g = Double(p[1]) / 255, b = Double(p[2]) / 255
  if cls == 4 { return max(0, 1 - (r + g + b) / 3) }
  let mx = max(r, g, b), mn = min(r, g, b), chroma = mx - mn
  if chroma < 0.06 { return 0 }
  let tol = 0.25 * chroma + 0.02
  switch cls {
  case 0: return (r == mx && abs(g - b) <= tol) ? chroma : 0  // red
  case 1: return (g == mx && abs(r - b) <= tol) ? chroma : 0  // green
  case 2: return (b == mx && abs(r - g) <= tol) ? chroma : 0  // blue
  default: return (g == mn && abs(r - b) <= tol) ? chroma : 0 // magenta
  }
}
let CLASSES = ["red": 0, "green": 1, "blue": 2, "magenta": 3, "ink": 4]

func measure(_ data: [UInt8], _ w: Int, _ h: Int, _ pxMm: Double, _ rect: [Double], _ win: Window) -> WinOut {
  guard let cls = CLASSES[win.colour] else { fail("unknown colour \(win.colour)") }
  var colMax = [Double](repeating: 0, count: w), rowMax = [Double](repeating: 0, count: h)
  var colSum = [Double](repeating: 0, count: w), rowSum = [Double](repeating: 0, count: h)
  var sum = 0.0, sx = 0.0, sy = 0.0
  data.withUnsafeBufferPointer { buf in
    for y in 0..<h {
      for x in 0..<w {
        let a = coverage(buf.baseAddress! + (y * w + x) * 4, cls)
        if a <= 0 { continue }
        sum += a; sx += a * (Double(x) + 0.5); sy += a * (Double(y) + 0.5)
        colMax[x] = max(colMax[x], a); rowMax[y] = max(rowMax[y], a)
        colSum[x] += a; rowSum[y] += a
      }
    }
  }
  var out = WinOut(id: win.id, area: sum * pxMm * pxMm, cx: nil, cy: nil, l: nil, t: nil, r: nil, b: nil, ticks: nil)
  if sum > 0 {
    out.cx = rect[0] + sx / sum * pxMm
    out.cy = rect[1] + sy / sum * pxMm
    let th = 0.05
    if let c0 = colMax.firstIndex(where: { $0 > th }), let c1 = colMax.lastIndex(where: { $0 > th }),
       let r0 = rowMax.firstIndex(where: { $0 > th }), let r1 = rowMax.lastIndex(where: { $0 > th }) {
      out.l = rect[0] + (Double(c0) + 1 - min(1, colMax[c0])) * pxMm
      out.r = rect[0] + (Double(c1) + min(1, colMax[c1])) * pxMm
      out.t = rect[1] + (Double(r0) + 1 - min(1, rowMax[r0])) * pxMm
      out.b = rect[1] + (Double(r1) + min(1, rowMax[r1])) * pxMm
    }
  }
  if win.mode == "ticks" {
    // profile across the axis: ink height (mm) per column (axis x) or per row (axis y)
    let alongX = (win.axis ?? "x") == "x"
    let prof = (alongX ? colSum : rowSum).map { $0 * pxMm }
    let minTick = win.minTickMm ?? 3
    var ticks: [Double] = []
    // core = run of columns ≥ half the threshold around a column ≥ the threshold; the local baseline (ink running
    // along the axis, e.g. a bar's outline) is the lower of the profile 2 columns outside the core on each side and
    // is subtracted; one partial column on each side is included.
    var i = 0
    while i < prof.count {
      if prof[i] >= minTick {
        var a = i, b = i
        while a > 0 && prof[a - 1] >= 0.5 * minTick { a -= 1 }
        while b + 1 < prof.count && prof[b + 1] >= 0.5 * minTick { b += 1 }
        let base = min(a >= 2 ? prof[a - 2] : 0, b + 2 < prof.count ? prof[b + 2] : 0)
        var s = 0.0, m = 0.0
        for k in max(0, a - 1)...min(prof.count - 1, b + 1) {
          let wgt = max(0, prof[k] - base)
          s += wgt; m += wgt * (Double(k) + 0.5)
        }
        if s > 0 { ticks.append((alongX ? rect[0] : rect[1]) + m / s * pxMm) }
        i = b + 2
      } else { i += 1 }
    }
    out.ticks = ticks
  }
  return out
}

func pdfMode(_ reqPath: String) {
  guard let reqData = FileManager.default.contents(atPath: reqPath) else { fail("no request \(reqPath)") }
  let req = try! JSONDecoder().decode(Request.self, from: reqData)
  guard let doc = CGPDFDocument(URL(fileURLWithPath: req.pdf) as CFURL) else { fail("cannot open \(req.pdf)") }
  var printScaling: String? = nil
  if let catalog = doc.catalog {
    var vp: CGPDFDictionaryRef? = nil
    if CGPDFDictionaryGetDictionary(catalog, "ViewerPreferences", &vp), let vp = vp {
      var name: UnsafePointer<Int8>? = nil
      if CGPDFDictionaryGetName(vp, "PrintScaling", &name), let name = name { printScaling = String(cString: name) }
    }
  }
  var out = DocOut(pageCount: doc.numberOfPages, printScaling: printScaling, pages: [])
  for pr in req.pages {
    guard let page = doc.page(at: pr.index + 1) else { fail("no page \(pr.index)") }
    let mb = page.getBoxRect(.mediaBox)
    let wMm = Double(mb.width) * MM_PER_PT, hMm = Double(mb.height) * MM_PER_PT
    var po = PageOut(index: pr.index, mediaBoxPt: [Double(mb.minX), Double(mb.minY), Double(mb.maxX), Double(mb.maxY)], marginInk: nil, marginPixels: nil, coarse: [:], strays: [:], windows: [])
    // whole page, coarse: colour bounding boxes and the margin strips
    let (data, w, h, pxMm) = render(page, [0, 0, wMm, hMm], dpi: req.coarseDpi)
    var boxes: [Int: [Int]] = [:]
    var stripMax = [0.0, 0.0, 0.0, 0.0]
    var stripCount = 0
    var strays: [Int: Int] = [:]
    let allowed: [Int: [[Double]]] = Dictionary(uniqueKeysWithValues: (pr.allowed ?? [:]).compactMap { k, v in CLASSES[k].map { ($0, v) } })
    let slack = 0.35
    let m = pr.margins
    data.withUnsafeBufferPointer { buf in
      for y in 0..<h {
        for x in 0..<w {
          let p = buf.baseAddress! + (y * w + x) * 4
          if p[0] == 255 && p[1] == 255 && p[2] == 255 { continue }
          for (_, c) in CLASSES where c < 4 {
            if coverage(p, c) > 0.25 {
              let cxm = (Double(x) + 0.5) * pxMm, cym = (Double(y) + 0.5) * pxMm
              let ok = (allowed[c] ?? []).contains { r in cxm >= r[0] - slack && cxm <= r[0] + r[2] + slack && cym >= r[1] - slack && cym <= r[1] + r[3] + slack }
              if !ok { strays[c, default: 0] += 1 }
              var bb = boxes[c] ?? [x, y, x, y]
              bb[0] = min(bb[0], x); bb[1] = min(bb[1], y); bb[2] = max(bb[2], x); bb[3] = max(bb[3], y)
              boxes[c] = bb
            }
          }
          if let m = m {
            // a pixel counts as "in the margin" only if it lies entirely inside a strip (1 px tolerance at the edge)
            let x0 = Double(x) * pxMm, x1 = x0 + pxMm, y0 = Double(y) * pxMm, y1 = y0 + pxMm
            let ink = coverage(p, 4)
            var s = -1
            if x1 <= m[0] - pxMm { s = 0 } else if y1 <= m[1] - pxMm { s = 1 } else if x0 >= wMm - m[2] + pxMm { s = 2 } else if y0 >= hMm - m[3] + pxMm { s = 3 }
            if s >= 0 && ink > 0.02 { stripMax[s] = max(stripMax[s], ink); stripCount += 1 }
          }
        }
      }
    }
    if m != nil { po.marginInk = stripMax; po.marginPixels = stripCount }
    for (name, c) in CLASSES where c < 4 { if let n = strays[c] { po.strays[name] = n } }
    for (name, c) in CLASSES where c < 4 {
      if let bb = boxes[c] { po.coarse[name] = [Double(bb[0]) * pxMm, Double(bb[1]) * pxMm, Double(bb[2] + 1) * pxMm, Double(bb[3] + 1) * pxMm] }
    }
    for win in pr.windows {
      let (d, ww, hh, px) = render(page, win.rect, dpi: req.dpi)
      po.windows.append(measure(d, ww, hh, px, win.rect, win))
    }
    out.pages.append(po)
  }
  let enc = JSONEncoder()
  enc.outputFormatting = [.sortedKeys]
  FileHandle.standardOutput.write(try! enc.encode(out))
}

func imageInfoMode(_ files: [String]) {
  var rows: [[String: String]] = []
  for f in files {
    var row = ["file": f]
    if let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: f) as CFURL, nil),
       let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any] {
      for k in ["PixelWidth", "PixelHeight", "Orientation", "DPIWidth", "DPIHeight"] { if let v = props[k] { row[k] = "\(v)" } }
    } else { row["error"] = "unreadable" }
    rows.append(row)
  }
  FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: rows, options: [.sortedKeys]))
}

let args = CommandLine.arguments
if args.count >= 3 && args[1] == "pdf" { pdfMode(args[2]) }
else if args.count >= 2 && args[1] == "imageinfo" { imageInfoMode(Array(args.dropFirst(2))) }
else { fail("usage: measure pdf <request.json> | measure imageinfo <files…>") }
