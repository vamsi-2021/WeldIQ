import Foundation

/// Local on-device layout for one scan:
///
///   Documents/WeldScans/scan_001/
///     images/image_001.jpg      full-resolution frames (sensor orientation, landscape)
///     thumbs/image_001.jpg      small portrait thumbnails for the review screen (not uploaded)
///     depth/depth_001.bin       optional LiDAR depth (Float32 metres, row-major)
///     depth/confidence_001.bin  optional LiDAR confidence (UInt8 0..2)
///     metadata.json
final class ScanStorage {
  let scanId: String
  let root: URL
  let imagesDir: URL
  let thumbsDir: URL
  let depthDir: URL

  static var baseDirectory: URL {
    let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return docs.appendingPathComponent("WeldScans", isDirectory: true)
  }

  /// Creates the next free scan_NNN folder.
  static func createNext() throws -> ScanStorage {
    let fm = FileManager.default
    try fm.createDirectory(at: baseDirectory, withIntermediateDirectories: true)
    let existing = (try? fm.contentsOfDirectory(atPath: baseDirectory.path)) ?? []
    let maxIndex = existing
      .compactMap { name -> Int? in
        guard name.hasPrefix("scan_") else { return nil }
        return Int(name.dropFirst(5))
      }
      .max() ?? 0
    let id = String(format: "scan_%03d", maxIndex + 1)
    return try ScanStorage(scanId: id)
  }

  init(scanId: String) throws {
    self.scanId = scanId
    root = ScanStorage.baseDirectory.appendingPathComponent(scanId, isDirectory: true)
    imagesDir = root.appendingPathComponent("images", isDirectory: true)
    thumbsDir = root.appendingPathComponent("thumbs", isDirectory: true)
    depthDir = root.appendingPathComponent("depth", isDirectory: true)
    let fm = FileManager.default
    for dir in [imagesDir, thumbsDir, depthDir] {
      try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    }
  }

  static func imageName(_ index: Int) -> String { String(format: "image_%03d.jpg", index) }

  func imageURL(_ index: Int) -> URL { imagesDir.appendingPathComponent(ScanStorage.imageName(index)) }
  func thumbURL(_ index: Int) -> URL { thumbsDir.appendingPathComponent(ScanStorage.imageName(index)) }
  func depthURL(_ index: Int) -> URL { depthDir.appendingPathComponent(String(format: "depth_%03d.bin", index)) }
  func confidenceURL(_ index: Int) -> URL { depthDir.appendingPathComponent(String(format: "confidence_%03d.bin", index)) }
  var metadataURL: URL { root.appendingPathComponent("metadata.json") }

  func writeMetadata(_ dict: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: metadataURL, options: .atomic)
  }

  func deleteAll() {
    try? FileManager.default.removeItem(at: root)
  }

  static func delete(scanId: String) throws {
    let url = try folder(scanId: scanId)
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
    try? FileManager.default.removeItem(at: zipURL(scanId: scanId))
  }

  /// Only allow plain scan folder names, never paths.
  private static func folder(scanId: String) throws -> URL {
    guard scanId.range(of: "^scan_[0-9]+$", options: .regularExpression) != nil else {
      throw NSError(domain: "WeldScanner", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid scan id"])
    }
    return baseDirectory.appendingPathComponent(scanId, isDirectory: true)
  }

  /// Zips live in Caches so iOS may purge them; they can always be rebuilt from the scan folder.
  private static func zipURL(scanId: String) -> URL {
    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    return caches.appendingPathComponent("WeldScanZips/\(scanId).zip")
  }

  /// Packs images/, depth/ and metadata.json (not thumbs/) into Caches/WeldScanZips/scan_NNN.zip.
  /// The files sit at the root of the archive (metadata.json, images/…, depth/…), with no wrapping
  /// folder, because the backend looks for metadata.json at the top level. Returns the zip's URL.
  static func zip(scanId: String) throws -> URL {
    let fm = FileManager.default
    let source = try folder(scanId: scanId)
    guard fm.fileExists(atPath: source.appendingPathComponent("metadata.json").path) else {
      throw NSError(domain: "WeldScanner", code: 3, userInfo: [NSLocalizedDescriptionKey: "Scan \(scanId) is not finished"])
    }

    // Archive paths relative to the scan folder, in a stable order.
    var entries: [(path: String, url: URL)] = [("metadata.json", source.appendingPathComponent("metadata.json"))]
    for dir in ["images", "depth"] {
      let dirURL = source.appendingPathComponent(dir, isDirectory: true)
      guard let names = try? fm.contentsOfDirectory(atPath: dirURL.path) else { continue }
      for name in names.sorted() where !name.hasPrefix(".") {
        entries.append(("\(dir)/\(name)", dirURL.appendingPathComponent(name)))
      }
    }

    let dest = zipURL(scanId: scanId)
    try fm.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
    let partial = dest.appendingPathExtension("partial")
    try? fm.removeItem(at: partial)
    do {
      try ZipWriter.write(entries: entries, to: partial)
      try? fm.removeItem(at: dest)
      try fm.moveItem(at: partial, to: dest)
    } catch {
      try? fm.removeItem(at: partial)
      throw error
    }
    return dest
  }
}

/// Minimal ZIP writer: "stored" entries (no compression — the images are already JPEG),
/// no ZIP64, so each file and the whole archive must stay under 4 GB.
enum ZipWriter {
  static func write(entries: [(path: String, url: URL)], to dest: URL) throws {
    FileManager.default.createFile(atPath: dest.path, contents: nil)
    let out = try FileHandle(forWritingTo: dest)
    defer { try? out.close() }

    var central = Data()
    var offset: UInt32 = 0
    let (dosTime, dosDate) = dosDateTime(Date())

    for entry in entries {
      let data = try Data(contentsOf: entry.url, options: .mappedIfSafe)
      guard data.count < Int(UInt32.max) else {
        throw NSError(domain: "WeldScanner", code: 4, userInfo: [NSLocalizedDescriptionKey: "\(entry.path) is too large to zip"])
      }
      let name = Data(entry.path.utf8)
      let crc = crc32(data)
      let size = UInt32(data.count)

      var local = Data()
      local.append(le32: 0x0403_4b50)
      local.append(le16: 20)       // version needed
      local.append(le16: 0x0800)   // UTF-8 names
      local.append(le16: 0)        // stored
      local.append(le16: dosTime)
      local.append(le16: dosDate)
      local.append(le32: crc)
      local.append(le32: size)
      local.append(le32: size)
      local.append(le16: UInt16(name.count))
      local.append(le16: 0)
      local.append(name)
      try out.write(contentsOf: local)
      try out.write(contentsOf: data)

      central.append(le32: 0x0201_4b50)
      central.append(le16: 0x031E) // made by: Unix, spec 3.0
      central.append(le16: 20)
      central.append(le16: 0x0800)
      central.append(le16: 0)
      central.append(le16: dosTime)
      central.append(le16: dosDate)
      central.append(le32: crc)
      central.append(le32: size)
      central.append(le32: size)
      central.append(le16: UInt16(name.count))
      central.append(le16: 0)      // extra
      central.append(le16: 0)      // comment
      central.append(le16: 0)      // disk
      central.append(le16: 0)      // internal attrs
      central.append(le32: 0o100644 << 16) // external attrs: regular file, rw-r--r--
      central.append(le32: offset)
      central.append(name)

      let next = UInt64(offset) + UInt64(local.count) + UInt64(data.count)
      guard next < UInt64(UInt32.max) else {
        throw NSError(domain: "WeldScanner", code: 4, userInfo: [NSLocalizedDescriptionKey: "Scan is too large to zip"])
      }
      offset = UInt32(next)
    }

    var end = Data()
    end.append(le32: 0x0605_4b50)
    end.append(le16: 0)
    end.append(le16: 0)
    end.append(le16: UInt16(entries.count))
    end.append(le16: UInt16(entries.count))
    end.append(le32: UInt32(central.count))
    end.append(le32: offset)
    end.append(le16: 0)
    try out.write(contentsOf: central)
    try out.write(contentsOf: end)
  }

  private static let crcTable: [UInt32] = (0..<256).map { i -> UInt32 in
    var c = UInt32(i)
    for _ in 0..<8 { c = (c & 1) != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
    return c
  }

  private static func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xFFFF_FFFF
    data.withUnsafeBytes { (buf: UnsafeRawBufferPointer) in
      for byte in buf {
        crc = crcTable[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8)
      }
    }
    return crc ^ 0xFFFF_FFFF
  }

  private static func dosDateTime(_ date: Date) -> (UInt16, UInt16) {
    let c = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
    let time = UInt16((c.hour ?? 0) << 11 | (c.minute ?? 0) << 5 | (c.second ?? 0) / 2)
    let day = UInt16(max(0, (c.year ?? 1980) - 1980) << 9 | (c.month ?? 1) << 5 | (c.day ?? 1))
    return (time, day)
  }
}

private extension Data {
  mutating func append(le16 v: UInt16) { Swift.withUnsafeBytes(of: v.littleEndian) { append(contentsOf: $0) } }
  mutating func append(le32 v: UInt32) { Swift.withUnsafeBytes(of: v.littleEndian) { append(contentsOf: $0) } }
}
