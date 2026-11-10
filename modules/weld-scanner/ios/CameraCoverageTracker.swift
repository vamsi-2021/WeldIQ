import Foundation
import simd

/// Tracks which viewing directions around the weld have been captured.
///
/// The space around the target point is split into a "viewing sphere":
/// - azimuth (walking around the weld, measured on the gravity-aligned ground plane)
/// - elevation bands (low, mid, top-down views)
///
/// Coverage is the weighted share of cells that contain at least one captured
/// image. It measures *viewing-angle* coverage, not image count, and it says
/// nothing about whether reconstruction will succeed.
struct CameraCoverageTracker {
  struct Band {
    let name: String
    let minElevation: Float  // degrees, inclusive
    let maxElevation: Float  // degrees, exclusive
    let azimuthBins: Int
    let weight: Float
  }

  /// Number of segments shown on the progress ring (azimuth only).
  static let ringSegments = 24

  let bands: [Band] = [
    Band(name: "low", minElevation: -30, maxElevation: 30, azimuthBins: 24, weight: 0.45),
    Band(name: "mid", minElevation: 30, maxElevation: 60, azimuthBins: 24, weight: 0.40),
    Band(name: "top", minElevation: 60, maxElevation: 91, azimuthBins: 8, weight: 0.15),
  ]

  /// Azimuth of the first capture. The ring is drawn relative to this so the
  /// user's starting position is at the bottom of the ring.
  private(set) var referenceAzimuth: Float?
  /// counts[band][bin]
  private(set) var counts: [[Int]]

  init() {
    counts = []
    counts = bands.map { Array(repeating: 0, count: $0.azimuthBins) }
  }

  mutating func reset() {
    referenceAzimuth = nil
    counts = bands.map { Array(repeating: 0, count: $0.azimuthBins) }
  }

  // MARK: - Geometry helpers

  /// Azimuth in degrees [0, 360) of a unit direction (target -> camera), y-up world.
  static func azimuth(of dir: simd_float3) -> Float {
    var a = atan2(dir.x, dir.z) * 180 / .pi
    if a < 0 { a += 360 }
    return a
  }

  /// Elevation in degrees [-90, 90] of a unit direction (target -> camera).
  static func elevation(of dir: simd_float3) -> Float {
    return asin(max(-1, min(1, dir.y))) * 180 / .pi
  }

  /// Azimuth relative to the first capture, [0, 360).
  func relativeAzimuth(_ absolute: Float) -> Float {
    guard let ref = referenceAzimuth else { return 0 }
    var a = absolute - ref
    while a < 0 { a += 360 }
    while a >= 360 { a -= 360 }
    return a
  }

  func bandIndex(forElevation e: Float) -> Int? {
    return bands.firstIndex { e >= $0.minElevation && e < $0.maxElevation }
  }

  func cell(for dir: simd_float3) -> (band: Int, bin: Int)? {
    let e = CameraCoverageTracker.elevation(of: dir)
    guard let b = bandIndex(forElevation: e) else { return nil }
    let rel = relativeAzimuth(CameraCoverageTracker.azimuth(of: dir))
    let n = bands[b].azimuthBins
    let bin = min(n - 1, Int(rel / (360 / Float(n))))
    return (b, bin)
  }

  // MARK: - Recording

  mutating func record(direction dir: simd_float3) {
    if referenceAzimuth == nil {
      referenceAzimuth = CameraCoverageTracker.azimuth(of: dir)
    }
    if let c = cell(for: dir) {
      counts[c.band][c.bin] += 1
    }
  }

  func isCovered(_ dir: simd_float3) -> Bool {
    guard referenceAzimuth != nil, let c = cell(for: dir) else { return false }
    return counts[c.band][c.bin] > 0
  }

  // MARK: - Metrics

  /// Fraction of cells covered per band.
  var bandCoverage: [Float] {
    return counts.map { row in Float(row.filter { $0 > 0 }.count) / Float(row.count) }
  }

  /// Weighted overall viewing-angle coverage in [0, 1].
  var coverage: Float {
    let bc = bandCoverage
    var total: Float = 0
    for (i, band) in bands.enumerated() { total += band.weight * bc[i] }
    return min(1, total)
  }

  /// Per-ring-segment fill in [0, 1]: share of bands covering that azimuth segment
  /// (low and mid bands only; top-down views are shown separately).
  var ringSegments: [Float] {
    let n = CameraCoverageTracker.ringSegments
    return (0..<n).map { seg in
      let mid = (Float(seg) + 0.5) * 360 / Float(n)
      var covered: Float = 0
      for b in 0..<2 {
        let bins = bands[b].azimuthBins
        let bin = min(bins - 1, Int(mid / (360 / Float(bins))))
        if counts[b][bin] > 0 { covered += 1 }
      }
      return covered / 2
    }
  }

  func ringSegment(forAbsoluteAzimuth a: Float) -> Int {
    guard referenceAzimuth != nil else { return -1 }
    let n = CameraCoverageTracker.ringSegments
    return min(n - 1, Int(relativeAzimuth(a) / (360 / Float(n))))
  }

  /// Human readable gaps, e.g. "No views between 90°–150° (relative to start)".
  func missingAngleWarnings() -> [String] {
    guard referenceAzimuth != nil else { return ["No images were captured with tracking."] }
    var warnings: [String] = []

    // Azimuth gaps where neither the low nor mid band has any view.
    let bins = bands[0].azimuthBins
    let step = 360 / Float(bins)
    var uncovered = (0..<bins).map { counts[0][$0] == 0 && counts[1][$0] == 0 }
    if uncovered.allSatisfy({ $0 }) { uncovered = [] }
    var ranges: [(Int, Int)] = []
    var i = 0
    while i < uncovered.count {
      if uncovered[i] {
        let start = i
        while i < uncovered.count && uncovered[i] { i += 1 }
        ranges.append((start, i))
      } else {
        i += 1
      }
    }
    // Merge a gap that wraps past 360°.
    if ranges.count > 1, ranges.first!.0 == 0, ranges.last!.1 == bins {
      let first = ranges.removeFirst()
      let last = ranges.removeLast()
      ranges.append((last.0, first.1 + bins))
    }
    for (s, e) in ranges {
      let from = Int(Float(s) * step) % 360
      let to = Int(Float(e) * step) % 360
      warnings.append("No views between \(from)° and \(to == 0 ? 360 : to)° around the weld (measured from your starting position).")
    }

    let bc = bandCoverage
    if bc[0] < 0.5 { warnings.append("Few low-angle views (\(Int(bc[0] * 100))% of the side ring). Lower the device and orbit again.") }
    if bc[1] < 0.5 { warnings.append("Few mid-height views (\(Int(bc[1] * 100))% of the 45° ring). Hold the device higher and orbit again.") }
    if bc[2] < 0.25 { warnings.append("Few top-down views. Capture some images from above the weld.") }
    return warnings
  }

  /// Suggests where to move next, given the current camera direction from the target
  /// and the camera's right/up vectors in world space.
  func guidance(currentDir: simd_float3, cameraRight: simd_float3, cameraUp: simd_float3) -> String {
    guard referenceAzimuth != nil else { return "Hold steady — capturing the first view" }
    if coverage >= 0.999 { return "Full coverage reached — tap Finish" }

    let elev = CameraCoverageTracker.elevation(of: currentDir)
    let az = CameraCoverageTracker.azimuth(of: currentDir)
    let bandIdx = bandIndex(forElevation: elev) ?? 0

    // Current band complete? Suggest changing height.
    if bandCoverage[bandIdx] >= 0.999 {
      if let nextBand = bandCoverage.firstIndex(where: { $0 < 0.999 }) {
        return nextBand > bandIdx
          ? "This height is covered — raise the device and look down at the weld"
          : "This height is covered — lower the device and orbit again"
      }
    }

    if !isCovered(currentDir) { return "New angle — hold steady" }

    // Find the nearest uncovered bin in this band and which way that is.
    let n = bands[bandIdx].azimuthBins
    let step = 360 / Float(n)
    let rel = relativeAzimuth(az)
    var best: (delta: Float, found: Bool) = (0, false)
    for k in 1...n {
      for sign in [Float(1), Float(-1)] {
        let candidate = rel + sign * Float(k) * step
        var wrapped = candidate.truncatingRemainder(dividingBy: 360)
        if wrapped < 0 { wrapped += 360 }
        let bin = min(n - 1, Int(wrapped / step))
        if counts[bandIdx][bin] == 0 {
          best = (sign * Float(k) * step, true)
          break
        }
      }
      if best.found { break }
    }
    guard best.found else { return "Move slowly around the weld" }

    // Where would the camera be at that azimuth? Compare with the camera's right vector.
    let targetAz = (az + best.delta) * .pi / 180
    let horiz = simd_length(simd_float2(currentDir.x, currentDir.z))
    let desired = simd_float3(sin(targetAz) * horiz, currentDir.y, cos(targetAz) * horiz)
    let side = simd_dot(desired - currentDir, cameraRight)
    return side >= 0 ? "Move right around the weld" : "Move left around the weld"
  }

  func snapshot() -> [String: Any] {
    return [
      "coverage": coverage,
      "bandCoverage": bandCoverage,
      "bandNames": bands.map { $0.name },
      "segments": ringSegments,
    ]
  }
}
