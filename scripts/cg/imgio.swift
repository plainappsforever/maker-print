import Foundation
import ImageIO
var out: [String: [String: String]] = [:]
for p in CommandLine.arguments.dropFirst() {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: p) as CFURL, nil), let props = CGImageSourceCopyPropertiesAtIndex(src, 0, nil) as? [String: Any] else { out[(p as NSString).lastPathComponent] = ["error": "unreadable"]; continue }
  var d: [String: String] = [:]
  for k in ["PixelWidth", "PixelHeight", "Orientation", "DPIWidth", "DPIHeight", "ColorModel", "Depth"] { if let v = props[k] { d[k] = "\(v)" } }
  out[(p as NSString).lastPathComponent] = d
}
print(String(data: try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), encoding: .utf8)!)
