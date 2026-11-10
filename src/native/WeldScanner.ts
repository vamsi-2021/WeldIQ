import { useEffect, useState } from 'react';
import { NativeWeldScanner, WeldScannerCameraView } from 'weld-scanner';

import type {
  ScanOptions,
  ScanResult,
  ScanZip,
  ScannerCapabilities,
  ScanStatus,
} from '../types/ScanTypes';

/**
 * Typed wrapper around the native ARKit scanner (modules/weld-scanner).
 * The native side owns the only camera session; <WeldScannerCameraView/>
 * shows its preview and must be mounted before startScan().
 */
export const WeldScanner = {
  getCapabilities(): ScannerCapabilities {
    return NativeWeldScanner.getCapabilities() as ScannerCapabilities;
  },
  async startScan(options: ScanOptions = {}): Promise<{ scanId: string; scanDir: string }> {
    return (await NativeWeldScanner.startScan(options)) as { scanId: string; scanDir: string };
  },
  pauseScan(): void {
    NativeWeldScanner.pauseScan();
  },
  resumeScan(): void {
    NativeWeldScanner.resumeScan();
  },
  captureManual(): Promise<void> {
    return NativeWeldScanner.captureManual();
  },
  async finishScan(): Promise<ScanResult> {
    return (await NativeWeldScanner.finishScan()) as ScanResult;
  },
  resetScan(): void {
    NativeWeldScanner.resetScan();
  },
  discardScan(scanId: string): Promise<void> {
    return NativeWeldScanner.discardScan(scanId);
  },
  /** Packs a finished scan into a .zip (images, depth, metadata.json) ready for BF Files. */
  async zipScan(scanId: string): Promise<ScanZip> {
    return (await NativeWeldScanner.zipScan(scanId)) as ScanZip;
  },
  addStatusListener(listener: (status: ScanStatus) => void): { remove: () => void } {
    return NativeWeldScanner.onScanUpdate(event => listener(event as ScanStatus));
  },
};

export { WeldScannerCameraView };

/** Subscribes to live scanner status for the lifetime of the component. */
export function useScanStatus(): ScanStatus | null {
  const [status, setStatus] = useState<ScanStatus | null>(null);
  useEffect(() => {
    const sub = WeldScanner.addStatusListener(setStatus);
    return () => sub.remove();
  }, []);
  return status;
}
