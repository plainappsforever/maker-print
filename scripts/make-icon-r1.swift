// Maker Print icon (redesign R1, sheet 5 of tasks-and-reports/DESIGN_IDENTITIES.md): a white page, slightly turned, with
// vermilion crop marks at two opposite corners and a steel ruler lying diagonally across it. CoreGraphics paths only, no
// font, no SF Symbol, no network. Drawn from the sheet's 64 x 64 sketch (marks and ticks a little heavier so they read at 60 px).
// Usage: swift scripts/make-icon-r1.swift [--out <app folder>]
// Writes assets/images/{icon,icon-dark,icon-tinted,favicon,splash-icon,android-icon-foreground,android-icon-background,android-icon-monochrome}.png
// (icon* are 1024 x 1024 without alpha).
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

var out = FileManager.default.currentDirectoryPath
if CommandLine.arguments.count > 2, CommandLine.arguments[1] == "--out" { out = CommandLine.arguments[2] }
let space = CGColorSpace(name: CGColorSpace.sRGB)!
func rgb(_ h: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(colorSpace: space, components: [CGFloat((h >> 16) & 255) / 255, CGFloat((h >> 8) & 255) / 255, CGFloat(h & 255) / 255, a])!
}

struct Palette { let bg: UInt32?; let page: UInt32; let pageEdge: UInt32; let marks: UInt32; let ruler: UInt32; let tick: UInt32 }
let light = Palette(bg: 0xF7F5EF, page: 0xFFFFFF, pageEdge: 0xDCD7D1, marks: 0xC23E19, ruler: 0x9AA1A8, tick: 0x4A5057)
let dark = Palette(bg: 0x25201B, page: 0xF2EDE6, pageEdge: 0x6A645E, marks: 0xFF8A5F, ruler: 0xA7AEB5, tick: 0x4A5057)
let tinted = Palette(bg: 0x000000, page: 0xD8D8D8, pageEdge: 0x8A8A8A, marks: 0xFFFFFF, ruler: 0x9A9A9A, tick: 0x2A2A2A)

func canvas(_ size: Int, opaque: Bool) -> CGContext {
  let info = opaque ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue
  let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: info)!
  ctx.translateBy(x: 0, y: CGFloat(size))
  ctx.scaleBy(x: 1, y: -1)
  return ctx
}
func save(_ image: CGImage, _ rel: String) {
  let url = URL(fileURLWithPath: out).appendingPathComponent(rel)
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, image, nil)
  guard CGImageDestinationFinalize(dest) else { fatalError("could not write \(url.path)") }
  print("wrote \(url.path)")
}
func resized(_ image: CGImage, to size: Int, opaque: Bool) -> CGImage {
  let c = canvas(size, opaque: opaque)
  c.interpolationQuality = .high
  c.translateBy(x: 0, y: CGFloat(size)); c.scaleBy(x: 1, y: -1)
  c.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
  return c.makeImage()!
}

/// The artwork in the sheet's 64-unit space, drawn into a size x size canvas. `shrink` scales it about the centre (adaptive icon safe zone).
func draw(_ ctx: CGContext, size: Int, palette p: Palette, shrink: CGFloat = 1, mono: Bool = false) {
  let k = CGFloat(size) / 64
  if let bg = p.bg { ctx.setFillColor(rgb(bg)); ctx.fill(CGRect(x: 0, y: 0, width: size, height: size)) }
  ctx.saveGState()
  ctx.translateBy(x: CGFloat(size) / 2, y: CGFloat(size) / 2)
  ctx.scaleBy(x: k * shrink, y: k * shrink)
  ctx.translateBy(x: -32, y: -32)
  func rotated(_ deg: CGFloat, _ body: () -> Void) {
    ctx.saveGState()
    ctx.translateBy(x: 32, y: 32); ctx.rotate(by: deg * .pi / 180); ctx.translateBy(x: -32, y: -32)
    body()
    ctx.restoreGState()
  }
  let black = rgb(0x000000)
  // page
  rotated(-6) {
    let page = CGRect(x: 16, y: 10, width: 32, height: 44)
    if mono {
      ctx.setFillColor(black); ctx.fill(page)
    } else {
      ctx.setFillColor(rgb(p.page)); ctx.fill(page)
      ctx.setStrokeColor(rgb(p.pageEdge)); ctx.setLineWidth(1); ctx.stroke(page)
    }
  }
  // crop marks at two opposite corners (outside the page corners)
  ctx.setLineCap(.butt)
  ctx.setStrokeColor(mono ? black : rgb(p.marks)); ctx.setLineWidth(3)
  for seg in [(6.0, 14.0, 17.0, 14.0), (14.0, 6.0, 14.0, 17.0), (47.0, 54.0, 58.0, 54.0), (50.0, 47.0, 50.0, 58.0)] {
    ctx.move(to: CGPoint(x: seg.0, y: seg.1)); ctx.addLine(to: CGPoint(x: seg.2, y: seg.3)); ctx.strokePath()
  }
  // ruler: 56 x 10 bar turned -28 degrees, ticks along its lower edge in its own frame
  rotated(-28) {
    let bar = CGRect(x: 2, y: 27, width: 60, height: 10)
    if mono {
      // cut a halo into the page so the ruler reads as a separate bar, then fill it
      ctx.saveGState(); ctx.setBlendMode(.clear); ctx.fill(bar.insetBy(dx: -1.8, dy: -1.8)); ctx.restoreGState()
      ctx.setFillColor(black); ctx.fill(bar)
      ctx.saveGState(); ctx.setBlendMode(.clear)
      var x: CGFloat = 6
      var n = 0
      while x < 60 { ctx.fill(CGRect(x: x - 0.5, y: 37 - (n % 2 == 0 ? 5 : 3), width: 1, height: n % 2 == 0 ? 5 : 3)); x += 4.5; n += 1 }
      ctx.restoreGState()
    } else {
      ctx.setFillColor(rgb(p.ruler)); ctx.fill(bar)
      ctx.setStrokeColor(rgb(p.tick)); ctx.setLineWidth(1.1)
      var x: CGFloat = 6
      var n = 0
      while x < 60 {
        let len: CGFloat = n % 2 == 0 ? 5 : 3
        ctx.move(to: CGPoint(x: x, y: 37)); ctx.addLine(to: CGPoint(x: x, y: 37 - len)); ctx.strokePath()
        x += 4.5; n += 1
      }
    }
  }
  ctx.restoreGState()
}
func render(_ size: Int, _ p: Palette, opaque: Bool, shrink: CGFloat = 1, mono: Bool = false) -> CGImage {
  let c = canvas(size, opaque: opaque)
  draw(c, size: size, palette: p, shrink: shrink, mono: mono)
  return c.makeImage()!
}

let lightIcon = render(1024, light, opaque: true)
save(lightIcon, "assets/images/icon.png")
save(render(1024, dark, opaque: true), "assets/images/icon-dark.png")
save(render(1024, tinted, opaque: true), "assets/images/icon-tinted.png")
save(resized(lightIcon, to: 48, opaque: true), "assets/images/favicon.png")
let noBg = Palette(bg: nil, page: light.page, pageEdge: light.pageEdge, marks: light.marks, ruler: light.ruler, tick: light.tick)
save(render(1024, noBg, opaque: false, shrink: 0.9), "assets/images/splash-icon.png")
save(render(1024, noBg, opaque: false, shrink: 0.62), "assets/images/android-icon-foreground.png")
let bgOnly = canvas(1024, opaque: true)
bgOnly.setFillColor(rgb(light.bg!)); bgOnly.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
save(bgOnly.makeImage()!, "assets/images/android-icon-background.png")
save(render(1024, Palette(bg: nil, page: 0, pageEdge: 0, marks: 0, ruler: 0, tick: 0), opaque: false, shrink: 0.62, mono: true), "assets/images/android-icon-monochrome.png")
