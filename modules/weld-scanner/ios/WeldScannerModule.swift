import ARKit
import UIKit

/// Swift entry point used by the Objective-C++ React Native glue
/// (RCTWeldScanner.mm and WeldScannerCameraViewComponentView.mm).
///
/// Owns exactly one camera session for the whole app: ARKit world tracking when
/// supported, otherwise a manual AVCapture fallback. Every public method may be
/// called from any thread; work is moved to the main thread.
@objc(WeldScannerCore)
public final class WeldScannerCore: NSObject {
  @objc public static let shared = WeldScannerCore()

  /// Receives status dictionaries (see ScanStatus in the app's ScanTypes.ts).
  @objc public var eventHandler: ((NSDictionary) -> Void)?

  private lazy var session: ScanCameraSession = {
    let s: ScanCameraSession = ARWorldTrackingConfiguration.isSupported ? ARScanSession() : FallbackCameraSession()
    s.onUpdate = { [weak self] status in self?.eventHandler?(status as NSDictionary) }
    return s
  }()

  @objc public func capabilities() -> NSDictionary {
    let arkit = ARWorldTrackingConfiguration.isSupported
    var highRes = false
    if #available(iOS 16.0, *) {
      highRes = arkit && ARWorldTrackingConfiguration.recommendedVideoFormatForHighResolutionFrameCapturing != nil
    }
    let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) != nil
    return [
      "arkitSupported": arkit,
      "lidarSupported": arkit && ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth),
      "highResCaptureSupported": highRes,
      "cameraAvailable": camera,
      "mode": arkit ? "arkit" : "manual",
      "cameraAuthorization": FallbackAuthorization.string,
    ]
  }

  @objc public func attachPreview(_ container: UIView) {
    onMain { self.session.attachPreview(to: container) }
  }

  @objc public func detachPreview(_ container: UIView) {
    onMain { self.session.detachPreview(from: container) }
  }

  @objc public func layoutPreview() {
    onMain { (self.session as? FallbackCameraSession)?.layoutPreview() }
  }

  @objc public func startScan(
    _ options: NSDictionary?,
    resolve: @escaping (NSDictionary) -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    onMain {
      do {
        let info = try self.session.start(options: ScanOptions(options))
        resolve(info as NSDictionary)
      } catch {
        reject("E_START", error.localizedDescription)
      }
    }
  }

  @objc public func pauseScan() { onMain { self.session.pause() } }

  @objc public func resumeScan() { onMain { self.session.resume() } }

  @objc public func resetScan() { onMain { self.session.reset() } }

  @objc public func captureManual(
    resolve: @escaping () -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    onMain {
      self.session.captureManual { error in
        if let error = error { reject("E_CAPTURE", error.localizedDescription) } else { resolve() }
      }
    }
  }

  @objc public func finishScan(
    resolve: @escaping (NSDictionary) -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    onMain {
      self.session.finish { result in
        switch result {
        case .success(let dict): resolve(dict as NSDictionary)
        case .failure(let error): reject("E_FINISH", error.localizedDescription)
        }
      }
    }
  }

  @objc public func discardScan(
    _ scanId: String,
    resolve: @escaping () -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    DispatchQueue.global(qos: .utility).async {
      do {
        try ScanStorage.delete(scanId: scanId)
        resolve()
      } catch {
        reject("E_DISCARD", error.localizedDescription)
      }
    }
  }

  @objc public func zipScan(
    _ scanId: String,
    resolve: @escaping (NSDictionary) -> Void,
    reject: @escaping (String, String) -> Void
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let url = try ScanStorage.zip(scanId: scanId)
        let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.doubleValue ?? 0
        resolve(["path": url.path, "uri": url.absoluteString, "name": url.lastPathComponent, "sizeBytes": size])
      } catch {
        reject("E_ZIP", error.localizedDescription)
      }
    }
  }

  private func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread { block() } else { DispatchQueue.main.async(execute: block) }
  }
}

private enum FallbackAuthorization {
  static var string: String {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "notDetermined"
    @unknown default: return "unknown"
    }
  }
}
