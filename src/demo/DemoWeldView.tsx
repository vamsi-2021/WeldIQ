import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Polygon, Polyline, Rect, Stop } from 'react-native-svg';

import { orbitCamera, projectScene, Vec3 } from './weldScene';

interface Props {
  azimuthDeg: number;
  elevationDeg: number;
  width: number;
  height: number;
  distance?: number;
  /** Small offset (metres) so the view sways like a hand-held camera. */
  shake?: Vec3;
  showTarget?: boolean;
  style?: ViewStyle;
}

/** Renders the demo weld from a given viewpoint (stands in for the camera in demo mode). */
export function DemoWeldView({ azimuthDeg, elevationDeg, width, height, distance, shake, showTarget, style }: Props) {
  const scene = useMemo(() => {
    const eye = orbitCamera(azimuthDeg, elevationDeg, distance);
    if (shake) {
      eye[0] += shake[0];
      eye[1] += shake[1];
      eye[2] += shake[2];
    }
    return projectScene(eye, width, height, { showTarget });
  }, [azimuthDeg, elevationDeg, width, height, distance, shake, showTarget]);

  return (
    <View style={[{ width, height }, styles.clip, style]}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#1b2027" />
            <Stop offset="1" stopColor="#2c2a27" />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="url(#bg)" />
        {scene.grid.map((pts, i) => (
          <Polyline key={`g${i}`} points={pts} stroke="rgba(255,255,255,0.07)" strokeWidth={1} fill="none" />
        ))}
        {scene.shapes.map((s, i) => {
          if (s.kind === 'poly') {
            return <Polygon key={i} points={s.points} fill={s.fill} stroke={s.stroke} strokeWidth={0.5} />;
          }
          if (s.kind === 'bead') {
            return (
              <Polyline key={i} points={s.points} stroke={s.stroke} strokeWidth={s.width} strokeLinecap="round" fill="none" />
            );
          }
          const [cx, cy] = s.points.split(',').map(Number);
          return <Circle key={i} cx={cx} cy={cy} r={s.width} fill={s.fill} />;
        })}
        {scene.targetRing ? (
          <Polyline points={scene.targetRing} stroke="#2E8BFF" strokeWidth={2} fill="none" opacity={0.9} />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
