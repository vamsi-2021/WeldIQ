import UIKit
import CoreImage
import ImageIO

/// Common interface for the ARKit scanner and the manual AVCapture fallback.
/// All methods are called on the main thread.
protocol ScanCameraSession: AnyObject {
  var onUpdate: (([String: Any]) -> Void)? { get set }
  func attachPreview(to container: UIView)
  func detachPreview(from container: UIView)
  func start(options: ScanOptions) throws -> [String: Any]
  func pause()
  func resume()
  func captureManual(completion: @escaping (Error?) -> Void)
  func finish(completion: @escaping (Result<[String: Any], Error>) -> Void)
  func reset()
}

struct ScanOptions {
  /// Image count at which the UI suggests finishing (coverage still drives progress).
  var targetImageCount = 60
  /// Hard cap on automatic captures.
  var maxImageCount = 100
  /// Minimum angle (degrees, seen from the target) between a new view and every previous view.
  var minAngleDeg: Float = 8
  /// A view at a similar angle still counts as new if its distance to the weld differs by this ratio.
  var distanceNoveltyRatio: Float = 1.35
  /// Minimum time between automatic captures.
  var minIntervalSec: Double = 0.4
  /// Above these speeds frames are likely blurred, so auto-capture waits.
  var maxLinearSpeed: Float = 0.30       // m/s
  var maxAngularSpeedDeg: Float = 40     // deg/s
  /// The weld must be within this angle of the camera's optical axis.
  var maxOffAxisDeg: Float = 28
  var jpegQuality: Double = 0.9
  /// Use ARKit's high-resolution still capture (iOS 16+) instead of video frames.
  var useHighResolutionFrames = true
  /// Long-side limit for saved images; keeps uploads and reconstruction time manageable.
  var maxImageDimension: Int = 2560
  var saveDepth = true
  /// Used when neither a plane nor feature points are hit at the screen center.
  var fallbackTargetDistance: Float = 0.4

  init(_ dict: NSDictionary?) {
    guard let d = dict else { return }
    if let v = d["targetImageCount"] as? NSNumber { targetImageCount = max(5, v.intValue) }
    if let v = d["maxImageCount"] as? NSNumber { maxImageCount = max(5, v.intValue) }
    if let v = d["minAngleDeg"] as? NSNumber { minAngleDeg = max(2, v.floatValue) }
    if let v = d["minIntervalSec"] as? NSNumber { minIntervalSec = max(0.1, v.doubleValue) }
    if let v = d["jpegQuality"] as? NSNumber { jpegQuality = min(1, max(0.3, v.doubleValue)) }
    if let v = d["useHighResolutionFrames"] as? NSNumber { useHighResolutionFrames = v.boolValue }
    if let v = d["maxImageDimension"] as? NSNumber { maxImageDimension = max(640, v.intValue) }
    if let v = d["saveDepth"] as? NSNumber { saveDepth = v.boolValue }
    if let v = d["fallbackTargetDistance"] as? NSNumber { fallbackTargetDistance = max(0.1, v.floatValue) }
    if maxImageCount < targetImageCount { maxImageCount = targetImageCount }
  }

  var dictionary: [String: Any] {
    return [
      "targetImageCount": targetImageCount,
      "maxImageCount": maxImageCount,
      "minAngleDeg": minAngleDeg,
      "minIntervalSec": minIntervalSec,
      "jpegQuality": jpegQuality,
      "useHighResolutionFrames": useHighResolutionFrames,
      "maxImageDimension": maxImageDimension,
      "saveDepth": saveDepth,
    ]
  }
}

enum ScannerError: LocalizedError {
  case previewNotActive
  case alreadyScanning
  case notScanning
  case cameraUnavailable(String)
  case captureFailed(String)

  var errorDescription: String? {
    switch self {
    case .previewNotActive: return "The camera preview is not active."
    case .alreadyScanning: return "A scan is already in progress."
    case .notScanning: return "No scan is in progress."
    case .cameraUnavailable(let msg): return msg
    case .captureFailed(let msg): return msg
    }
  }
}

/// JPEG/thumbnail encoding shared by both sessions.
enum ImageEncoder {
  static let context = CIContext(options: [.cacheIntermediates: false])
  static let sRGB = CGColorSpace(name: CGColorSpace.sRGB)!

  /// Scales `image` so its long side is at most `maxDimension`. Returns the image and scale factor.
  static func limit(_ image: CIImage, maxDimension: Int) -> (CIImage, CGFloat) {
    let extent = image.extent
    let longSide = max(extent.width, extent.height)
    guard longSide > CGFloat(maxDimension) else { return (image, 1) }
    let scale = CGFloat(maxDimension) / longSide
    let filter = CIFilter(name: "CILanczosScaleTransform")!
    filter.setValue(image, forKey: kCIInputImageKey)
    filter.setValue(scale, forKey: kCIInputScaleKey)
    filter.setValue(1.0, forKey: kCIInputAspectRatioKey)
    let out = filter.outputImage ?? image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    // Lanczos can produce a fractional extent; crop to whole pixels at the origin.
    let w = floor(extent.width * scale), h = floor(extent.height * scale)
    let cropped = out.cropped(to: CGRect(x: out.extent.origin.x, y: out.extent.origin.y, width: w, height: h))
    return (cropped.transformed(by: CGAffineTransform(translationX: -cropped.extent.origin.x, y: -cropped.extent.origin.y)), scale)
  }

  static func jpeg(_ image: CIImage, quality: Double) -> Data? {
    let key = CIImageRepresentationOption(rawValue: kCGImageDestinationLossyCompressionQuality as String)
    return context.jpegRepresentation(of: image, colorSpace: sRGB, options: [key: quality])
  }

  static func thumbnail(_ image: CIImage, orientation: CGImagePropertyOrientation, maxDimension: Int = 360) -> Data? {
    let (small, _) = limit(image.oriented(orientation), maxDimension: maxDimension)
    return jpeg(small, quality: 0.75)
  }

  /// Orientation that turns a sensor (landscape-right) frame upright for the current UI.
  static func thumbnailOrientation(for interface: UIInterfaceOrientation) -> CGImagePropertyOrientation {
    switch interface {
    case .landscapeRight: return .up
    case .landscapeLeft: return .down
    case .portraitUpsideDown: return .left
    default: return .right
    }
  }
}

extension Date {
  var iso8601: String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.string(from: self)
  }
}
