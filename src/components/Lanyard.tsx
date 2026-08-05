'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Environment, ContactShadows } from '@react-three/drei';

interface LanyardProps {
  cardStartY?: number;
  onError?: (err: Error) => void;
}

function createCardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;

  // White background with rounded corners
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 320, 20);
  ctx.fill();

  // Logo - two rectangular bars
  ctx.fillStyle = '#C46A4A';
  ctx.beginPath();
  ctx.roundRect(80, 60, 160, 28, 6);
  ctx.fill();
  ctx.fillStyle = '#B5BEB0';
  ctx.beginPath();
  ctx.roundRect(80, 100, 120, 28, 6);
  ctx.fill();

  // Brand name
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Rising Path', 256, 185);

  // Subtitle
  ctx.fillStyle = '#666666';
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText('求职加速器', 256, 235);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export default function Lanyard({ cardStartY = 5, onError }: LanyardProps) {
  const cardGroupRef = useRef<THREE.Group>(null);
  const ropeRef = useRef<THREE.Mesh>(null);
  const cardY = useRef(cardStartY);
  const velocity = useRef(0);
  const [settled, setSettled] = useState(false);
  const texture = useMemo(() => createCardTexture(), []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.032);

    // Spring-damper to center (y=0.5)
    const targetY = 0.5;
    const springK = 6;
    const dampingK = 3.5;
    const displacement = cardY.current - targetY;
    const force = -springK * displacement - dampingK * velocity.current;

    velocity.current += force * dt;
    cardY.current += velocity.current * dt;

    // Settled check
    if (Math.abs(displacement) < 0.008 && Math.abs(velocity.current) < 0.005) {
      cardY.current = targetY;
      velocity.current = 0;
      if (!settled) setSettled(true);
    }

    // Update card group position
    if (cardGroupRef.current) {
      cardGroupRef.current.position.y = cardY.current;
    }

    // Update rope geometry
    if (ropeRef.current) {
      try {
        const fixedPt = new THREE.Vector3(0, 6, 0);
        const cardTop = new THREE.Vector3(0, cardY.current + 0.75, 0);

        const midY = (fixedPt.y + cardTop.y) / 2;
        const h = Math.abs(fixedPt.y - cardTop.y);
        const sag = h * 0.15 + 0.2;

        const curve = new THREE.CatmullRomCurve3([
          fixedPt,
          new THREE.Vector3(0.05, midY + sag, 0.05),
          new THREE.Vector3(-0.05, midY - sag, -0.05),
          cardTop,
        ]);

        const newGeom = new THREE.TubeGeometry(curve, 16, 0.06, 6, false);
        ropeRef.current.geometry.dispose();
        ropeRef.current.geometry = newGeom;
      } catch (_e) {
        // Skip rope update this frame
      }
    }
  });

  return (
    <group>
      {/* Rope */}
      <mesh ref={ropeRef}>
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.7} />
      </mesh>

      {/* Card assembly */}
      <group ref={cardGroupRef} position={[0, cardStartY, 0]}>
        {/* Card body */}
        <mesh>
          <boxGeometry args={[2, 1.4, 0.08]} />
          <meshStandardMaterial map={texture} />
        </mesh>

        {/* Metal clip at top of card */}
        <mesh position={[0, 0.75, 0]}>
          <boxGeometry args={[0.6, 0.12, 0.08]} />
          <meshStandardMaterial color="#999999" metalness={0.8} roughness={0.3} />
        </mesh>

        {/* Metal clamp */}
        <mesh position={[0, 0.88, 0]}>
          <boxGeometry args={[0.4, 0.08, 0.08]} />
          <meshStandardMaterial color="#999999" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>

      {/* Ground shadow */}
      <ContactShadows
        position={[0, -2, 0]}
        opacity={0.4}
        scale={10}
        blur={2.5}
        far={4}
      />

      {/* Environment lighting */}
      <Environment preset="studio" />
    </group>
  );
}