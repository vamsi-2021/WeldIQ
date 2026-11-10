import type { ViewProps } from 'react-native';
import { codegenNativeComponent } from 'react-native';

/**
 * Full-screen rear-camera preview backed by the scanner's single ARSession
 * (or the AVCapture fallback on devices without ARKit). Mounting it starts
 * the camera; unmounting releases it.
 */
export interface NativeProps extends ViewProps {}

export default codegenNativeComponent<NativeProps>('WeldScannerCameraView');
