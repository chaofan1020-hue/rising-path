'use client';

import { Warp } from '@paper-design/shaders-react';

export interface FeatureWarpConfig {
  proportion: number;
  softness: number;
  distortion: number;
  swirl: number;
  swirlIterations: number;
  shape: 'checks' | 'stripes';
  shapeScale: number;
  colors: string[];
}

export function FeatureCardWarp({ config }: { config: FeatureWarpConfig }) {
  return <Warp
    style={{ height: '100%', width: '100%' }}
    proportion={config.proportion}
    softness={config.softness}
    distortion={config.distortion}
    swirl={config.swirl}
    swirlIterations={config.swirlIterations}
    shape={config.shape}
    shapeScale={config.shapeScale}
    colors={config.colors}
  />;
}
