'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, extend, Canvas } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';

extend({ MeshLineGeometry, MeshLineMaterial });

function createCardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 320;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 512, 320);

  // Logo - two rectangular bars (from header)
  ctx.fillStyle = '#C46A4A';
  ctx.fillRect(80, 60, 160, 28);
  ctx.fillStyle = '#B5BEB0';
  ctx.fillRect(80, 96, 120, 28);

  // Brand name
  ctx.fillStyle = '#1a1a1a';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Rising Path', 256, 180);

  // Subtitle
  ctx.fillStyle = '#666666';
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText('求职加速器', 256, 225);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export default function Lanyard({
  position = [0, 0, 13],
  gravity = [0, -40, 0],
  fov = 20,
}: {
  position?: [number, number, number];
  gravity?: [number, number, number];
  fov?: number;
}) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <Canvas
      camera={{ position, fov }}
      dpr={[1, isMobile ? 1.5 : 2]}
      gl={{ alpha: true }}
      onCreated={({ gl }) => gl.setClearColor(new THREE.Color(0x000000), 0)}
    >
      <ambientLight intensity={Math.PI} />
      <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}>
        <Band isMobile={isMobile} />
      </Physics>
      <Environment blur={0.75}>
        <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
      </Environment>
    </Canvas>
  );
}

function Band({ isMobile = false }: { isMobile?: boolean }) {
  const band = useRef<{ geometry: { setPoints: (pts: THREE.Vector3[]) => void } }>(null);
  const fixed = useRef<any>(null);
  const j1 = useRef<any>(null);
  const j2 = useRef<any>(null);
  const j3 = useRef<any>(null);
  const card = useRef<any>(null);

  const vec = useMemo(() => new THREE.Vector3(), []);
  const ang = useMemo(() => new THREE.Vector3(), []);
  const rot = useMemo(() => new THREE.Vector3(), []);

  const segmentProps = useMemo(
    () => ({
      type: 'dynamic' as const,
      canSleep: true,
      colliders: false as const,
      angularDamping: 4,
      linearDamping: 4,
    }),
    [],
  );

  // Card texture
  const cardTexture = useMemo(() => createCardTexture(), []);

  // Lanyard texture (canvas-based, white with subtle pattern)
  const lanyardTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 64, 64);
    // Subtle weave pattern
    ctx.strokeStyle = '#f0f0f0';
    ctx.lineWidth = 1;
    for (let i = 0; i < 64; i += 4) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 64);
      ctx.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }, []);

  const curveRef = useRef(new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]));

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
  useSphericalJoint(j3, card, [
    [0, 0, 0],
    [0, 1.5, 0],
  ]);

  useFrame((state, delta) => {
    if (fixed.current) {
      // Smooth lerp for rope joints
      [j1, j2].forEach((ref: any) => {
        if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation());
        const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())));
        ref.current.lerped.lerp(ref.current.translation(), delta * (10 + clampedDistance * 40));
      });

      // Update curve points from physics joints
      curveRef.current.points[0].copy(j3.current.translation());
      curveRef.current.points[1].copy(j2.current.lerped);
      curveRef.current.points[2].copy(j1.current.lerped);
      curveRef.current.points[3].copy(fixed.current.translation());

      // Update rope mesh
      if (band.current) {
        band.current.geometry.setPoints(curveRef.current.getPoints(isMobile ? 16 : 32));
      }

      // Angular velocity damping to prevent spinning
      if (card.current) {
        ang.copy(card.current.angvel());
        rot.copy(card.current.rotation());
        card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z });
      }
    }
  });

  useEffect(() => {
    curveRef.current.curveType = 'chordal' as any;
  }, []);

  return (
    <>
      <group position={[0, 4, 0]}>
        {/* Fixed point at top */}
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />

        {/* Rope joint segments */}
        <RigidBody position={[0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>

        {/* Card */}
        <RigidBody position={[2, 0, 0]} ref={card} {...segmentProps} type="dynamic">
          <CuboidCollider args={[0.8, 1.125, 0.01]} />
          <group scale={2.25} position={[0, -1.2, -0.05]}>
            {/* Card body */}
            <mesh>
              <boxGeometry args={[0.8, 1.125, 0.04]} />
              <meshPhysicalMaterial
                map={cardTexture}
                clearcoat={isMobile ? 0 : 1}
                clearcoatRoughness={0.15}
                roughness={0.9}
                metalness={0.8}
              />
            </mesh>
            {/* Metal clip */}
            <mesh position={[0, 0.6, 0]}>
              <boxGeometry args={[0.3, 0.06, 0.04]} />
              <meshStandardMaterial color="#888888" metalness={0.8} roughness={0.3} />
            </mesh>
            {/* Metal clamp */}
            <mesh position={[0, 0.68, 0]}>
              <boxGeometry args={[0.2, 0.04, 0.04]} />
              <meshStandardMaterial color="#888888" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        </RigidBody>
      </group>

      {/* Rope mesh using meshline */}
      <mesh ref={band}>
        <meshLineGeometry />
        <meshLineMaterial
          color="white"
          depthTest={false}
          resolution={isMobile ? [1000, 2000] : [1000, 1000]}
          useMap
          map={lanyardTexture}
          repeat={[-4, 1]}
          lineWidth={1}
        />
      </mesh>
    </>
  );
}