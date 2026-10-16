package expo.modules.makerprintnative

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintJob
import android.print.PrintManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

class PrintOptions : Record {
  @Field var jobName: String = "Maker Print"
  @Field var pageWidthPt: Double = 0.0
  @Field var pageHeightPt: Double = 0.0
  @Field var outputType: String = "general"
}

/**
 * Maker Print's local Android module (V1_PLAN P4, D12, D17, D30, D53).
 * - printPdf: the exact print route. `PrintManager.print` with our own adapter: `CONTENT_TYPE_DOCUMENT` (BIPS fills the
 *   page for photos), the real page count, the PDF copied byte for byte in `onWrite`, and the print attributes asking for
 *   the PORTRAIT media of the page size (never `asLandscape()`, D53). `onLayout` records the media size and minimum
 *   margins the user's printer reports (D17). Resolves when the job leaves the dialog (job state polled every 400 ms):
 *   queued/started/blocked/completed → completed; cancelled/failed → not completed.
 * - renderPdfPage: `PdfRenderer` → PNG in the cache directory (D30), white background, longest side maxPx.
 * printDryRun is iOS only (the adapter's written file is the PDF itself).
 */
class MakerPrintNativeModule : Module() {
  private val context: Context get() = appContext.reactContext ?: throw CodedException("E_NO_CONTEXT", "No context", null)
  private var busy = false

  override fun definition() = ModuleDefinition {
    Name("MakerPrintNative")

    AsyncFunction("printPdf") { path: String, opts: PrintOptions, promise: Promise ->
      if (busy) throw CodedException("E_BUSY", "A print dialog is already open", null)
      val activity = appContext.currentActivity ?: throw CodedException("E_NO_ACTIVITY", "No activity", null)
      val pm = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
        ?: throw CodedException("E_UNAVAILABLE", "Printing is not available on this device", null)
      val file = fileOf(path)
      val pageCount = try {
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd -> PdfRenderer(fd).use { it.pageCount } }
      } catch (e: Exception) {
        throw CodedException("E_PDF", "Cannot open the PDF: ${e.message}", e)
      }
      val adapter = ExactAdapter(file, opts.jobName, pageCount)
      val attrs = PrintAttributes.Builder()
        .setMediaSize(portraitMedia(opts.pageWidthPt, opts.pageHeightPt))
        .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
        .build()
      busy = true
      // a throwing pm.print must not leave `busy` set: every later print would fail with E_BUSY (REVIEW_V1 finding 22)
      val job = try {
        pm.print(opts.jobName, adapter, attrs)
      } catch (e: Exception) {
        busy = false
        throw CodedException("E_PRINT", "The print dialog could not open: ${e.message}", e)
      }
      poll(job, adapter, opts, promise, System.currentTimeMillis())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("renderPdfPage") { path: String, pageIndex: Int, maxPx: Double ->
      val file = fileOf(path)
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
        PdfRenderer(fd).use { renderer ->
          if (pageIndex < 0 || pageIndex >= renderer.pageCount) throw CodedException("E_PAGE", "No page $pageIndex", null)
          renderer.openPage(pageIndex).use { page ->
            // PdfRenderer reports the page size in points with /Rotate applied
            val w = page.width.toDouble()
            val h = page.height.toDouble()
            val s = max(1.0, maxPx) / max(w, h)
            val wpx = max(1, (w * s).roundToInt())
            val hpx = max(1, (h * s).roundToInt())
            val bitmap = Bitmap.createBitmap(wpx, hpx, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(Color.WHITE)
            val m = Matrix().apply { setScale((wpx / w).toFloat(), (hpx / h).toFloat()) }
            page.render(bitmap, null, m, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            val out = File(context.cacheDir, "mp-page-${UUID.randomUUID()}.png")
            FileOutputStream(out).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
            mapOf("uri" to Uri.fromFile(out).toString(), "widthPx" to wpx, "heightPx" to hpx)
          }
        }
      }
    }
  }

  private fun fileOf(path: String): File {
    val f = if (path.startsWith("file://")) File(Uri.parse(path).path ?: path) else File(path)
    if (!f.exists()) throw CodedException("E_PDF", "File not found", null)
    return f
  }

  private fun poll(job: PrintJob, adapter: ExactAdapter, opts: PrintOptions, promise: Promise, started: Long) {
    val handler = Handler(Looper.getMainLooper())
    handler.postDelayed({
      val state = when {
        job.isCancelled -> "cancelled"
        job.isFailed -> "failed"
        job.isCompleted -> "completed"
        job.isStarted -> "started"
        job.isQueued -> "queued"
        job.isBlocked -> "blocked"
        else -> null
      }
      if (state == null && System.currentTimeMillis() - started < 3_600_000L) {
        poll(job, adapter, opts, promise, started)
        return@postDelayed
      }
      busy = false
      val out = mutableMapOf<String, Any?>("completed" to (state != null && state != "cancelled" && state != "failed"), "jobState" to (state ?: "timeout"))
      val info = job.info
      info.printerId?.let { out["printerId"] = it.localId; out["printerName"] = it.localId }
      val media = info.attributes.mediaSize ?: adapter.lastMedia
      val margins = info.attributes.minMargins ?: adapter.lastMargins
      if (media != null) {
        out["paperWidthPt"] = media.widthMils * 72.0 / 1000.0
        out["paperHeightPt"] = media.heightMils * 72.0 / 1000.0
        out["paperPortrait"] = media.isPortrait
        out["mediaId"] = media.id
        if (opts.pageWidthPt > 0) {
          out["paperMatches"] = media.isPortrait && abs(media.widthMils * 72.0 / 1000.0 - opts.pageWidthPt) <= 1.0 &&
            abs(media.heightMils * 72.0 / 1000.0 - opts.pageHeightPt) <= 1.0
        }
      }
      if (margins != null) {
        out["minMarginsMils"] = mapOf("l" to margins.leftMils, "t" to margins.topMils, "r" to margins.rightMils, "b" to margins.bottomMils)
      }
      out["layouts"] = adapter.layouts
      out["writes"] = adapter.writes
      promise.resolve(out)
    }, 400)
  }

  /** The platform's portrait media of this size when there is one (so the dialog preselects it), else a custom one. */
  private fun portraitMedia(wPt: Double, hPt: Double): PrintAttributes.MediaSize {
    if (wPt <= 0 || hPt <= 0) return PrintAttributes.MediaSize.ISO_A4
    val wMils = (wPt * 1000.0 / 72.0).roundToInt()
    val hMils = (hPt * 1000.0 / 72.0).roundToInt()
    val known = listOf(
      PrintAttributes.MediaSize.ISO_A0, PrintAttributes.MediaSize.ISO_A1, PrintAttributes.MediaSize.ISO_A2,
      PrintAttributes.MediaSize.ISO_A3, PrintAttributes.MediaSize.ISO_A4, PrintAttributes.MediaSize.ISO_A5,
      PrintAttributes.MediaSize.ISO_A6, PrintAttributes.MediaSize.ISO_B4, PrintAttributes.MediaSize.ISO_B5,
      PrintAttributes.MediaSize.NA_LETTER, PrintAttributes.MediaSize.NA_LEGAL, PrintAttributes.MediaSize.NA_TABLOID,
      PrintAttributes.MediaSize.NA_INDEX_4X6, PrintAttributes.MediaSize.NA_INDEX_5X8,
    )
    return known.firstOrNull { abs(it.widthMils - wMils) <= 15 && abs(it.heightMils - hMils) <= 15 }
      ?: PrintAttributes.MediaSize("makerprint_${wMils}x$hMils", "${wMils / 1000.0} × ${hMils / 1000.0} in", wMils, hMils)
  }
}

/** Hands our PDF to the print framework unchanged (D12): document content, real page count, bytes copied as they are. */
class ExactAdapter(private val file: File, private val name: String, private val pageCount: Int) : PrintDocumentAdapter() {
  @Volatile var lastMedia: PrintAttributes.MediaSize? = null
  @Volatile var lastMargins: PrintAttributes.Margins? = null
  @Volatile var layouts = 0
  @Volatile var writes = 0

  override fun onLayout(oldAttributes: PrintAttributes?, newAttributes: PrintAttributes, cancellationSignal: CancellationSignal, callback: LayoutResultCallback, extras: Bundle?) {
    if (cancellationSignal.isCanceled) {
      callback.onLayoutCancelled()
      return
    }
    layouts++
    lastMedia = newAttributes.mediaSize
    lastMargins = newAttributes.minMargins
    val info = PrintDocumentInfo.Builder(name)
      .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
      .setPageCount(pageCount)
      .build()
    callback.onLayoutFinished(info, newAttributes != oldAttributes)
  }

  override fun onWrite(pages: Array<out PageRange>, destination: ParcelFileDescriptor, cancellationSignal: CancellationSignal, callback: WriteResultCallback) {
    Thread {
      try {
        FileInputStream(file).use { input -> FileOutputStream(destination.fileDescriptor).use { output -> input.copyTo(output) } }
        writes++
        if (cancellationSignal.isCanceled) callback.onWriteCancelled() else callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
      } catch (e: Exception) {
        callback.onWriteFailed(e.message)
      }
    }.start()
  }
}
