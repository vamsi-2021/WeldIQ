import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * TurboModule spec for the native ARKit scanner.
 * Payload shapes are typed in src/types/ScanTypes.ts on the app side;
 * they cross the bridge as plain objects.
 */
export interface Spec extends TurboModule {
  /** { arkitSupported, lidarSupported, highResCaptureSupported, cameraAvailable, mode } */
  getCapabilities(): CodegenTypes.UnsafeObject;
  /** Begin automatic capture. Preview must be mounted. Options: ScanOptions. */
  startScan(options: CodegenTypes.UnsafeObject): Promise<CodegenTypes.UnsafeObject>;
  pauseScan(): void;
  resumeScan(): void;
  /** Capture the current frame regardless of viewpoint novelty. */
  captureManual(): Promise<void>;
  /** Stop capturing, flush pending writes, write metadata.json. Resolves ScanResult. */
  finishScan(): Promise<CodegenTypes.UnsafeObject>;
  /** Drop the in-progress scan (if any) and return to idle. */
  resetScan(): void;
  /** Delete a scan folder from disk. */
  discardScan(scanId: string): Promise<void>;
  /** Zip a finished scan for upload. Resolves { path, uri, name, sizeBytes }. */
  zipScan(scanId: string): Promise<CodegenTypes.UnsafeObject>;
  readonly onScanUpdate: CodegenTypes.EventEmitter<CodegenTypes.UnsafeObject>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('WeldScanner');
