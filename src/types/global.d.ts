export { };

declare module '*.glb';
declare module '*.png';

import { MeshLineGeometry, MeshLineMaterial } from 'meshline';

declare module '@react-three/fiber' {
  interface ThreeElements {
    meshLineGeometry: React.PropsWithChildren<{ ref?: React.Ref<MeshLineGeometry>; args?: any[] }>;
    meshLineMaterial: React.PropsWithChildren<{
      color?: string;
      depthTest?: boolean;
      resolution?: [number, number];
      useMap?: boolean;
      map?: any;
      repeat?: [number, number];
      lineWidth?: number;
      transparent?: boolean;
      opacity?: number;
    }>;
  }
}