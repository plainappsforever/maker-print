import CoreGraphics
import ExpoModulesCore
import Foundation
import UIKit

/**
 * Maker Print's local iOS module (V1_PLAN P4, D11, D17, D30, D53).
 * - printPdf: the exact print route. `UIPrintInteractionController` with our own `UIPrintPageRenderer` subclass
 *   (`ExactPageRenderer`): every PDF page is drawn at scale 1.0 with its top-left on the paper's top-left (centred only
 *   when the paper the printer picked differs from the page; the result says so). iOS never gets a `printingItem`, so it
 *   has nothing to "scale to fit". Portrait only (D53): `UIPrintInfo.orientation = .portrait`, and the delegate's
 *   `choosePaper` asks for the portrait page size. Resolves with the printer id, the chosen paper and its printable
 *   rectangle (D17: learned margins).
 * - printDryRun: the same renderer drawing into a PDF context of a given paper (tests and the self-test).
 * - renderPdfPage: CoreGraphics rasteriser for previews (D30): page `pageIndex` (0-based) with /Rotate applied, longest
 *   side `maxPx`, white background, PNG in the caches directory.
 */
public class MakerPrintNativeModule: Module {
  private var job: PrintJob?

  public func definition() -> ModuleDefinition {
    Name("MakerPrintNative")

    AsyncFunction("printPdf") { (path: String, opts: PrintOptions, promise: Promise) in
      guard self.job == nil else {
        promise.reject("E_BUSY", "A print dialog is already open")
        return
      }
      guard UIPrintInteractionController.isPrintingAvailable else {
        promise.reject("E_UNAVAILABLE", "Printing is not available on this device")
        return
      }
      guard let doc = openPdf(path) else {
        promise.reject("E_PDF", "Cannot open the PDF")
        return
      }
      let job = PrintJob(doc: doc, opts: opts)
      self.job = job
      job.present { result in
        self.job = nil
        promise.resolve(result)
      }
    }
    .runOnQueue(.main)

    AsyncFunction("printDryRun") { (path: String, paperWidthPt: Double, paperHeightPt: Double, printable: RectRecord) -> String in
      guard let doc = openPdf(path) else { throw PdfException() }
      let paper = CGRect(x: 0, y: 0, width: paperWidthPt, height: paperHeightPt)
      let printableRect = CGRect(x: printable.x, y: printable.y, width: printable.w, height: printable.h)
      let renderer = ExactPageRenderer(doc: doc)
      renderer.setValue(NSValue(cgRect: paper), forKey: "paperRect")
      renderer.setValue(NSValue(cgRect: printableRect), forKey: "printableRect")
      let out = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("mp-dryrun-\(UUID().uuidString).pdf")
      UIGraphicsBeginPDFContextToFile(out.path, paper, nil)
      for i in 0..<renderer.numberOfPages {
        UIGraphicsBeginPDFPage()
        renderer.drawPage(at: i, in: printableRect)
      }
      UIGraphicsEndPDFContext()
      return out.absoluteString
    }
    .runOnQueue(.main)

    AsyncFunction("renderPdfPage") { (path: String, pageIndex: Int, maxPx: Double) -> [String: Any] in
      guard let doc = openPdf(path) else { throw PdfException() }
      guard pageIndex >= 0, pageIndex < doc.numberOfPages, let page = doc.page(at: pageIndex + 1) else { throw PageException() }
      let box = page.getBoxRect(.cropBox)
      let angle = ((page.rotationAngle % 360) + 360) % 360
      let turned = angle == 90 || angle == 270
      let w = turned ? box.height : box.width
      let h = turned ? box.width : box.height
      let s = max(1, maxPx) / max(w, h)
      let wpx = max(1, Int((w * s).rounded()))
      let hpx = max(1, Int((h * s).rounded()))
      guard let ctx = CGContext(data: nil, width: wpx, height: hpx, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw PageException() }
      ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
      ctx.fill(CGRect(x: 0, y: 0, width: wpx, height: hpx))
      ctx.interpolationQuality = .high
      ctx.scaleBy(x: CGFloat(wpx) / w, y: CGFloat(hpx) / h)
      // /Rotate turns the page clockwise for display (y-up coordinates, box origin moved to 0,0 first)
      switch angle {
      case 90: ctx.concatenate(CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: box.width))
      case 180: ctx.concatenate(CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: box.width, ty: box.height))
      case 270: ctx.concatenate(CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: box.height, ty: 0))
      default: break
      }
      ctx.translateBy(x: -box.minX, y: -box.minY)
      ctx.clip(to: box)
      ctx.drawPDFPage(page)
      guard let image = ctx.makeImage(), let png = UIImage(cgImage: image).pngData() else { throw PageException() }
      let out = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("mp-page-\(UUID().uuidString).png")
      try png.write(to: out)
      return ["uri": out.absoluteString, "widthPx": wpx, "heightPx": hpx]
    }
  }
}

struct PrintOptions: Record {
  @Field var jobName: String = "Maker Print"
  @Field var pageWidthPt: Double = 0
  @Field var pageHeightPt: Double = 0
  @Field var outputType: String = "general"
}

struct RectRecord: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var w: Double = 0
  @Field var h: Double = 0
}

final class PdfException: Exception {
  override var reason: String { "Cannot open the PDF" }
}

final class PageException: Exception {
  override var reason: String { "Cannot render this PDF page" }
}

func openPdf(_ path: String) -> CGPDFDocument? {
  let url = path.hasPrefix("file://") ? URL(string: path) : URL(fileURLWithPath: path)
  guard let url = url, let doc = CGPDFDocument(url as CFURL), !doc.isEncrypted || doc.isUnlocked, doc.numberOfPages > 0 else { return nil }
  return doc
}

/**
 * Draws each PDF page at scale 1.0 (D11). UIKit gives drawPage a y-down context whose origin is the paper's top-left
 * (`paperRect`); the PDF page is y-up, so it is flipped about its own height. When the paper differs from the page the
 * page is centred on it (the result reports `paperMatches: false`; the print screen warns).
 */
final class ExactPageRenderer: UIPrintPageRenderer {
  let doc: CGPDFDocument
  private(set) var drawnPaper: CGRect = .zero
  private(set) var drawnPrintable: CGRect = .zero
  private(set) var pagesDrawn = 0
  /** Set when the user tapped Print (`printInteractionControllerWillStartJob`): draws after that are the real job, not the
   *  dialog's preview — their paper is the one actually printed on (v1.1, REVIEW_V1 finding 5). */
  var jobStarted = false
  private(set) var jobPaper: CGRect = .zero
  private(set) var jobPrintable: CGRect = .zero

  init(doc: CGPDFDocument) {
    self.doc = doc
    super.init()
  }

  override var numberOfPages: Int { doc.numberOfPages }

  override func drawPage(at pageIndex: Int, in printableRect: CGRect) {
    guard let ctx = UIGraphicsGetCurrentContext(), let page = doc.page(at: pageIndex + 1) else { return }
    let paper = paperRect
    drawnPaper = paper
    drawnPrintable = printableRect
    pagesDrawn += 1
    if jobStarted {
      jobPaper = paper
      jobPrintable = printableRect
    }
    let box = page.getBoxRect(.mediaBox)
    let dx = (paper.width - box.width) / 2
    let dy = (paper.height - box.height) / 2
    ctx.saveGState()
    ctx.translateBy(x: paper.minX + dx, y: paper.minY + dy + box.height)
    ctx.scaleBy(x: 1, y: -1)
    ctx.translateBy(x: -box.minX, y: -box.minY)
    ctx.drawPDFPage(page)
    ctx.restoreGState()
  }
}

/** One print dialog: keeps the controller delegate and renderer alive until the dialog closes. */
final class PrintJob: NSObject, UIPrintInteractionControllerDelegate {
  let doc: CGPDFDocument
  let opts: PrintOptions
  let renderer: ExactPageRenderer
  private var chosen: UIPrintPaper?

  init(doc: CGPDFDocument, opts: PrintOptions) {
    self.doc = doc
    self.opts = opts
    self.renderer = ExactPageRenderer(doc: doc)
    super.init()
  }

  private var pageSize: CGSize {
    if opts.pageWidthPt > 0 && opts.pageHeightPt > 0 { return CGSize(width: opts.pageWidthPt, height: opts.pageHeightPt) }
    return doc.page(at: 1)?.getBoxRect(.mediaBox).size ?? CGSize(width: 595.2755905511812, height: 841.8897637795277)
  }

  func present(done: @escaping ([String: Any]) -> Void) {
    let controller = UIPrintInteractionController.shared
    let info = UIPrintInfo.printInfo()
    info.jobName = opts.jobName
    info.outputType = opts.outputType == "photo" ? .photo : .general
    info.orientation = .portrait // D53: our pages are always the portrait paper
    info.duplex = .none
    controller.printInfo = info
    controller.printingItem = nil
    controller.printingItems = nil
    controller.printFormatter = nil
    controller.printPageRenderer = renderer
    controller.showsNumberOfCopies = true
    controller.showsPaperSelectionForLoadedPapers = true
    controller.delegate = self
    controller.present(animated: true) { [self] c, completed, error in
      var out: [String: Any] = ["completed": completed, "pagesDrawn": renderer.pagesDrawn]
      if let id = c.printInfo?.printerID {
        out["printerId"] = id
        out["printerName"] = printerName(fromId: id)
      }
      // the paper the job was really drawn on wins over the paper we suggested in choosePaper (the user may pick another
      // loaded paper in the dialog) and over preview draws (finding 5)
      let fromJob = renderer.jobPaper.width > 0
      let paper = fromJob ? renderer.jobPaper.size : (chosen?.paperSize ?? renderer.drawnPaper.size)
      out["paperSource"] = fromJob ? "job" : (chosen != nil ? "chosen" : "preview")
      if paper.width > 0 {
        out["paperWidthPt"] = paper.width
        out["paperHeightPt"] = paper.height
        out["paperMatches"] = abs(paper.width - pageSize.width) <= 1 && abs(paper.height - pageSize.height) <= 1
      }
      let r = fromJob ? renderer.jobPrintable : (chosen?.printableRect ?? renderer.drawnPrintable)
      if r.width > 0 {
        out["printableRectPt"] = ["x": r.minX, "y": r.minY, "w": r.width, "h": r.height]
      }
      if let error = error { out["error"] = error.localizedDescription }
      controller.delegate = nil
      controller.printPageRenderer = nil
      done(out)
    }
  }

  func printInteractionControllerWillStartJob(_ printInteractionController: UIPrintInteractionController) {
    renderer.jobStarted = true
  }

  func printInteractionController(_ printInteractionController: UIPrintInteractionController, choosePaper paperList: [UIPrintPaper]) -> UIPrintPaper {
    let paper = UIPrintPaper.bestPaper(forPageSize: pageSize, withPapersFrom: paperList)
    chosen = paper
    return paper
  }

  /** "ipp://MakerPrint%20Test._ipp._tcp.local./" → "MakerPrint Test" (best effort; the id itself is returned too). */
  private func printerName(fromId id: String) -> String {
    let host = URL(string: id)?.host ?? id
    let first = host.components(separatedBy: "._").first ?? host
    return first.removingPercentEncoding ?? first
  }
}
