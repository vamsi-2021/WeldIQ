// ---------- Native scanner (weld-scanner module) ----------

/** 'demo' = simulated scan for the iOS Simulator (no camera); never real data. */
export type CaptureMode = 'arkit' | 'manual' | 'demo';
export type ScanState = 'idle' | 'scanning' | 'paused' | 'finished';
export type TrackingState = 'normal' | 'limited' | 'notAvailable';

export interface ScannerCapabilities {
  arkitSupported: boolean;
  lidarSupported: boolean;
  highResCaptureSupported: boolean;
  cameraAvailable: boolean;
  mode: CaptureMode;
  cameraAuthorization: 'authorized' | 'denied' | 'restricted' | 'notDetermined' | 'unknown';
}

export interface ScanOptions {
  /** Image count at which the scanner suggests finishing. */
  targetImageCount?: number;
  /** Hard cap on automatic captures. */
  maxImageCount?: number;
  /** Minimum viewing-angle change (degrees) between captures. */
  minAngleDeg?: number;
  minIntervalSec?: number;
  jpegQuality?: number;
  useHighResolutionFrames?: boolean;
  maxImageDimension?: number;
  saveDepth?: boolean;
  fallbackTargetDistance?: number;
}

/** Live status pushed by the native scanner ~5x per second. */
export interface ScanStatus {
  mode: CaptureMode;
  state: ScanState;
  cameraActive: boolean;
  tracking: TrackingState;
  trackingMessage: string | null;
  guidance: string;
  captureCount: number;
  targetCount: number;
  maxCount: number;
  /** Weighted viewing-angle coverage 0..1; null when it can't be measured (manual mode). */
  coverage: number | null;
  bandCoverage: number[];
  bandNames: string[];
  /** Ring segment fill 0..1, index 0 = starting position. */
  segments: number[];
  currentSegment: number;
  currentElevationDeg: number | null;
  targetLocked: boolean;
  targetSource: string;
  lidar: boolean;
  elapsedSec: number;
  capturing: boolean;
  error: string | null;
  lastThumbUri: string | null;
  scanId: string | null;
}

export interface CapturedImage {
  index: number;
  /** file:// URI of the full-resolution JPEG. */
  uri: string;
  /** file:// URI of the small portrait thumbnail. */
  thumbUri: string;
  fileName: string;
  relativeAzimuthDeg?: number;
  elevationDeg?: number;
  manual: boolean;
  /** Paths relative to the scan folder, e.g. "depth/depth_001.bin". */
  depthFiles: string[];
}

export interface ScanResult {
  scanId: string;
  /** Absolute path of the local scan folder. */
  scanDir: string;
  metadataPath: string;
  mode: CaptureMode;
  imageCount: number;
  durationSec: number;
  lidar: boolean;
  targetSource: string;
  coverage: number | null;
  bandCoverage: number[];
  bandNames: string[];
  segments: number[];
  missingAngles: string[];
  images: CapturedImage[];
}

/** A scan packed for upload by WeldScanner.zipScan(). */
export interface ScanZip {
  /** Absolute file path. */
  path: string;
  /** file:// URI, usable as a React Native FormData file. */
  uri: string;
  /** e.g. "scan_001.zip". */
  name: string;
  sizeBytes: number;
}

// ---------- BF Files API (POST /file-records) ----------

/** Record returned after a file is stored. */
export interface FileRecord {
  kind: 'file';
  uuid: string;
  /** User ID of the uploader. */
  owner: string;
  bucket: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
  updated_at: string;
}

// ---------- Reconstructed model (used by ModelViewerScreen) ----------

export interface ModelResponse {
  scan_id: string;
  model_url: string;
  model_path: string;
  format: 'glb';
  model_type: 'textured_mesh' | 'point_cloud';
  size_bytes: number;
}
