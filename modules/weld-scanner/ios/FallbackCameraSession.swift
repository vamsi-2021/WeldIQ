import AVFoundation
import CoreImage
import UIKit

/// Manual-capture fallback for devices where ARKit world tracking is unavailable.
///
/// No pose tracking is possible here, so the scanner does not report viewing-angle
/// coverage (it would be invented). The user taps Capture at each new angle.
final class FallbackCameraSession: NSObject, ScanCameraSession, AVCapturePhotoCaptureDelegate {
  var onUpdate: (([String: Any]) -> Void)?

  private let captureSession = AVCaptureSession()
  private let photoOutput = AVCapturePhotoOutput()
  private let sessionQueue = DispatchQueue(label: "com.weldiq.scanner.fallback")
  private var configured = false
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private weak var previewContainer: UIView?

  private var state = "idle"
  private var options = ScanOptions(nil)
  private var storage: ScanStorage?
  private var images: [[String: Any]] = []
  private var nextIndex = 1
  private var scanStart: Date?
  private var scanEnd: Date?
  private var pauseStart: Date?
  private var pausedTotal: TimeInterval = 0
  private var errorMessage: String?
  private var cameraActive = false
  private var pendingCapture: ((Error?) -> Void)?
  private var pendingIndex = 0
  private var lastThumbURI: String?
  private var finishWaiter: (() -> Void)?

  // MARK: - Preview

  func attachPreview(to container: UIView) {
    previewContainer = container
    let layer = AVCaptureVideoPreviewLayer(session: captureSession)
    layer.videoGravity = .resizeAspectFill
    layer.frame = container.bounds
    container.layer.addSublayer(layer)
    previewLayer = layer

    AVCaptureDevice.requestAccess(for: .video) { granted in
      DispatchQueue.main.async {
        guard granted else {
          self.errorMessage = "Camera access is denied. Enable camera access for WeldIQ in Settings."
          self.emit()
          return
        }
        self.sessionQueue.async { self.configureAndStart() }
      }
    }
    emit()
  }

  func layoutPreview() {
    if let container = previewContainer { previewLayer?.frame = container.bounds }
  }

  func detachPreview(from container: UIView) {
    guard previewContainer === container else { return }
    previewLayer?.removeFromSuperlayer()
    previewLayer = nil
    previewContainer = nil
    sessionQueue.async { self.captureSession.stopRunning() }
    cameraActive = false
    if state == "scanning" { pause() }
  }

  private func configureAndStart() {
    if !configured {
      guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let input = try? AVCaptureDeviceInput(device: device) else {
        DispatchQueue.main.async {
          self.errorMessage = "No rear camera is available (the iOS Simulator has no camera). Run on a physical iPhone or iPad."
          self.emit()
        }
        return
      }
      captureSession.beginConfiguration()
      captureSession.sessionPreset = .photo
      if captureSession.canAddInput(input) { captureSession.addInput(input) }
      if captureSession.canAddOutput(photoOutput) { captureSession.addOutput(photoOutput) }
      captureSession.commitConfiguration()
      configured = true
    }
    captureSession.startRunning()
    DispatchQueue.main.async {
      self.cameraActive = self.captureSession.isRunning
      self.emit()
    }
  }

  // MARK: - Control

  func start(options: ScanOptions) throws -> [String: Any] {
    guard cameraActive else {
      throw ScannerError.cameraUnavailable(errorMessage ?? "The camera is not running yet.")
    }
    guard state != "scanning" && state != "paused" else { throw ScannerError.alreadyScanning }
    self.options = options
    let storage = try ScanStorage.createNext()
    self.storage = storage
    images = []
    nextIndex = 1
    state = "scanning"
    scanStart = Date()
    scanEnd = nil
    pausedTotal = 0
    lastThumbURI = nil
    emit()
    return ["scanId": storage.scanId, "scanDir": storage.root.path]
  }

  func pause() {
    guard state == "scanning" else { return }
    state = "paused"
    pauseStart = Date()
    emit()
  }

  func resume() {
    guard state == "paused" else { return }
    if let p = pauseStart { pausedTotal += Date().timeIntervalSince(p) }
    pauseStart = nil
    state = "scanning"
    emit()
  }

  func captureManual(completion: @escaping (Error?) -> Void) {
    guard state == "scanning" else { completion(ScannerError.notScanning); return }
    guard pendingCapture == nil else {
      completion(ScannerError.captureFailed("A capture is already in progress."))
      return
    }
    guard images.count < options.maxImageCount else {
      completion(ScannerError.captureFailed("Maximum image count reached."))
      return
    }
    pendingCapture = completion
    pendingIndex = nextIndex
    nextIndex += 1
    let settings = AVCapturePhotoSettings(format: [AVVideoCodecKey: AVVideoCodecType.jpeg])
    sessionQueue.async { self.photoOutput.capturePhoto(with: settings, delegate: self) }
  }

  func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
    let data = photo.fileDataRepresentation()
    DispatchQueue.main.async {
      let completion = self.pendingCapture
      self.pendingCapture = nil
      defer {
        self.emit()
        if self.pendingCapture == nil, let w = self.finishWaiter { self.finishWaiter = nil; w() }
      }
      guard let storage = self.storage, let data = data, error == nil else {
        completion?(ScannerError.captureFailed(error?.localizedDescription ?? "No photo data"))
        return
      }
      let index = self.pendingIndex
      do {
        let url = storage.imageURL(index)
        try data.write(to: url, options: .atomic)
        let thumbURL = storage.thumbURL(index)
        if let ci = CIImage(data: data, options: [.applyOrientationProperty: true]),
           let thumb = ImageEncoder.thumbnail(ci, orientation: .up) {
          try thumb.write(to: thumbURL, options: .atomic)
        }
        self.images.append([
          "index": index,
          "uri": url.absoluteString,
          "thumbUri": thumbURL.absoluteString,
          "fileName": url.lastPathComponent,
          "manual": true,
          "file": "images/\(url.lastPathComponent)",
          "capturedAt": Date().iso8601,
          "depthFiles": [String](),
        ])
        self.lastThumbURI = thumbURL.absoluteString
        completion?(nil)
      } catch {
        completion?(error)
      }
    }
  }

  func finish(completion: @escaping (Result<[String: Any], Error>) -> Void) {
    guard state == "scanning" || state == "paused", let storage = storage else {
      completion(.failure(ScannerError.notScanning))
      return
    }
    if let p = pauseStart { pausedTotal += Date().timeIntervalSince(p) }
    pauseStart = nil
    state = "finished"
    scanEnd = Date()
    let done = { [weak self] in
      guard let self else { return }
      do {
        try storage.writeMetadata(self.metadata())
        completion(.success(self.result()))
      } catch {
        completion(.failure(error))
      }
    }
    if pendingCapture == nil { done() } else { finishWaiter = done }
    emit()
  }

  func reset() {
    if state == "scanning" || state == "paused" { storage?.deleteAll() }
    storage = nil
    images = []
    nextIndex = 1
    state = "idle"
    scanStart = nil
    scanEnd = nil
    lastThumbURI = nil
    emit()
  }

  // MARK: - Status

  private var elapsed: TimeInterval {
    guard let s = scanStart else { return 0 }
    let end = scanEnd ?? Date()
    var paused = pausedTotal
    if let p = pauseStart { paused += end.timeIntervalSince(p) }
    return max(0, end.timeIntervalSince(s) - paused)
  }

  private func emit() {
    var s: [String: Any] = [
      "mode": "manual",
      "state": state,
      "cameraActive": cameraActive,
      "tracking": "notAvailable",
      "guidance": state == "scanning"
        ? "ARKit unavailable — tap Capture at each new angle around the weld"
        : "Center the weld in the guide, then tap Start Scan",
      "captureCount": images.count,
      "targetCount": options.targetImageCount,
      "maxCount": options.maxImageCount,
      "currentSegment": -1,
      "targetLocked": false,
      "targetSource": "none",
      "lidar": false,
      "elapsedSec": elapsed,
      "capturing": pendingCapture != nil,
      "segments": [Float](),
      "bandCoverage": [Float](),
      "bandNames": [String](),
    ]
    s["coverage"] = NSNull()  // Not measurable without pose tracking.
    s["trackingMessage"] = "Pose tracking unavailable — manual capture mode"
    s["error"] = errorMessage ?? NSNull()
    s["currentElevationDeg"] = NSNull()
    s["lastThumbUri"] = lastThumbURI ?? NSNull()
    s["scanId"] = storage?.scanId ?? NSNull()
    onUpdate?(s)
  }

  private func result() -> [String: Any] {
    guard let storage = storage else { return [:] }
    return [
      "scanId": storage.scanId,
      "scanDir": storage.root.path,
      "metadataPath": storage.metadataURL.path,
      "mode": "manual",
      "imageCount": images.count,
      "durationSec": elapsed,
      "lidar": false,
      "targetSource": "none",
      "coverage": NSNull(),
      "bandCoverage": [Float](),
      "bandNames": [String](),
      "segments": [Float](),
      "missingAngles": ["Coverage could not be measured: ARKit tracking is unavailable on this device. Make sure you captured the weld from all sides."],
      "images": images,
    ]
  }

  private func metadata() -> [String: Any] {
    let device = UIDevice.current
    return [
      "schemaVersion": 1,
      "scanId": storage?.scanId ?? "",
      "createdAt": scanStart?.iso8601 ?? "",
      "finishedAt": scanEnd?.iso8601 ?? "",
      "durationSec": elapsed,
      "captureMode": "manual",
      "device": ["model": device.model, "systemVersion": device.systemVersion, "lidar": false],
      "options": options.dictionary,
      "coordinateSystem": NSNull(),
      "coverage": NSNull(),
      "target": NSNull(),
      "images": images.map { img -> [String: Any] in
        [
          "index": img["index"] ?? 0,
          "file": img["file"] ?? "",
          "capturedAt": img["capturedAt"] ?? "",
          "manual": true,
          "intrinsics": NSNull(),
          "transform": NSNull(),
          "depth": NSNull(),
        ]
      },
    ]
  }
}
