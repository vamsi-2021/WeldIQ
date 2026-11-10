import type { ScanOptions, ScanResult, ScanStatus } from '../types/ScanTypes';

/** Common surface of the native ARKit scanner and the simulated demo scanner. */
export interface ScannerController {
  startScan(options?: ScanOptions): Promise<unknown>;
  pauseScan(): void;
  resumeScan(): void;
  captureManual(): Promise<void>;
  finishScan(): Promise<ScanResult>;
  resetScan(): void;
  addStatusListener(listener: (status: ScanStatus) => void): { remove: () => void };
}
