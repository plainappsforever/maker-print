// Plain Apps original app icons, drawn from CoreGraphics paths only: no SF Symbol, no font, no third-party artwork, no network.
// Same pipeline as print-cost's scripts/make-icon.swift (D91), with a flat solid background instead of a gradient and the
// glyph chosen by --design. One accent colour per icon on a solid background, readable at 60 px, no text.
// Usage: swift scripts/make-icon-glyph.swift --design <name> [--out <app folder>]
//        swift scripts/make-icon-glyph.swift --design offscan --png <file.png>      (only a 1024 PNG, e.g. for a contact sheet)
// Writes assets/images/{icon,favicon,splash-icon,android-icon-foreground,android-icon-background,android-icon-monochrome}.png
// and assets/expo.icon/{icon.json,Assets/glyph.png}. icon.png is 1024 x 1024 without alpha (App Store rule).
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

var opts: [String: String] = [:]
var argi = 1
let args = CommandLine.arguments
while argi + 1 < args.count, args[argi].hasPrefix("--") { opts[String(args[argi].dropFirst(2))] = args[argi + 1]; argi += 2 }
func fail(_ m: String) -> Never { FileHandle.standardError.write((m + "\n").data(using: .utf8)!); exit(1) }

let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ h: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [CGFloat((h >> 16) & 255) / 255, CGFloat((h >> 8) & 255) / 255, CGFloat(h & 255) / 255, a])!
}
func lum(_ h: UInt32) -> Double {
  func ch(_ v: UInt32) -> Double { let c = Double(v) / 255; return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
  return 0.2126 * ch((h >> 16) & 255) + 0.7152 * ch((h >> 8) & 255) + 0.0722 * ch(h & 255)
}
func contrast(_ a: UInt32, _ b: UInt32) -> Double { let x = lum(a), y = lum(b); return (max(x, y) + 0.05) / (min(x, y) + 0.05) }
func mix(_ a: UInt32, _ b: UInt32, _ t: Double) -> UInt32 {
  func c(_ s: Int) -> UInt32 { let x = Double((a >> s) & 255), y = Double((b >> s) & 255); return UInt32((x + (y - x) * t).rounded()) }
  return (c(16) << 16) | (c(8) << 8) | c(0)
}

/// `ink` is the main glyph colour on the colour layers (white by default; dark on the light backgrounds of batch 3).
struct Design { let name: String; let bg: UInt32; let accent: UInt32; let note: String; var ink: UInt32 = 0xFFFFFF }
let designs: [String: Design] = [
  "intervals": Design(name: "intervals", bg: 0xB43308, accent: 0xFFE082, note: "segmented ring, one segment lit"),
  "offscan": Design(name: "offscan", bg: 0x0D47A1, accent: 0x69F0AE, note: "page with a scan line"),
  "tillcard": Design(name: "tillcard", bg: 0x5E35B1, accent: 0xB2FF59, note: "stacked cards, three-bar mark"),
  "plainweeks": Design(name: "plainweeks", bg: 0x1F6F68, accent: 0xFFE9A8, note: "crescent with a leaf"),
  "mood": Design(name: "mood", bg: 0xAD1457, accent: 0xFFEB3B, note: "one calm face"),
  "cardscan": Design(name: "cardscan", bg: 0x263238, accent: 0x4DD0E1, note: "card inside corner frame"),
  // Batch 2 (2026-11-04): sky blue, forest green, brown, olive, indigo, cyan, near-black, coral.
  "breathe": Design(name: "breathe", bg: 0x0277BD, accent: 0xB3E5FC, note: "soft disc with two concentric rings"),
  "eyerest": Design(name: "eyerest", bg: 0x2E7D32, accent: 0xFFF176, note: "eye outline with a motion arc"),
  "decibel": Design(name: "decibel", bg: 0x5D4037, accent: 0xFFB74D, note: "three rising bars and a sound arc"),
  "shrink": Design(name: "shrink", bg: 0x827717, accent: 0xF4FF81, note: "photo frame with a smaller frame and an arrow"),
  "safeshare": Design(name: "safeshare", bg: 0x303F9F, accent: 0x84FFFF, note: "document with a shield mark"),
  "resume": Design(name: "resume", bg: 0x00838F, accent: 0xFFD54F, note: "page with header block and three lines"),
  "gauge": Design(name: "gauge", bg: 0x14181B, accent: 0xFF9E40, note: "round gauge with a needle"),
  "warranty": Design(name: "warranty", bg: 0xD6455D, accent: 0xFFD180, note: "two-tone shield with a check"),
  // Batch 3 (2026-11-04): red, leaf green, slate, purple, orange, lemon, cream, lavender, royal blue, aqua, navy, evergreen, sky, maroon, near-white.
  "plugbolt": Design(name: "plugbolt", bg: 0xC62828, accent: 0xFFEB3B, note: "plug with a bolt punched through"),
  "invoice": Design(name: "invoice", bg: 0x558B2F, accent: 0xFFCC80, note: "page with a total line and a stamp dot"),
  "jobcam": Design(name: "jobcam", bg: 0x546E7A, accent: 0xFFAB40, note: "camera body with a map pin"),
  "layers": Design(name: "layers", bg: 0x6A1B9A, accent: 0x18FFFF, note: "printed layer stack under a nozzle"),
  "pricetag": Design(name: "pricetag", bg: 0xE65100, accent: 0xFFF59D, note: "tag with a small list"),
  "forkbeat": Design(name: "forkbeat", bg: 0xFFEE58, accent: 0xE53935, note: "tuning fork with vibration arcs", ink: 0x212121),
  "cycle": Design(name: "cycle", bg: 0xFDEBD3, accent: 0x00897B, note: "ring with one marked segment", ink: 0x4A2C2A),
  "flashcards": Design(name: "flashcards", bg: 0xD1C4E9, accent: 0xFF5722, note: "two offset cards", ink: 0x2A1B6B),
  "idphoto": Design(name: "idphoto", bg: 0x2962FF, accent: 0xFFD740, note: "head and shoulders in a frame"),
  "pill": Design(name: "pill", bg: 0xB2DFDB, accent: 0xFF7043, note: "two-tone capsule with a clock badge", ink: 0x00423A),
  "vault": Design(name: "vault", bg: 0x1B2A49, accent: 0xFFC857, note: "photo frame with a lock"),
  "prayer": Design(name: "prayer", bg: 0x0B3D2E, accent: 0xF2D16B, note: "crescent over a horizon line"),
  "steps": Design(name: "steps", bg: 0x4FC3F7, accent: 0xFF6D00, note: "two footprints", ink: 0x0B2545),
  "dumbbell": Design(name: "dumbbell", bg: 0x6E1423, accent: 0xFFB74D, note: "tilted dumbbell"),
  "pulse": Design(name: "pulse", bg: 0xF1F5F9, accent: 0xEF4444, note: "heart outline with a pulse line", ink: 0x1F2937),
]
guard let dname = opts["design"], let design = designs[dname] else { fail("--design must be one of \(designs.keys.sorted().joined(separator: ", "))") }
let white: UInt32 = 0xFFFFFF
print(String(format: "design %@: bg #%06X, ink on bg %.2f:1, accent on bg %.2f:1", dname, design.bg, contrast(design.ink, design.bg), contrast(design.accent, design.bg)))

/// Square canvas with a top-left origin. `opaque` = no alpha channel.
func canvas(_ size: Int, opaque: Bool = false) -> CGContext {
  let info = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info)!
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: 1, y: -1)
  return ctx
}
func save(_ image: CGImage, _ url: URL) {
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { fail("could not write \(url.path)") }
  print("wrote \(url.path)")
}
func resized(_ image: CGImage, to size: Int, opaque: Bool = false) -> CGImage {
  let out = canvas(size, opaque: opaque)
  out.interpolationQuality = .high
  out.translateBy(x: 0, y: CGFloat(size))
  out.scaleBy(x: 1, y: -1)
  out.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
  return out.makeImage()!
}

// ---------- path helpers (design space 1000 x 1000, y down) ----------
func roundedPolygon(_ pts: [CGPoint], _ r: CGFloat) -> CGPath {
  let p = CGMutablePath()
  let n = pts.count
  p.move(to: CGPoint(x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2))
  for k in 1...n { p.addArc(tangent1End: pts[k % n], tangent2End: pts[(k + 1) % n], radius: r) }
  p.closeSubpath()
  return p
}
func rrect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> CGPath {
  CGPath(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerWidth: r, cornerHeight: r, transform: nil)
}
/// Annular sector from angle a0 to a1 (degrees, 0 = up, clockwise), sampled as a polygon (no arc-direction ambiguity).
func sector(_ c: CGPoint, _ r0: CGFloat, _ r1: CGFloat, _ a0: Double, _ a1: Double) -> CGPath {
  let p = CGMutablePath()
  func pt(_ r: CGFloat, _ a: Double) -> CGPoint { CGPoint(x: c.x + r * CGFloat(sin(a * .pi / 180)), y: c.y - r * CGFloat(cos(a * .pi / 180))) }
  let steps = max(2, Int((a1 - a0) / 1.5))
  p.move(to: pt(r1, a0))
  for s in 1...steps { p.addLine(to: pt(r1, a0 + (a1 - a0) * Double(s) / Double(steps))) }
  for s in 0...steps { p.addLine(to: pt(r0, a1 - (a1 - a0) * Double(s) / Double(steps))) }
  p.closeSubpath()
  return p
}
/// Fills a path with rounded corners by also stroking it with a round join (path was built `k` smaller on each side).
func fillRounded(_ ctx: CGContext, _ path: CGPath, _ k: CGFloat, _ colour: CGColor) {
  ctx.saveGState()
  ctx.addPath(path)
  ctx.setFillColor(colour)
  ctx.setStrokeColor(colour)
  ctx.setLineWidth(k * 2)
  ctx.setLineJoin(.round)
  ctx.drawPath(using: .fillStroke)
  ctx.restoreGState()
}
func clear(_ ctx: CGContext, _ path: CGPath) {
  ctx.saveGState()
  ctx.setBlendMode(.clear)
  ctx.addPath(path)
  ctx.fillPath()
  ctx.restoreGState()
}
/// Punches a gap of `halo` around `path` (a stroked outline), so overlapping shapes read as separate layers.
func clearHalo(_ ctx: CGContext, _ path: CGPath, _ halo: CGFloat) {
  ctx.saveGState()
  ctx.setBlendMode(.clear)
  ctx.setLineWidth(halo * 2)
  ctx.setLineJoin(.round)
  ctx.addPath(path)
  ctx.setStrokeColor(rgb(0))
  ctx.strokePath()
  ctx.addPath(path)
  ctx.fillPath()
  ctx.restoreGState()
}

enum Look { case colour, mono }

func drawGlyph(_ ctx: CGContext, box: CGRect, _ look: Look) {
  ctx.saveGState()
  ctx.translateBy(x: box.minX, y: box.minY)
  ctx.scaleBy(x: box.width / 1000, y: box.height / 1000)
  let main = look == .colour ? rgb(design.ink) : rgb(white)
  let acc = look == .colour ? rgb(design.accent) : rgb(white)
  switch design.name {
  case "intervals":
    // Eight segments of a ring (a round of work); the one at the top right, the current interval, is thicker and lit.
    let c = CGPoint(x: 500, y: 500)
    let k: CGFloat = 14
    for i in 0..<8 {
      let a0 = Double(i) * 45 + 3.5, a1 = Double(i + 1) * 45 - 3.5
      let lit = i == 0
      let path = lit ? sector(c, 205 + k, 395 - k, a0 + 1, a1 - 1) : sector(c, 245 + k, 365 - k, a0 + 2, a1 - 2)
      fillRounded(ctx, path, k, lit ? acc : main)
    }
  case "offscan":
    // A page with a cut corner and a fold, and a scan line crossing it (it sticks out on both sides).
    let page = roundedPolygon([CGPoint(x: 270, y: 130), CGPoint(x: 560, y: 130), CGPoint(x: 730, y: 300), CGPoint(x: 730, y: 870), CGPoint(x: 270, y: 870)], 34)
    ctx.addPath(page)
    ctx.setFillColor(main)
    ctx.fillPath()
    if look == .colour {
      let fold = roundedPolygon([CGPoint(x: 560, y: 130), CGPoint(x: 730, y: 300), CGPoint(x: 560, y: 300)], 10)
      ctx.addPath(fold)
      ctx.setFillColor(rgb(mix(white, design.bg, 0.55)))
      ctx.fillPath()
    }
    let bar = rrect(150, 500, 700, 56, 28)
    clearHalo(ctx, bar, 24)
    ctx.addPath(bar)
    ctx.setFillColor(acc)
    ctx.fillPath()
  case "tillcard":
    // Two stacked cards; the front one carries a three-bar mark (punched through).
    ctx.saveGState()
    ctx.translateBy(x: 560, y: 405)
    ctx.rotate(by: -0.17)
    ctx.addPath(rrect(-320, -200, 640, 400, 56))
    ctx.setFillColor(acc)
    ctx.fillPath()
    ctx.restoreGState()
    let front = rrect(140, 425, 640, 410, 56)
    clearHalo(ctx, front, 26)
    ctx.addPath(front)
    ctx.setFillColor(main)
    ctx.fillPath()
    for (x, w) in [(300.0, 52.0), (404.0, 112.0), (568.0, 52.0)] { clear(ctx, rrect(CGFloat(x), 515, CGFloat(w), 230, 14)) }
  case "plainweeks":
    // A crescent, with a leaf growing in its opening. Nothing that says pregnancy.
    let outer = CGPath(ellipseIn: CGRect(x: 160, y: 200, width: 680, height: 680), transform: nil)
    let inner = CGPath(ellipseIn: CGRect(x: 290, y: 130, width: 600, height: 600), transform: nil)
    ctx.addPath(outer)
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, inner)
    let leaf = CGMutablePath()
    let base = CGPoint(x: 520, y: 640), tip = CGPoint(x: 740, y: 290)
    leaf.move(to: base)
    leaf.addQuadCurve(to: tip, control: CGPoint(x: 460, y: 380))
    leaf.addQuadCurve(to: base, control: CGPoint(x: 780, y: 580))
    leaf.closeSubpath()
    ctx.addPath(leaf)
    ctx.setFillColor(acc)
    ctx.fillPath()
  case "mood":
    // One calm face (the app's home asks "How are you?"): a lit disc, two eyes and a smile punched through.
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 140, y: 140, width: 720, height: 720), transform: nil))
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 322, y: 360, width: 92, height: 124), transform: nil))
    clear(ctx, CGPath(ellipseIn: CGRect(x: 586, y: 360, width: 92, height: 124), transform: nil))
    let smile = CGMutablePath()
    for s in 0...40 {
      let a = (30.0 + 120.0 * Double(s) / 40) * .pi / 180
      let p = CGPoint(x: 500 + 215 * CGFloat(cos(a)), y: 470 + 215 * CGFloat(sin(a)))
      if s == 0 { smile.move(to: p) } else { smile.addLine(to: p) }
    }
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(smile)
    ctx.setLineWidth(62)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
  case "cardscan":
    // A card inside four scanner corners.
    let card = rrect(240, 350, 520, 330, 44)
    ctx.addPath(card)
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, rrect(296, 410, 86, 66, 14))
    clear(ctx, rrect(296, 560, 280, 36, 18))
    let l: CGFloat = 170, t: CGFloat = 54
    let x0: CGFloat = 130, x1: CGFloat = 870, y0: CGFloat = 215, y1: CGFloat = 815
    let corner = CGMutablePath()
    corner.move(to: CGPoint(x: x0, y: y0 + l)); corner.addLine(to: CGPoint(x: x0, y: y0)); corner.addLine(to: CGPoint(x: x0 + l, y: y0))
    corner.move(to: CGPoint(x: x1 - l, y: y0)); corner.addLine(to: CGPoint(x: x1, y: y0)); corner.addLine(to: CGPoint(x: x1, y: y0 + l))
    corner.move(to: CGPoint(x: x1, y: y1 - l)); corner.addLine(to: CGPoint(x: x1, y: y1)); corner.addLine(to: CGPoint(x: x1 - l, y: y1))
    corner.move(to: CGPoint(x: x0 + l, y: y1)); corner.addLine(to: CGPoint(x: x0, y: y1)); corner.addLine(to: CGPoint(x: x0, y: y1 - l))
    ctx.addPath(corner)
    ctx.setStrokeColor(acc)
    ctx.setLineWidth(t)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
  case "breathe":
    // A soft lit disc with two concentric rings around it (breathing in and out).
    let c = CGPoint(x: 500, y: 500)
    ctx.addPath(CGPath(ellipseIn: CGRect(x: c.x - 150, y: c.y - 150, width: 300, height: 300), transform: nil))
    ctx.setFillColor(acc)
    ctx.fillPath()
    ctx.setStrokeColor(main)
    ctx.setLineWidth(38)
    ctx.addPath(CGPath(ellipseIn: CGRect(x: c.x - 262, y: c.y - 262, width: 524, height: 524), transform: nil))
    ctx.strokePath()
    ctx.addPath(CGPath(ellipseIn: CGRect(x: c.x - 372, y: c.y - 372, width: 744, height: 744), transform: nil))
    ctx.strokePath()
  case "eyerest":
    // An almond eye outline with an iris, and a small arc with an arrowhead above it (the eye moves).
    let eye = CGMutablePath()
    eye.move(to: CGPoint(x: 110, y: 560))
    eye.addQuadCurve(to: CGPoint(x: 890, y: 560), control: CGPoint(x: 500, y: 190))
    eye.addQuadCurve(to: CGPoint(x: 110, y: 560), control: CGPoint(x: 500, y: 930))
    eye.closeSubpath()
    ctx.addPath(eye)
    ctx.setStrokeColor(main)
    ctx.setLineWidth(54)
    ctx.setLineJoin(.round)
    ctx.strokePath()
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 500 - 118, y: 560 - 118, width: 236, height: 236), transform: nil))
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 500 - 46, y: 560 - 46, width: 92, height: 92), transform: nil))
    let c0 = CGPoint(x: 500, y: 560), rr: CGFloat = 430
    func ap(_ a: Double) -> CGPoint { CGPoint(x: c0.x + rr * CGFloat(sin(a * .pi / 180)), y: c0.y - rr * CGFloat(cos(a * .pi / 180))) }
    let arc = CGMutablePath()
    arc.move(to: ap(-42))
    for s in 1...30 { arc.addLine(to: ap(-42 + 66 * Double(s) / 30)) }
    ctx.addPath(arc)
    ctx.setStrokeColor(acc)
    ctx.setLineWidth(46)
    ctx.setLineCap(.round)
    ctx.strokePath()
    let endA = 24.0 * Double.pi / 180
    let tip = CGPoint(x: ap(24).x + 70 * CGFloat(cos(endA)), y: ap(24).y + 70 * CGFloat(sin(endA)))
    let nrm = CGPoint(x: -CGFloat(sin(endA)), y: CGFloat(cos(endA)))
    let head = roundedPolygon([tip, CGPoint(x: ap(24).x + 55 * nrm.x, y: ap(24).y + 55 * nrm.y), CGPoint(x: ap(24).x - 55 * nrm.x, y: ap(24).y - 55 * nrm.y)], 8)
    ctx.addPath(head)
    ctx.setFillColor(acc)
    ctx.fillPath()
  case "decibel":
    // Three rising bars, and a small sound arc beside the tallest.
    for (x, h) in [(150.0, 230.0), (310.0, 380.0), (470.0, 530.0)] {
      ctx.addPath(rrect(CGFloat(x), 810 - CGFloat(h), 130, CGFloat(h), 34))
      ctx.setFillColor(main)
      ctx.fillPath()
    }
    let wave = CGMutablePath()
    let wc = CGPoint(x: 660, y: 330)
    for s in 0...30 {
      let a = (35.0 + 110.0 * Double(s) / 30) * .pi / 180
      let p = CGPoint(x: wc.x + 150 * CGFloat(sin(a)), y: wc.y - 150 * CGFloat(cos(a)))
      if s == 0 { wave.move(to: p) } else { wave.addLine(to: p) }
    }
    ctx.addPath(wave)
    ctx.setStrokeColor(acc)
    ctx.setLineWidth(52)
    ctx.setLineCap(.round)
    ctx.strokePath()
  case "shrink":
    // A photo frame (outline) with a smaller solid frame in its lower left, and an arrow pointing down and left into it.
    ctx.addPath(rrect(150, 130, 700, 700, 100))
    ctx.setStrokeColor(main)
    ctx.setLineWidth(58)
    ctx.strokePath()
    ctx.addPath(rrect(250, 460, 270, 270, 52))
    ctx.setFillColor(acc)
    ctx.fillPath()
    let shaft = CGMutablePath()
    shaft.move(to: CGPoint(x: 700, y: 270)); shaft.addLine(to: CGPoint(x: 600, y: 370))
    ctx.addPath(shaft)
    ctx.setStrokeColor(main)
    ctx.setLineWidth(52)
    ctx.setLineCap(.round)
    ctx.strokePath()
    ctx.addPath(roundedPolygon([CGPoint(x: 530, y: 440), CGPoint(x: 662, y: 396), CGPoint(x: 574, y: 308)], 10))
    ctx.setFillColor(main)
    ctx.fillPath()
  case "safeshare":
    // A page (two text lines punched in) with a shield on its lower right corner, a check punched through the shield.
    let page = roundedPolygon([CGPoint(x: 210, y: 120), CGPoint(x: 520, y: 120), CGPoint(x: 700, y: 300), CGPoint(x: 700, y: 880), CGPoint(x: 210, y: 880)], 34)
    ctx.addPath(page)
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, rrect(290, 330, 200, 42, 21))
    clear(ctx, rrect(290, 440, 280, 42, 21))
    let shield = CGMutablePath()
    shield.move(to: CGPoint(x: 560, y: 520))
    shield.addLine(to: CGPoint(x: 700, y: 465))
    shield.addLine(to: CGPoint(x: 840, y: 520))
    shield.addLine(to: CGPoint(x: 840, y: 690))
    shield.addQuadCurve(to: CGPoint(x: 700, y: 890), control: CGPoint(x: 840, y: 820))
    shield.addQuadCurve(to: CGPoint(x: 560, y: 690), control: CGPoint(x: 560, y: 820))
    shield.closeSubpath()
    clearHalo(ctx, shield, 26)
    ctx.addPath(shield)
    ctx.setFillColor(acc)
    ctx.fillPath()
    let tick = CGMutablePath()
    tick.move(to: CGPoint(x: 636, y: 690)); tick.addLine(to: CGPoint(x: 685, y: 738)); tick.addLine(to: CGPoint(x: 770, y: 630))
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(tick)
    ctx.setLineWidth(40)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
  case "resume":
    // A page: an accent header block, then three text lines punched through.
    ctx.addPath(rrect(250, 120, 500, 760, 54))
    ctx.setFillColor(main)
    ctx.fillPath()
    ctx.addPath(rrect(320, 200, 360, 130, 28))
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, rrect(320, 420, 360, 46, 23))
    clear(ctx, rrect(320, 540, 360, 46, 23))
    clear(ctx, rrect(320, 660, 220, 46, 23))
  case "gauge":
    // A three-quarter dial with a needle and a hub.
    let gc = CGPoint(x: 500, y: 530)
    let dial = CGMutablePath()
    for s in 0...60 {
      let a = (-135.0 + 270.0 * Double(s) / 60) * .pi / 180
      let p = CGPoint(x: gc.x + 345 * CGFloat(sin(a)), y: gc.y - 345 * CGFloat(cos(a)))
      if s == 0 { dial.move(to: p) } else { dial.addLine(to: p) }
    }
    ctx.addPath(dial)
    ctx.setStrokeColor(main)
    ctx.setLineWidth(76)
    ctx.setLineCap(.round)
    ctx.strokePath()
    let na = 38.0 * Double.pi / 180
    let dir = CGPoint(x: CGFloat(sin(na)), y: -CGFloat(cos(na))), side = CGPoint(x: CGFloat(cos(na)), y: CGFloat(sin(na)))
    let needle = roundedPolygon([
      CGPoint(x: gc.x + dir.x * 290, y: gc.y + dir.y * 290),
      CGPoint(x: gc.x + side.x * 40, y: gc.y + side.y * 40),
      CGPoint(x: gc.x - side.x * 40, y: gc.y - side.y * 40),
    ], 14)
    ctx.addPath(needle)
    ctx.setFillColor(acc)
    ctx.fillPath()
    ctx.addPath(CGPath(ellipseIn: CGRect(x: gc.x - 48, y: gc.y - 48, width: 96, height: 96), transform: nil))
    ctx.setFillColor(main)
    ctx.fillPath()
  case "warranty":
    // A shield in two tones (left white, right lit) with a small check punched through it.
    let top = CGPoint(x: 500, y: 130)
    let left = CGMutablePath()
    left.move(to: top)
    left.addLine(to: CGPoint(x: 205, y: 235))
    left.addLine(to: CGPoint(x: 205, y: 520))
    left.addQuadCurve(to: CGPoint(x: 500, y: 880), control: CGPoint(x: 205, y: 760))
    left.closeSubpath()
    let right = CGMutablePath()
    right.move(to: top)
    right.addLine(to: CGPoint(x: 795, y: 235))
    right.addLine(to: CGPoint(x: 795, y: 520))
    right.addQuadCurve(to: CGPoint(x: 500, y: 880), control: CGPoint(x: 795, y: 760))
    right.closeSubpath()
    fillRounded(ctx, left, 0, main)
    fillRounded(ctx, right, 0, acc)
    let tick = CGMutablePath()
    tick.move(to: CGPoint(x: 395, y: 500)); tick.addLine(to: CGPoint(x: 475, y: 580)); tick.addLine(to: CGPoint(x: 625, y: 400))
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(tick)
    ctx.setLineWidth(62)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
  case "plugbolt":
    // A plug: two accent prongs, a white body with a bolt punched through it, and a cord.
    for x in [372.0, 562.0] {
      ctx.addPath(rrect(CGFloat(x), 110, 66, 270, 26))
      ctx.setFillColor(acc)
      ctx.fillPath()
    }
    ctx.addPath(rrect(240, 340, 520, 380, 120))
    ctx.setFillColor(main)
    ctx.fillPath()
    ctx.addPath(rrect(450, 690, 100, 210, 40))
    ctx.fillPath()
    clear(ctx, roundedPolygon([CGPoint(x: 548, y: 392), CGPoint(x: 400, y: 565), CGPoint(x: 490, y: 565), CGPoint(x: 450, y: 690), CGPoint(x: 605, y: 500), CGPoint(x: 515, y: 500)], 10))
  case "invoice":
    // A page with a heading, two lines, a total rule and a bar; an accent stamp dot (ring punched in it) on its lower right.
    ctx.addPath(rrect(220, 110, 500, 790, 56))
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, rrect(300, 210, 190, 46, 23))
    clear(ctx, rrect(300, 330, 340, 40, 20))
    clear(ctx, rrect(300, 430, 340, 40, 20))
    clear(ctx, rrect(300, 560, 340, 14, 7))
    clear(ctx, rrect(300, 630, 170, 60, 20))
    let stamp = CGPath(ellipseIn: CGRect(x: 560, y: 600, width: 270, height: 270), transform: nil)
    clearHalo(ctx, stamp, 28)
    ctx.addPath(stamp)
    ctx.setFillColor(acc)
    ctx.fillPath()
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 618, y: 658, width: 154, height: 154), transform: nil))
    ctx.setLineWidth(22)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
  case "jobcam":
    // A camera body with a lens (ring + lit centre) and a map pin on its upper right corner.
    ctx.addPath(rrect(330, 215, 320, 150, 44))
    ctx.setFillColor(main)
    ctx.fillPath()
    ctx.addPath(rrect(110, 300, 780, 540, 96))
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 500 - 175, y: 580 - 175, width: 350, height: 350), transform: nil))
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 500 - 120, y: 580 - 120, width: 240, height: 240), transform: nil))
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 500 - 62, y: 580 - 62, width: 124, height: 124), transform: nil))
    let pin = CGMutablePath()
    pin.addEllipse(in: CGRect(x: 770 - 95, y: 270 - 95, width: 190, height: 190))
    pin.addPath(roundedPolygon([CGPoint(x: 690, y: 320), CGPoint(x: 850, y: 320), CGPoint(x: 770, y: 460)], 14))
    clearHalo(ctx, pin, 28)
    ctx.addPath(pin)
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 770 - 36, y: 270 - 36, width: 72, height: 72), transform: nil))
  case "layers":
    // Three finished layers (narrowing upward), an accent layer being printed, and the nozzle above it.
    ctx.setFillColor(main)
    for (x, y, w) in [(170.0, 720.0, 660.0), (225.0, 590.0, 550.0), (280.0, 460.0, 440.0)] {
      ctx.addPath(rrect(CGFloat(x), CGFloat(y), CGFloat(w), 100, 38))
      ctx.fillPath()
    }
    ctx.addPath(rrect(335, 330, 330, 100, 38))
    ctx.setFillColor(acc)
    ctx.fillPath()
    ctx.addPath(roundedPolygon([CGPoint(x: 400, y: 100), CGPoint(x: 600, y: 100), CGPoint(x: 600, y: 190), CGPoint(x: 540, y: 270), CGPoint(x: 460, y: 270), CGPoint(x: 400, y: 190)], 22))
    ctx.setFillColor(main)
    ctx.fillPath()
  case "pricetag":
    // A tag pointing left (accent), a hole punched in its tip and a short list punched into it.
    ctx.addPath(roundedPolygon([CGPoint(x: 100, y: 500), CGPoint(x: 340, y: 220), CGPoint(x: 880, y: 220), CGPoint(x: 880, y: 780), CGPoint(x: 340, y: 780)], 46))
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 262, y: 458, width: 84, height: 84), transform: nil))
    clear(ctx, rrect(470, 330, 320, 52, 26))
    clear(ctx, rrect(470, 470, 320, 52, 26))
    clear(ctx, rrect(470, 610, 200, 52, 26))
  case "forkbeat":
    // A tuning fork (U, stem, round handle) with a vibration arc on each side.
    let fork = CGMutablePath()
    fork.move(to: CGPoint(x: 385, y: 130))
    fork.addLine(to: CGPoint(x: 385, y: 420))
    fork.addCurve(to: CGPoint(x: 500, y: 560), control1: CGPoint(x: 385, y: 500), control2: CGPoint(x: 430, y: 560))
    fork.addCurve(to: CGPoint(x: 615, y: 420), control1: CGPoint(x: 570, y: 560), control2: CGPoint(x: 615, y: 500))
    fork.addLine(to: CGPoint(x: 615, y: 130))
    fork.move(to: CGPoint(x: 500, y: 560))
    fork.addLine(to: CGPoint(x: 500, y: 790))
    ctx.addPath(fork)
    ctx.setStrokeColor(main)
    ctx.setLineWidth(74)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 500 - 62, y: 850 - 62, width: 124, height: 124), transform: nil))
    ctx.setFillColor(main)
    ctx.fillPath()
    let wc = CGPoint(x: 500, y: 300)
    for sgn in [-1.0, 1.0] {
      let arc = CGMutablePath()
      for s in 0...20 {
        let a = sgn * (52.0 + 36.0 * Double(s) / 20) * .pi / 180
        let p = CGPoint(x: wc.x + 330 * CGFloat(sin(a)), y: wc.y - 330 * CGFloat(cos(a)) + 120)
        if s == 0 { arc.move(to: p) } else { arc.addLine(to: p) }
      }
      ctx.addPath(arc)
      ctx.setStrokeColor(acc)
      ctx.setLineWidth(50)
      ctx.strokePath()
    }
  case "cycle":
    // A ring (a cycle) with one marked segment lit, a dot in the middle.
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 500 - 300, y: 500 - 300, width: 600, height: 600), transform: nil))
    ctx.setStrokeColor(main)
    ctx.setLineWidth(110)
    ctx.strokePath()
    let seg = sector(CGPoint(x: 500, y: 500), 215 + 16, 385 - 16, 20, 105)
    clearHalo(ctx, seg, 36)
    fillRounded(ctx, seg, 16, acc)
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 500 - 52, y: 500 - 52, width: 104, height: 104), transform: nil))
    ctx.setFillColor(main)
    ctx.fillPath()
  case "flashcards":
    // Two upright cards: a lit one behind, tilted, and the front one with two lines punched in.
    ctx.saveGState()
    ctx.translateBy(x: 560, y: 480)
    ctx.rotate(by: 0.2)
    ctx.addPath(rrect(-210, -300, 420, 600, 50))
    ctx.setFillColor(acc)
    ctx.fillPath()
    ctx.restoreGState()
    let front = rrect(170, 200, 440, 620, 50)
    clearHalo(ctx, front, 28)
    ctx.addPath(front)
    ctx.setFillColor(main)
    ctx.fillPath()
    clear(ctx, rrect(250, 330, 280, 52, 26))
    clear(ctx, rrect(250, 450, 200, 52, 26))
  case "idphoto":
    // A passport frame with a head and shoulders silhouette.
    ctx.addPath(rrect(170, 120, 660, 760, 80))
    ctx.setStrokeColor(main)
    ctx.setLineWidth(52)
    ctx.strokePath()
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 500 - 118, y: 400 - 118, width: 236, height: 236), transform: nil))
    ctx.setFillColor(acc)
    ctx.fillPath()
    let shoulders = CGMutablePath()
    shoulders.move(to: CGPoint(x: 300, y: 790))
    shoulders.addCurve(to: CGPoint(x: 500, y: 590), control1: CGPoint(x: 300, y: 650), control2: CGPoint(x: 380, y: 590))
    shoulders.addCurve(to: CGPoint(x: 700, y: 790), control1: CGPoint(x: 620, y: 590), control2: CGPoint(x: 700, y: 650))
    shoulders.closeSubpath()
    ctx.addPath(shoulders)
    ctx.fillPath()
  case "pill":
    // A capsule in two tones, tilted, with a small clock badge on its lower right.
    ctx.saveGState()
    ctx.translateBy(x: 450, y: 440)
    ctx.rotate(by: -0.785)
    let cap = rrect(-290, -135, 580, 270, 135)
    ctx.addPath(cap)
    ctx.setFillColor(main)
    ctx.fillPath()
    ctx.addPath(cap)
    ctx.clip()
    ctx.setFillColor(acc)
    ctx.fill(CGRect(x: 0, y: -135, width: 290, height: 270))
    ctx.restoreGState()
    let face = CGPath(ellipseIn: CGRect(x: 580, y: 580, width: 330, height: 330), transform: nil)
    clearHalo(ctx, face, 28)
    ctx.addPath(face)
    ctx.setFillColor(main)
    ctx.fillPath()
    let hands = CGMutablePath()
    hands.move(to: CGPoint(x: 745, y: 665)); hands.addLine(to: CGPoint(x: 745, y: 745)); hands.addLine(to: CGPoint(x: 805, y: 775))
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(hands)
    ctx.setLineWidth(34)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
  case "vault":
    // A photo frame (outline) with a hill and a sun, a lock over its lower right corner.
    ctx.addPath(rrect(150, 150, 700, 560, 80))
    ctx.setStrokeColor(main)
    ctx.setLineWidth(52)
    ctx.strokePath()
    ctx.addPath(roundedPolygon([CGPoint(x: 215, y: 665), CGPoint(x: 385, y: 420), CGPoint(x: 500, y: 570), CGPoint(x: 565, y: 490), CGPoint(x: 700, y: 665)], 20))
    ctx.setFillColor(main)
    ctx.fillPath()
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 260, y: 240, width: 90, height: 90), transform: nil))
    ctx.fillPath()
    let shackle = CGMutablePath()
    shackle.move(to: CGPoint(x: 630, y: 610))
    shackle.addLine(to: CGPoint(x: 630, y: 560))
    shackle.addCurve(to: CGPoint(x: 770, y: 560), control1: CGPoint(x: 630, y: 450), control2: CGPoint(x: 770, y: 450))
    shackle.addLine(to: CGPoint(x: 770, y: 610))
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(shackle)
    ctx.setLineWidth(100)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
    let lock = rrect(560, 580, 280, 250, 46)
    clearHalo(ctx, lock, 28)
    ctx.addPath(shackle)
    ctx.setStrokeColor(acc)
    ctx.setLineWidth(44)
    ctx.setLineCap(.butt)
    ctx.strokePath()
    ctx.addPath(lock)
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, rrect(682, 665, 36, 90, 18))
  case "prayer":
    // A crescent opening to the upper right, over a horizon line and its reflection. Nothing figurative.
    ctx.addPath(CGPath(ellipseIn: CGRect(x: 230, y: 160, width: 540, height: 540), transform: nil))
    ctx.setFillColor(acc)
    ctx.fillPath()
    clear(ctx, CGPath(ellipseIn: CGRect(x: 360, y: 90, width: 480, height: 480), transform: nil))
    ctx.addPath(rrect(130, 770, 740, 46, 23))
    ctx.setFillColor(main)
    ctx.fillPath()
    ctx.addPath(rrect(290, 870, 420, 46, 23))
    ctx.fillPath()
  case "steps":
    // Two footprints (sole + heel), the right one ahead and lit.
    func foot(_ cx: CGFloat, _ cy: CGFloat, _ rot: CGFloat, _ colour: CGColor) {
      ctx.saveGState()
      ctx.translateBy(x: cx, y: cy)
      ctx.rotate(by: rot)
      ctx.setFillColor(colour)
      ctx.addPath(CGPath(ellipseIn: CGRect(x: -100, y: -240, width: 200, height: 300), transform: nil))
      ctx.fillPath()
      ctx.addPath(CGPath(ellipseIn: CGRect(x: -74, y: 85, width: 148, height: 150), transform: nil))
      ctx.fillPath()
      ctx.restoreGState()
    }
    foot(360, 640, -0.14, main)
    foot(640, 370, 0.14, acc)
  case "dumbbell":
    // A dumbbell tilted up to the right: handle, inner plates, accent outer plates.
    ctx.saveGState()
    ctx.translateBy(x: 500, y: 500)
    ctx.rotate(by: -0.6)
    ctx.setFillColor(main)
    ctx.addPath(rrect(-230, -42, 460, 84, 20))
    ctx.fillPath()
    ctx.addPath(rrect(-330, -190, 100, 380, 36))
    ctx.fillPath()
    ctx.addPath(rrect(230, -190, 100, 380, 36))
    ctx.fillPath()
    ctx.setFillColor(acc)
    ctx.addPath(rrect(-440, -120, 85, 240, 32))
    ctx.fillPath()
    ctx.addPath(rrect(355, -120, 85, 240, 32))
    ctx.fillPath()
    ctx.restoreGState()
  case "pulse":
    // A heart outline with a pulse line crossing it (the line has a gap cut around it).
    let heart = CGMutablePath()
    heart.move(to: CGPoint(x: 500, y: 850))
    heart.addCurve(to: CGPoint(x: 150, y: 460), control1: CGPoint(x: 380, y: 760), control2: CGPoint(x: 150, y: 640))
    heart.addCurve(to: CGPoint(x: 500, y: 320), control1: CGPoint(x: 150, y: 320), control2: CGPoint(x: 400, y: 260))
    heart.addCurve(to: CGPoint(x: 850, y: 460), control1: CGPoint(x: 600, y: 260), control2: CGPoint(x: 850, y: 320))
    heart.addCurve(to: CGPoint(x: 500, y: 850), control1: CGPoint(x: 850, y: 640), control2: CGPoint(x: 620, y: 760))
    heart.closeSubpath()
    ctx.addPath(heart)
    ctx.setStrokeColor(main)
    ctx.setLineWidth(58)
    ctx.setLineJoin(.round)
    ctx.strokePath()
    let line = CGMutablePath()
    line.move(to: CGPoint(x: 90, y: 540))
    for p in [(330.0, 540.0), (410.0, 400.0), (520.0, 700.0), (600.0, 500.0), (650.0, 540.0), (910.0, 540.0)] { line.addLine(to: CGPoint(x: p.0, y: p.1)) }
    ctx.saveGState()
    ctx.setBlendMode(.clear)
    ctx.addPath(line)
    ctx.setLineWidth(46 + 56)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.setStrokeColor(rgb(0))
    ctx.strokePath()
    ctx.restoreGState()
    ctx.addPath(line)
    ctx.setStrokeColor(acc)
    ctx.setLineWidth(46)
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    ctx.strokePath()
  default: fail("unknown design")
  }
  ctx.restoreGState()
}

func glyphLayer(_ size: Int, fraction: CGFloat, _ look: Look) -> CGContext {
  let ctx = canvas(size)
  let s = CGFloat(size), box = s * fraction
  drawGlyph(ctx, box: CGRect(x: (s - box) / 2, y: (s - box) / 2, width: box, height: box), look)
  return ctx
}
func solid(_ size: Int) -> CGImage {
  let c = canvas(size, opaque: true)
  c.setFillColor(rgb(design.bg))
  c.fill(CGRect(x: 0, y: 0, width: size, height: size))
  return c.makeImage()!
}
let storeIcon: CGImage = {
  let ctx = canvas(1024, opaque: true)
  ctx.setFillColor(rgb(design.bg))
  ctx.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
  let layer = glyphLayer(1024, fraction: 0.9, .colour).makeImage()!
  ctx.translateBy(x: 0, y: 1024)
  ctx.scaleBy(x: 1, y: -1)
  ctx.draw(layer, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
  return ctx.makeImage()!
}()

if let png = opts["png"] {
  save(storeIcon, URL(fileURLWithPath: png))
  exit(0)
}

let root = URL(fileURLWithPath: opts["out"] ?? FileManager.default.currentDirectoryPath)
let images = root.appendingPathComponent("assets/images")
let bundle = root.appendingPathComponent("assets/expo.icon")
let iconAssets = bundle.appendingPathComponent("Assets")
for dir in [images, iconAssets] { try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true) }

save(storeIcon, images.appendingPathComponent("icon.png"))
save(resized(storeIcon, to: 48, opaque: true), images.appendingPathComponent("favicon.png"))
// Android adaptive layers: 108 dp canvas, 66 % safe zone; the drawing covers about 80 % of its box, so a 0.78 box keeps it inside.
save(glyphLayer(1024, fraction: 0.74, .colour).makeImage()!, images.appendingPathComponent("android-icon-foreground.png"))
save(solid(1024), images.appendingPathComponent("android-icon-background.png"))
save(glyphLayer(1024, fraction: 0.74, .mono).makeImage()!, images.appendingPathComponent("android-icon-monochrome.png"))
// Splash: the glyph alone on transparent; the splash background colour in app.config.ts is the icon colour.
save(glyphLayer(1024, fraction: 0.9, .colour).makeImage()!, images.appendingPathComponent("splash-icon.png"))
// iOS 26 Icon Composer bundle (app.config.ts ios.icon): the transparent glyph layer over a solid fill.
save(glyphLayer(1024, fraction: 0.9, .colour).makeImage()!, iconAssets.appendingPathComponent("glyph.png"))
let r = String(format: "%.5f", Double((design.bg >> 16) & 255) / 255)
let g = String(format: "%.5f", Double((design.bg >> 8) & 255) / 255)
let b = String(format: "%.5f", Double(design.bg & 255) / 255)
let json = """
{
  "fill" : {
    "solid" : "extended-srgb:\(r),\(g),\(b),1.00000"
  },
  "groups" : [
    {
      "layers" : [
        {
          "image-name" : "glyph.png",
          "name" : "glyph"
        }
      ],
      "shadow" : {
        "kind" : "neutral",
        "opacity" : 0.5
      },
      "translucency" : {
        "enabled" : true,
        "value" : 0.5
      }
    }
  ],
  "supported-platforms" : {
    "circles" : [
      "watchOS"
    ],
    "squares" : "shared"
  }
}

"""
try json.write(to: bundle.appendingPathComponent("icon.json"), atomically: true, encoding: .utf8)
print("wrote assets/expo.icon/icon.json")
