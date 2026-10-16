// Writes an owner-password-only encrypted PDF (empty user password) with Apple's PDF writer: red rect at 100,600 pt.
import Foundation
import CoreGraphics
let out = CommandLine.arguments[1], keyLen = Int(CommandLine.arguments[2])!, userPw = CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : ""
var box = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
let info: [CFString: Any] = [kCGPDFContextOwnerPassword: "owner-secret", kCGPDFContextUserPassword: userPw, kCGPDFContextAllowsPrinting: true, kCGPDFContextAllowsCopying: false, kCGPDFContextEncryptionKeyLength: keyLen]
let ctx = CGContext(URL(fileURLWithPath: out) as CFURL, mediaBox: &box, info as CFDictionary)!
ctx.beginPDFPage(nil)
ctx.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1)); ctx.fill(CGRect(x: 100, y: 600, width: 100, height: 100))
// some compressed text content too
ctx.setFillColor(CGColor(red: 0, green: 0, blue: 1, alpha: 1)); ctx.fill(CGRect(x: 300, y: 300, width: 50, height: 50))
ctx.endPDFPage(); ctx.closePDF()
