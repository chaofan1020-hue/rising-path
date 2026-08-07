export { };

declare module '*.glb';
declare module '*.png';

import { MeshLineGeometry, MeshLineMaterial } from 'meshline';
import type { Texture } from 'three';

declare module '@react-three/fiber' {
  interface ThreeElements {
    meshLineGeometry: React.PropsWithChildren<{ ref?: React.Ref<MeshLineGeometry>; args?: unknown[] }>;
    meshLineMaterial: React.PropsWithChildren<{
      color?: string;
      depthTest?: boolean;
      resolution?: [number, number];
      useMap?: boolean;
      map?: Texture;
      repeat?: [number, number];
      lineWidth?: number;
      transparent?: boolean;
      opacity?: number;
    }>;
  }
}
