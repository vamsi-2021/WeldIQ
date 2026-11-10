import ARKit
import SceneKit
import UIKit

/// Rear-camera scanner built on one ARKit world-tracking session.
///
/// The same ARSession drives the preview, pose tracking and image capture, so
/// there is never a second camera session competing for the camera.
///
/// Capture rule (evaluated every frame while scanning):
///   tracking is normal
///   AND the weld target is near the optical axis
///   AND the device is moving slowly enough to avoid blur
///   AND the viewing direction from the weld differs by >= minAngleDeg from every
///       earlier image (or the distance to the weld differs enough)
///   AND minIntervalSec has passed since the last capture.
final class ARScanSession: NSObject, ScanCameraSession, ARSessionDelegate {
  enum State: String { case idle, scanning, paused, finished }

  private struct Capture {
    let index: Int
    let direction: simd_float3
    let distance: Float
    let relativeAzimuth: Float
    let elevation: Float
    let manual: Bool
    let imageURL: URL
    let thumbURL: URL
    let metadata: [String: Any]
  }

  /// Pose information taken from the frame that triggered a capture.
  private struct CaptureRequest {
    let index: Int
    let manual: Bool
    let interfaceOrientation: UIInterfaceOrientation
  }

  var onUpdate: (([String: Any]) -> Void)?

  let session = ARSession()
  private weak var sceneView: ARSCNView?
  private var running = false

  private var state: State = .idle
  private var options = ScanOptions(nil)
  private var tracker = CameraCoverageTracker()
  private var storage: ScanStorage?
  private var captures: [Capture] = []
  private var nextIndex = 1

  private var target: simd_float3?
  private var targetSource = "none"
  private let targetNode = ARScanSession.makeTargetNode()

  private var scanStart: Date?
  private var scanEnd: Date?
  private var pauseStart: Date?
  private var pausedTotal: TimeInterval = 0

  private var captureInFlight = false
  private var pendingWrites = 0
  private var finishWaiters: [() -> Void] = []
  private var lastCaptureTimestamp: TimeInterval = 0
  private var manualCaptureCompletion: ((Error?) -> Void)?

  private var prevTransform: simd_float4x4?
  private var prevTimestamp: TimeInterval = 0
  private var linearSpeed: Float = 0
  private var angularSpeedDeg: Float = 0

  private var tracking = "notAvailable"
  private var trackingMessage: String? = "Starting camera…"
  private var guidance = "Center the weld in the guide, then tap Start Scan"
  private var errorMessage: String?
  private var currentSegment = -1
  private var currentElevation: Float?
  private var lastEmit: CFTimeInterval = 0
  private var lastThumbURI: String?

  let lidarSupported = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
  private(set) var highResSupported = false

  private let encodeQueue = DispatchQueue(label: "com.weldiq.scanner.encode", qos: .userInitiated)

  override init() {
    super.init()
    session.delegate = self
  }

  // MARK: - Preview

  func attachPreview(to container: UIView) {
    let view = ARSCNView(frame: container.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.session = session
    view.scene = SCNScene()
    view.automaticallyUpdatesLighting = true
    view.rendersCameraGrain = false
    container.addSubview(view)
    sceneView = view
    if target != nil { view.scene.rootNode.addChildNode(targetNode) }
    if !running { runSession() }
    emit(force: true)
  }

  func detachPreview(from container: UIView) {
    if let view = sceneView, view.superview === container {
      targetNode.removeFromParentNode()
      view.removeFromSuperview()
      sceneView = nil
    }
    // Release the camera whenever no preview is on screen.
    if sceneView == nil {
      session.pause()
      running = false
      if state == .scanning { pause() }
    }
  }

  private func runSession() {
    guard ARWorldTrackingConfiguration.isSupported else {
      errorMessage = "ARKit world tracking is not supported on this device."
      emit(force: true)
      return
    }
    let config = ARWorldTrackingConfiguration()
    config.planeDetection = [.horizontal, .vertical]
    config.isAutoFocusEnabled = true
    config.worldAlignment = .gravity
    if lidarSupported {
      config.frameSemantics.insert(.sceneDepth)
    }
    if #available(iOS 16.0, *),
       let format = ARWorldTrackingConfiguration.recommendedVideoFormatForHighResolutionFrameCapturing {
      config.videoFormat = format
      highResSupported = true
    }
    // Keep the existing world map when resuming an unfinished scan so poses stay consistent.
    let keepWorld = state == .scanning || state == .paused
    session.run(config, options: keepWorld ? [] : [.resetTracking, .removeExistingAnchors])
    running = true
    errorMessage = nil
  }

  // MARK: - Scan control

  func start(options: ScanOptions) throws -> [String: Any] {
    guard running else { throw ScannerError.previewNotActive }
    guard state != .scanning && state != .paused else { throw ScannerError.alreadyScanning }
    if state == .finished { clearScanState(deleteFiles: false) }

    self.options = options
    let storage = try ScanStorage.createNext()
    self.storage = storage
    state = .scanning
    scanStart = Date()
    scanEnd = nil
    pausedTotal = 0
    pauseStart = nil
    guidance = "Hold steady — locking onto the weld"
    if let frame = session.currentFrame, case .normal = frame.camera.trackingState {
      establishTarget(frame)
    }
    emit(force: true)
    return ["scanId": storage.scanId, "scanDir": storage.root.path]
  }

  func pause() {
    guard state == .scanning else { return }
    state = .paused
    pauseStart = Date()
    guidance = "Scan paused"
    emit(force: true)
  }

  func resume() {
    guard state == .paused else { return }
    if let p = pauseStart { pausedTotal += Date().timeIntervalSince(p) }
    pauseStart = nil
    state = .scanning
    if !running, sceneView != nil { runSession() }
    guidance = "Move slowly around the weld"
    emit(force: true)
  }

  func captureManual(completion: @escaping (Error?) -> Void) {
    guard state == .scanning || state == .paused else { completion(ScannerError.notScanning); return }
    guard let frame = session.currentFrame else {
      completion(ScannerError.captureFailed("No camera frame available yet."))
      return
    }
    guard !captureInFlight else {
      completion(ScannerError.captureFailed("A capture is already in progress."))
      return
    }
    if target == nil { establishTarget(frame) }
    manualCaptureCompletion = completion
    capture(frame: frame, manual: true)
  }

  func finish(completion: @escaping (Result<[String: Any], Error>) -> Void) {
    guard state == .scanning || state == .paused, let storage = storage else {
      completion(.failure(ScannerError.notScanning))
      return
    }
    if let p = pauseStart { pausedTotal += Date().timeIntervalSince(p) }
    pauseStart = nil
    state = .finished
    scanEnd = Date()
    guidance = "Scan finished"
    emit(force: true)

    whenIdle { [weak self] in
      guard let self else { return }
      do {
        try storage.writeMetadata(self.metadata())
        completion(.success(self.result()))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func reset() {
    // Unfinished scans are thrown away. Finished scans stay on disk for review/upload.
    clearScanState(deleteFiles: state == .scanning || state == .paused)
    guidance = "Center the weld in the guide, then tap Start Scan"
    emit(force: true)
  }

  private func clearScanState(deleteFiles: Bool) {
    if deleteFiles { storage?.deleteAll() }
    storage = nil
    state = .idle
    captures = []
    nextIndex = 1
    tracker.reset()
    target = nil
    targetSource = "none"
    targetNode.removeFromParentNode()
    scanStart = nil
    scanEnd = nil
    pausedTotal = 0
    pauseStart = nil
    lastThumbURI = nil
    currentSegment = -1
  }

  private func whenIdle(_ block: @escaping () -> Void) {
    if !captureInFlight && pendingWrites == 0 { block() } else { finishWaiters.append(block) }
  }

  private func drainWaitersIfIdle() {
    guard !captureInFlight && pendingWrites == 0 else { return }
    let waiters = finishWaiters
    finishWaiters = []
    waiters.forEach { $0() }
  }

  // MARK: - ARSessionDelegate

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    updateTracking(frame.camera)
    updateMotion(frame)
    if state == .scanning {
      evaluateAutoCapture(frame)
    } else if state == .idle {
      updateIdleGuidance(frame)
    }
    emit(force: false)
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    if let arError = error as? ARError, arError.code == .cameraUnauthorized {
      errorMessage = "Camera access is denied. Enable camera access for WeldIQ in Settings."
    } else {
      errorMessage = "Camera session failed: \(error.localizedDescription)"
    }
    running = false
    if state == .scanning { pause() }
    emit(force: true)
  }

  func sessionWasInterrupted(_ session: ARSession) {
    trackingMessage = "Camera interrupted"
    if state == .scanning { pause() }
    emit(force: true)
  }

  func sessionInterruptionEnded(_ session: ARSession) {
    trackingMessage = "Relocalizing — point the camera back at the weld"
    emit(force: true)
  }

  func sessionShouldAttemptRelocalization(_ session: ARSession) -> Bool { true }

  // MARK: - Per-frame logic

  private func updateTracking(_ camera: ARCamera) {
    switch camera.trackingState {
    case .normal:
      tracking = "normal"
      trackingMessage = nil
    case .notAvailable:
      tracking = "notAvailable"
      trackingMessage = "Tracking unavailable"
    case .limited(let reason):
      tracking = "limited"
      switch reason {
      case .initializing: trackingMessage = "Initializing — move the device slowly side to side"
      case .excessiveMotion: trackingMessage = "Moving too fast — slow down"
      case .insufficientFeatures: trackingMessage = "Not enough visual detail — add light or include textured surfaces"
      case .relocalizing: trackingMessage = "Tracking lost — return to where you were and point at the weld"
      @unknown default: trackingMessage = "Tracking limited"
      }
    }
  }

  private func updateMotion(_ frame: ARFrame) {
    let t = frame.camera.transform
    if let prev = prevTransform {
      let dt = Float(frame.timestamp - prevTimestamp)
      if dt > 0.001 {
        let dp = simd_length(t.position - prev.position)
        let rel = simd_quatf(prev.rotation).inverse * simd_quatf(t.rotation)
        let angle = abs(rel.angle > .pi ? 2 * .pi - rel.angle : rel.angle) * 180 / .pi
        // Exponential smoothing so a single jittery frame doesn't block capture.
        linearSpeed = 0.7 * linearSpeed + 0.3 * (dp / dt)
        angularSpeedDeg = 0.7 * angularSpeedDeg + 0.3 * (angle / dt)
      }
    }
    prevTransform = t
    prevTimestamp = frame.timestamp
  }

  private func updateIdleGuidance(_ frame: ARFrame) {
    if case .normal = frame.camera.trackingState {
      guidance = "Center the weld in the guide, then tap Start Scan"
    } else {
      guidance = "Move the device slowly so tracking can start"
    }
  }

  private func evaluateAutoCapture(_ frame: ARFrame) {
    guard case .normal = frame.camera.trackingState else {
      guidance = "Tracking lost — capture paused until tracking recovers"
      return
    }
    if target == nil { establishTarget(frame) }
    guard let target = target else { return }

    let camPos = frame.camera.transform.position
    let toCam = camPos - target
    let distance = simd_length(toCam)
    guard distance > 0.01 else { return }
    let dir = toCam / distance

    let forward = -simd_normalize(frame.camera.transform.columns.2.xyz)
    let offAxis = angleDeg(forward, simd_normalize(target - camPos))
    let az = CameraCoverageTracker.azimuth(of: dir)
    currentSegment = tracker.ringSegment(forAbsoluteAzimuth: az)
    currentElevation = CameraCoverageTracker.elevation(of: dir)

    if captures.count >= options.maxImageCount {
      guidance = "Maximum of \(options.maxImageCount) images reached — tap Finish"
      return
    }
    if offAxis > options.maxOffAxisDeg {
      guidance = "Keep the weld inside the center guide"
      return
    }
    if distance < 0.07 {
      guidance = "Too close — move back a little"
      return
    }
    if distance > 2.5 {
      guidance = "Too far — move closer to the weld"
      return
    }
    if linearSpeed > options.maxLinearSpeed || angularSpeedDeg > options.maxAngularSpeedDeg {
      guidance = "Slow down — moving too fast for sharp images"
      return
    }

    let cameraRight = simd_normalize(frame.camera.transform.columns.0.xyz)
    let cameraUp = simd_normalize(frame.camera.transform.columns.1.xyz)
    guidance = tracker.guidance(currentDir: dir, cameraRight: cameraRight, cameraUp: cameraUp)
    if captures.count >= options.targetImageCount && tracker.coverage >= 0.85 {
      guidance = "Target reached — tap Finish, or keep filling gaps"
    }

    guard !captureInFlight, frame.timestamp - lastCaptureTimestamp >= options.minIntervalSec else { return }
    guard isNovel(direction: dir, distance: distance) else { return }
    capture(frame: frame, manual: false)
  }

  private func isNovel(direction: simd_float3, distance: Float) -> Bool {
    if captures.isEmpty { return true }
    var minAngle = Float.greatestFiniteMagnitude
    var nearestDistance: Float = distance
    for c in captures {
      let a = angleDeg(c.direction, direction)
      if a < minAngle {
        minAngle = a
        nearestDistance = c.distance
      }
    }
    if minAngle >= options.minAngleDeg { return true }
    // Same direction but a clearly different distance (close-up vs overview) adds detail.
    let ratio = max(distance, nearestDistance) / max(0.001, min(distance, nearestDistance))
    return minAngle < options.minAngleDeg * 0.5 ? false : ratio >= options.distanceNoveltyRatio
  }

  /// Picks the 3D point the user is aiming at with the center guide.
  private func establishTarget(_ frame: ARFrame) {
    let camPos = frame.camera.transform.position
    let forward = -simd_normalize(frame.camera.transform.columns.2.xyz)

    // 1. Raycast against detected/estimated surfaces.
    let query = frame.raycastQuery(from: CGPoint(x: 0.5, y: 0.5), allowing: .estimatedPlane, alignment: .any)
    if let hit = session.raycast(query).first {
      let p = hit.worldTransform.position
      let d = simd_length(p - camPos)
      if d > 0.05 && d < 3 {
        setTarget(p, source: "raycast")
        return
      }
    }
    // 2. Median depth of tracked feature points near the optical axis.
    if let points = frame.rawFeaturePoints?.points, !points.isEmpty {
      var depths: [Float] = []
      for p in points {
        let v = p - camPos
        let along = simd_dot(v, forward)
        guard along > 0.05 else { continue }
        if angleDeg(simd_normalize(v), forward) < 6 { depths.append(along) }
      }
      if depths.count >= 5 {
        depths.sort()
        setTarget(camPos + forward * depths[depths.count / 2], source: "featurePoints")
        return
      }
    }
    // 3. Fixed distance in front of the camera.
    setTarget(camPos + forward * options.fallbackTargetDistance, source: "fixedDistance")
  }

  private func setTarget(_ p: simd_float3, source: String) {
    target = p
    targetSource = source
    targetNode.simdPosition = p
    if targetNode.parent == nil { sceneView?.scene.rootNode.addChildNode(targetNode) }
  }

  // MARK: - Capture & persistence

  private func capture(frame: ARFrame, manual: Bool) {
    guard let _ = storage else { return }
    captureInFlight = true
    lastCaptureTimestamp = frame.timestamp
    let request = CaptureRequest(
      index: nextIndex,
      manual: manual,
      interfaceOrientation: sceneView?.window?.windowScene?.interfaceOrientation ?? .portrait
    )
    nextIndex += 1

    if options.useHighResolutionFrames, highResSupported, #available(iOS 16.0, *) {
      session.captureHighResolutionFrame { [weak self] hiResFrame, _ in
        DispatchQueue.main.async {
          guard let self else { return }
          // Fall back to the latest video frame if the still capture fails.
          if let f = hiResFrame ?? self.session.currentFrame {
            self.persist(frame: f, request: request)
          } else {
            self.captureFailed(request, message: "Camera frame unavailable")
          }
        }
      }
    } else {
      persist(frame: frame, request: request)
    }
  }

  private func persist(frame: ARFrame, request: CaptureRequest) {
    guard let storage = storage, let target = target else {
      captureFailed(request, message: "Scan is not active")
      return
    }
    let camera = frame.camera
    let transform = camera.transform
    let camPos = transform.position
    let toCam = camPos - target
    let distance = max(0.001, simd_length(toCam))
    let dir = toCam / distance
    let azAbs = CameraCoverageTracker.azimuth(of: dir)
    let elev = CameraCoverageTracker.elevation(of: dir)
    let pixelBuffer = frame.capturedImage
    let intrinsics = camera.intrinsics
    let trackingName = tracking
    let timestamp = frame.timestamp
    let exposure = camera.exposureDuration

    // Copy LiDAR depth now; ARKit reuses those buffers.
    let depthCopy: (depth: Data, confidence: Data?, width: Int, height: Int)? =
      (options.saveDepth ? frame.sceneDepth : nil).flatMap { ARScanSession.copyDepth($0) }

    let quality = options.jpegQuality
    let maxDim = options.maxImageDimension
    let thumbOrientation = ImageEncoder.thumbnailOrientation(for: request.interfaceOrientation)
    let imageURL = storage.imageURL(request.index)
    let thumbURL = storage.thumbURL(request.index)
    let depthURL = storage.depthURL(request.index)
    let confURL = storage.confidenceURL(request.index)
    pendingWrites += 1

    encodeQueue.async { [weak self] in
      let source = CIImage(cvPixelBuffer: pixelBuffer)
      let (scaled, scale) = ImageEncoder.limit(source, maxDimension: maxDim)
      let outW = Int(scaled.extent.width), outH = Int(scaled.extent.height)
      guard let jpeg = ImageEncoder.jpeg(scaled, quality: quality) else {
        DispatchQueue.main.async { self?.writeFinished(request, record: nil, error: "JPEG encoding failed") }
        return
      }
      do {
        try jpeg.write(to: imageURL, options: .atomic)
        if let thumb = ImageEncoder.thumbnail(source, orientation: thumbOrientation) {
          try thumb.write(to: thumbURL, options: .atomic)
        }
        var depthInfo: Any = NSNull()
        if let d = depthCopy {
          try d.depth.write(to: depthURL, options: .atomic)
          var info: [String: Any] = [
            "file": "depth/\(depthURL.lastPathComponent)",
            "width": d.width, "height": d.height,
            "format": "float32_le_meters_row_major",
          ]
          if let c = d.confidence {
            try c.write(to: confURL, options: .atomic)
            info["confidenceFile"] = "depth/\(confURL.lastPathComponent)"
            info["confidenceFormat"] = "uint8_row_major_0_low_2_high"
          }
          depthInfo = info
        }

        let s = Float(scale)
        let fx = intrinsics[0][0] * s, fy = intrinsics[1][1] * s
        let cx = intrinsics[2][0] * s, cy = intrinsics[2][1] * s
        let meta: [String: Any] = [
          "index": request.index,
          "file": "images/\(imageURL.lastPathComponent)",
          "timestamp": timestamp,
          "capturedAt": Date().iso8601,
          "manual": request.manual,
          "width": outW,
          "height": outH,
          "intrinsics": ["fx": fx, "fy": fy, "cx": cx, "cy": cy],
          "transform": transform.columnMajorArray,
          "position": [camPos.x, camPos.y, camPos.z],
          "trackingState": trackingName,
          "directionFromTarget": [dir.x, dir.y, dir.z],
          "azimuthDeg": azAbs,
          "elevationDeg": elev,
          "distanceToTargetM": distance,
          "exposureDurationS": exposure,
          "depth": depthInfo,
        ]
        let record = (dir: dir, distance: distance, azAbs: azAbs, elev: elev, meta: meta)
        DispatchQueue.main.async {
          self?.writeFinished(request, record: record, error: nil, imageURL: imageURL, thumbURL: thumbURL)
        }
      } catch {
        DispatchQueue.main.async { self?.writeFinished(request, record: nil, error: error.localizedDescription) }
      }
    }
  }

  private func writeFinished(
    _ request: CaptureRequest,
    record: (dir: simd_float3, distance: Float, azAbs: Float, elev: Float, meta: [String: Any])?,
    error: String?,
    imageURL: URL? = nil,
    thumbURL: URL? = nil
  ) {
    pendingWrites -= 1
    captureInFlight = false
    let completion = request.manual ? manualCaptureCompletion : nil
    if request.manual { manualCaptureCompletion = nil }

    // A reset or new scan may have happened while encoding; drop stale results.
    if let record = record, let imageURL = imageURL, let thumbURL = thumbURL,
       let storage = storage, imageURL.path.hasPrefix(storage.root.path) {
      tracker.record(direction: record.dir)
      captures.append(Capture(
        index: request.index,
        direction: record.dir,
        distance: record.distance,
        relativeAzimuth: tracker.relativeAzimuth(record.azAbs),
        elevation: record.elev,
        manual: request.manual,
        imageURL: imageURL,
        thumbURL: thumbURL,
        metadata: record.meta
      ))
      lastThumbURI = thumbURL.absoluteString
      completion?(nil)
    } else {
      if let error = error { guidance = "Failed to save image: \(error)" }
      completion?(ScannerError.captureFailed(error ?? "Capture discarded"))
    }
    emit(force: true)
    drainWaitersIfIdle()
  }

  private func captureFailed(_ request: CaptureRequest, message: String) {
    pendingWrites += 1  // balanced by writeFinished
    writeFinished(request, record: nil, error: message)
  }

  private static func copyDepth(_ depth: ARDepthData) -> (depth: Data, confidence: Data?, width: Int, height: Int)? {
    let map = depth.depthMap
    CVPixelBufferLockBaseAddress(map, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(map, .readOnly) }
    let w = CVPixelBufferGetWidth(map), h = CVPixelBufferGetHeight(map)
    let rowBytes = CVPixelBufferGetBytesPerRow(map)
    guard let base = CVPixelBufferGetBaseAddress(map) else { return nil }
    var data = Data(capacity: w * h * 4)
    for y in 0..<h {
      data.append(base.advanced(by: y * rowBytes).assumingMemoryBound(to: UInt8.self), count: w * 4)
    }
    var confData: Data?
    if let conf = depth.confidenceMap {
      CVPixelBufferLockBaseAddress(conf, .readOnly)
      defer { CVPixelBufferUnlockBaseAddress(conf, .readOnly) }
      let cw = CVPixelBufferGetWidth(conf), ch = CVPixelBufferGetHeight(conf)
      let cRow = CVPixelBufferGetBytesPerRow(conf)
      if let cBase = CVPixelBufferGetBaseAddress(conf) {
        var c = Data(capacity: cw * ch)
        for y in 0..<ch {
          c.append(cBase.advanced(by: y * cRow).assumingMemoryBound(to: UInt8.self), count: cw)
        }
        confData = c
      }
    }
    return (data, confData, w, h)
  }

  // MARK: - Status / results

  private var elapsed: TimeInterval {
    guard let start = scanStart else { return 0 }
    let end = scanEnd ?? Date()
    var paused = pausedTotal
    if let p = pauseStart { paused += end.timeIntervalSince(p) }
    return max(0, end.timeIntervalSince(start) - paused)
  }

  private func emit(force: Bool) {
    let now = CACurrentMediaTime()
    if !force && now - lastEmit < 0.2 { return }
    lastEmit = now
    onUpdate?(status())
  }

  func status() -> [String: Any] {
    var s: [String: Any] = [
      "mode": "arkit",
      "state": state.rawValue,
      "cameraActive": running,
      "tracking": tracking,
      "guidance": guidance,
      "captureCount": captures.count,
      "targetCount": options.targetImageCount,
      "maxCount": options.maxImageCount,
      "currentSegment": currentSegment,
      "targetLocked": target != nil,
      "targetSource": targetSource,
      "lidar": lidarSupported,
      "elapsedSec": elapsed,
      "capturing": captureInFlight,
    ]
    s["trackingMessage"] = trackingMessage ?? NSNull()
    s["error"] = errorMessage ?? NSNull()
    s["currentElevationDeg"] = currentElevation ?? NSNull()
    s["lastThumbUri"] = lastThumbURI ?? NSNull()
    s["scanId"] = storage?.scanId ?? NSNull()
    for (k, v) in tracker.snapshot() { s[k] = v }
    return s
  }

  private func result() -> [String: Any] {
    guard let storage = storage else { return [:] }
    var r: [String: Any] = [
      "scanId": storage.scanId,
      "scanDir": storage.root.path,
      "metadataPath": storage.metadataURL.path,
      "mode": "arkit",
      "imageCount": captures.count,
      "durationSec": elapsed,
      "lidar": lidarSupported,
      "targetSource": targetSource,
      "missingAngles": tracker.missingAngleWarnings(),
      "images": captures.map { c -> [String: Any] in
        [
          "index": c.index,
          "uri": c.imageURL.absoluteString,
          "thumbUri": c.thumbURL.absoluteString,
          "fileName": c.imageURL.lastPathComponent,
          "relativeAzimuthDeg": c.relativeAzimuth,
          "elevationDeg": c.elevation,
          "manual": c.manual,
          "depthFiles": ARScanSession.depthFiles(c.metadata),
        ]
      },
    ]
    for (k, v) in tracker.snapshot() { r[k] = v }
    return r
  }

  private static func depthFiles(_ meta: [String: Any]) -> [String] {
    guard let d = meta["depth"] as? [String: Any] else { return [] }
    return [d["file"], d["confidenceFile"]].compactMap { $0 as? String }
  }

  private func metadata() -> [String: Any] {
    let device = UIDevice.current
    var m: [String: Any] = [
      "schemaVersion": 1,
      "scanId": storage?.scanId ?? "",
      "createdAt": scanStart?.iso8601 ?? "",
      "finishedAt": scanEnd?.iso8601 ?? "",
      "durationSec": elapsed,
      "captureMode": "arkit",
      "device": ["model": device.model, "systemVersion": device.systemVersion, "lidar": lidarSupported],
      "options": options.dictionary,
      "coordinateSystem": [
        "world": "ARKit world space: right-handed, metres, +Y up (gravity aligned)",
        "transform": "4x4 camera-to-world, column-major (16 floats)",
        "camera": "ARKit camera space: +X right, +Y up, looking along -Z (in the sensor's landscape orientation)",
        "imageOrientation": "Images are stored in sensor orientation (landscape, as captured); intrinsics match the stored pixels",
      ],
      "coverage": [
        "overall": tracker.coverage,
        "bands": Dictionary(uniqueKeysWithValues: zip(tracker.bands.map { $0.name }, tracker.bandCoverage)),
        "ringSegments": tracker.ringSegments,
        "missingAngles": tracker.missingAngleWarnings(),
        "referenceAzimuthDeg": tracker.referenceAzimuth ?? NSNull(),
      ],
      "images": captures.map { $0.metadata },
    ]
    if let t = target {
      m["target"] = ["point": [t.x, t.y, t.z], "source": targetSource]
    } else {
      m["target"] = NSNull()
    }
    return m
  }

  // MARK: - Helpers

  private func angleDeg(_ a: simd_float3, _ b: simd_float3) -> Float {
    return acos(max(-1, min(1, simd_dot(a, b)))) * 180 / .pi
  }

  private static func makeTargetNode() -> SCNNode {
    let node = SCNNode()
    let blue = UIColor(red: 0.16, green: 0.55, blue: 1.0, alpha: 1)
    let dot = SCNSphere(radius: 0.005)
    dot.firstMaterial?.diffuse.contents = blue
    dot.firstMaterial?.lightingModel = .constant
    node.addChildNode(SCNNode(geometry: dot))
    let ring = SCNTorus(ringRadius: 0.04, pipeRadius: 0.0015)
    ring.firstMaterial?.diffuse.contents = blue.withAlphaComponent(0.8)
    ring.firstMaterial?.lightingModel = .constant
    node.addChildNode(SCNNode(geometry: ring))
    return node
  }
}

extension simd_float4 {
  var xyz: simd_float3 { simd_float3(x, y, z) }
}

extension simd_float4x4 {
  var position: simd_float3 { columns.3.xyz }
  var rotation: simd_float3x3 { simd_float3x3(columns.0.xyz, columns.1.xyz, columns.2.xyz) }
  var columnMajorArray: [Float] {
    [columns.0, columns.1, columns.2, columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
  }
}
