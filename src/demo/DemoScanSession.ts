import type { ScannerController } from '../native/ScannerController';
import type { CapturedImage, ScanOptions, ScanResult, ScanState, ScanStatus } from '../types/ScanTypes';

/**
 * Simulated scan for the iOS Simulator, which has no camera or ARKit.
 *
 * A virtual user orbits the demo weld (low lap, mid lap, then a few top-down
 * views). Captures, coverage bins and guidance use the same rules as the native
 * scanner (8° novelty, 0.4 s interval, blur speed limit, 3 elevation bands), so
 * the screens behave as they would on a device. No images are produced.
 */

const BANDS = [
  { name: 'low', min: -30, max: 30, bins: 24, weight: 0.45 },
  { name: 'mid', min: 30, max: 60, bins: 24, weight: 0.4 },
  { name: 'top', min: 60, max: 91, bins: 8, weight: 0.15 },
];
const RING = 24;
const TICK_MS = 100;

interface DemoCapture {
  index: number;
  az: number;
  el: number;
  manual: boolean;
}

const rad = (d: number) => (d * Math.PI) / 180;
const dir = (az: number, el: number) => [Math.cos(rad(el)) * Math.sin(rad(az)), Math.sin(rad(el)), Math.cos(rad(el)) * Math.cos(rad(az))];
const angleBetween = (a: number[], b: number[]) =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
const wrap = (a: number) => ((a % 360) + 360) % 360;

/** Where the virtual user is `t` seconds into the scan: azimuth, elevation, moving too fast? */
function pathAt(t: number): { az: number; el: number; fast: boolean; phase: string } {
  if (t < 26) {
    // Lap 1 at weld height, with a moment of moving too fast.
    const fast = t > 9 && t < 10.6;
    const az = (t / 26) * 360 + (fast ? 6 : 0);
    return { az, el: 14 + 4 * Math.sin(t * 0.9), fast, phase: 'low' };
  }
  if (t < 29) {
    return { az: 360 + 4 * Math.sin(t), el: 14 + ((t - 26) / 3) * 31, fast: false, phase: 'raise' };
  }
  if (t < 47) {
    return { az: 360 + ((t - 29) / 18) * 360, el: 45 + 3 * Math.sin(t * 0.7), fast: false, phase: 'mid' };
  }
  if (t < 50) {
    return { az: 720, el: 45 + ((t - 47) / 3) * 27, fast: false, phase: 'raise' };
  }
  if (t < 58) {
    return { az: 720 + ((t - 50) / 8) * 300, el: 72, fast: false, phase: 'top' };
  }
  return { az: 1020 + 3 * Math.sin(t), el: 70, fast: false, phase: 'done' };
}

export class DemoScanSession implements ScannerController {
  private listeners = new Set<(s: ScanStatus) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private wall = 0;
  private t = 0;
  private state: ScanState = 'idle';
  private az = 0;
  private el = 14;
  private fast = false;
  private phase = 'idle';
  private captures: DemoCapture[] = [];
  private counts = BANDS.map(b => new Array<number>(b.bins).fill(0));
  private lastCaptureT = -10;
  private capturingUntil = 0;
  private options = { targetImageCount: 60, maxImageCount: 100, minAngleDeg: 8, minIntervalSec: 0.4 };

  addStatusListener(listener: (status: ScanStatus) => void) {
    this.listeners.add(listener);
    if (!this.timer) {
      this.timer = setInterval(() => this.tick(TICK_MS / 1000), TICK_MS);
    }
    listener(this.status());
    return {
      remove: () => {
        this.listeners.delete(listener);
        if (this.listeners.size === 0 && this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
      },
    };
  }

  /** Pose of the most recent capture, for the overlay thumbnail. */
  get lastCapture(): { az: number; el: number } | null {
    const c = this.captures[this.captures.length - 1];
    return c ? { az: wrap(c.az), el: c.el } : null;
  }

  /** Current virtual camera pose, for the demo camera view. */
  get pose() {
    return { azimuthDeg: wrap(this.az), elevationDeg: this.el, wall: this.wall };
  }

  async startScan(options?: ScanOptions) {
    if (this.state === 'scanning' || this.state === 'paused') {
      throw new Error('A scan is already in progress.');
    }
    this.clear();
    this.options = {
      targetImageCount: options?.targetImageCount ?? 60,
      maxImageCount: options?.maxImageCount ?? 100,
      minAngleDeg: options?.minAngleDeg ?? 8,
      minIntervalSec: options?.minIntervalSec ?? 0.4,
    };
    this.state = 'scanning';
    this.emit();
    return { scanId: 'demo_scan', scanDir: '' };
  }

  pauseScan() {
    if (this.state === 'scanning') {
      this.state = 'paused';
      this.emit();
    }
  }

  resumeScan() {
    if (this.state === 'paused') {
      this.state = 'scanning';
      this.emit();
    }
  }

  async captureManual() {
    if (this.state !== 'scanning' && this.state !== 'paused') {
      throw new Error('No scan is in progress.');
    }
    this.capture(true);
    this.emit();
  }

  async finishScan(): Promise<ScanResult> {
    if (this.state !== 'scanning' && this.state !== 'paused') {
      throw new Error('No scan is in progress.');
    }
    this.state = 'finished';
    this.emit();
    const images: CapturedImage[] = this.captures.map(c => ({
      index: c.index,
      uri: '',
      thumbUri: '',
      fileName: `image_${String(c.index).padStart(3, '0')}.jpg`,
      relativeAzimuthDeg: wrap(c.az),
      elevationDeg: c.el,
      manual: c.manual,
      depthFiles: [],
    }));
    return {
      scanId: 'demo_scan',
      scanDir: '',
      metadataPath: '',
      mode: 'demo',
      imageCount: images.length,
      durationSec: this.t,
      lidar: false,
      targetSource: 'demo',
      coverage: this.coverage(),
      bandCoverage: this.bandCoverage(),
      bandNames: BANDS.map(b => b.name),
      segments: this.segments(),
      missingAngles: this.missingAngles(),
      images,
    };
  }

  resetScan() {
    this.clear();
    this.state = 'idle';
    this.emit();
  }

  // ---- simulation

  private clear() {
    this.t = 0;
    this.captures = [];
    this.counts = BANDS.map(b => new Array<number>(b.bins).fill(0));
    this.lastCaptureT = -10;
    this.az = 0;
    this.el = 14;
  }

  private tick(dt: number) {
    this.wall += dt;
    if (this.state === 'scanning') {
      this.t += dt;
      const p = pathAt(this.t);
      this.az = p.az;
      this.el = p.el;
      this.fast = p.fast;
      this.phase = p.phase;
      this.maybeCapture();
    } else if (this.state === 'idle') {
      // Hand-held sway while aiming.
      this.az = 4 * Math.sin(this.wall * 0.6);
      this.el = 14 + 2 * Math.sin(this.wall * 0.8);
      this.fast = false;
    }
    this.emit();
  }

  private maybeCapture() {
    if (this.fast || this.captures.length >= this.options.maxImageCount) {
      return;
    }
    if (this.t - this.lastCaptureT < this.options.minIntervalSec) {
      return;
    }
    const d = dir(this.az, this.el);
    const novel = this.captures.every(c => angleBetween(dir(c.az, c.el), d) >= this.options.minAngleDeg);
    if (novel) {
      this.capture(false);
    }
  }

  private capture(manual: boolean) {
    const index = this.captures.length + 1;
    this.captures.push({ index, az: this.az, el: this.el, manual });
    this.lastCaptureT = this.t;
    this.capturingUntil = this.wall + 0.25;
    const cell = this.cell(this.az, this.el);
    if (cell) {
      this.counts[cell.band][cell.bin] += 1;
    }
  }

  private cell(az: number, el: number) {
    const band = BANDS.findIndex(b => el >= b.min && el < b.max);
    if (band < 0) {
      return null;
    }
    const n = BANDS[band].bins;
    return { band, bin: Math.min(n - 1, Math.floor(wrap(az) / (360 / n))) };
  }

  private bandCoverage() {
    return this.counts.map(row => row.filter(c => c > 0).length / row.length);
  }

  private coverage() {
    const bc = this.bandCoverage();
    return Math.min(1, BANDS.reduce((sum, b, i) => sum + b.weight * bc[i], 0));
  }

  private segments() {
    return Array.from({ length: RING }, (_, s) => {
      const mid = ((s + 0.5) * 360) / RING;
      let covered = 0;
      for (const b of [0, 1]) {
        const bins = BANDS[b].bins;
        if (this.counts[b][Math.min(bins - 1, Math.floor(mid / (360 / bins)))] > 0) {
          covered += 1;
        }
      }
      return covered / 2;
    });
  }

  private missingAngles() {
    const warnings: string[] = [];
    const step = 360 / BANDS[0].bins;
    let start = -1;
    for (let i = 0; i <= BANDS[0].bins; i++) {
      const empty = i < BANDS[0].bins && this.counts[0][i] === 0 && this.counts[1][i] === 0;
      if (empty && start < 0) {
        start = i;
      } else if (!empty && start >= 0) {
        warnings.push(`No views between ${start * step}° and ${i * step}° around the weld (measured from your starting position).`);
        start = -1;
      }
    }
    const bc = this.bandCoverage();
    if (bc[0] < 0.5) {
      warnings.push(`Few low-angle views (${Math.round(bc[0] * 100)}% of the side ring). Lower the device and orbit again.`);
    }
    if (bc[1] < 0.5) {
      warnings.push(`Few mid-height views (${Math.round(bc[1] * 100)}% of the 45° ring). Hold the device higher and orbit again.`);
    }
    if (bc[2] < 0.25) {
      warnings.push('Few top-down views. Capture some images from above the weld.');
    }
    return warnings;
  }

  private guidance(): string {
    if (this.state === 'idle') {
      return this.wall < 1.5
        ? 'Move the device slowly so tracking can start'
        : 'Center the weld in the guide, then tap Start Scan';
    }
    if (this.state === 'paused') {
      return 'Scan paused';
    }
    if (this.state === 'finished') {
      return 'Scan finished';
    }
    if (this.fast) {
      return 'Slow down — moving too fast for sharp images';
    }
    if (this.captures.length >= this.options.maxImageCount) {
      return `Maximum of ${this.options.maxImageCount} images reached — tap Finish`;
    }
    if (this.coverage() >= 0.85 && this.captures.length >= this.options.targetImageCount) {
      return 'Target reached — tap Finish, or keep filling gaps';
    }
    switch (this.phase) {
      case 'raise':
        return 'This height is covered — raise the device and look down at the weld';
      case 'top':
        return 'Capture a few views from above the weld';
      case 'done':
        return 'Full coverage reached — tap Finish';
      default:
        return this.t - this.lastCaptureT < 0.3 ? 'New angle — hold steady' : 'Move right around the weld';
    }
  }

  private status(): ScanStatus {
    const tracking = this.wall < 1.5 ? 'limited' : 'normal';
    const scanning = this.state !== 'idle';
    return {
      mode: 'demo',
      state: this.state,
      cameraActive: true,
      tracking,
      trackingMessage: tracking === 'limited' ? 'Initializing — move the device slowly side to side' : null,
      guidance: this.guidance(),
      captureCount: this.captures.length,
      targetCount: this.options.targetImageCount,
      maxCount: this.options.maxImageCount,
      coverage: scanning ? this.coverage() : 0,
      bandCoverage: this.bandCoverage(),
      bandNames: BANDS.map(b => b.name),
      segments: this.segments(),
      currentSegment: scanning ? Math.min(RING - 1, Math.floor(wrap(this.az) / (360 / RING))) : -1,
      currentElevationDeg: this.el,
      targetLocked: scanning,
      targetSource: 'demo',
      lidar: false,
      elapsedSec: this.t,
      capturing: this.wall < this.capturingUntil,
      error: null,
      lastThumbUri: null,
      scanId: scanning ? 'demo_scan' : null,
    };
  }

  private emit() {
    const s = this.status();
    this.listeners.forEach(l => l(s));
  }
}
