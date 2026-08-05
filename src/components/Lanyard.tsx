'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { useGLTF, useTexture, Environment, Lightformer } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import * as THREE from 'three';

const MODEL_URL = 'https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/5huRVDzcoDwnbgrKUo1Lzs/53b6dd7d6b4ffcdbd338fa60265949e1/tag.glb';

/** Generate a badge texture with the Rising Path logo on a white background */
function createBadgeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // White background with subtle rounded rect
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 512, 48);
  ctx.fill();

  // Thin border
  ctx.strokeStyle = '#E2E2E2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(2, 2, 508, 508, 48);
  ctx.stroke();

  // Rising Path text (dark gray, modern)
  ctx.fillStyle = '#1A1A1A';
  ctx.font = 'bold 52px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Rising Path', 256, 280);

  // Logo SVG (two bars) in dark gray
  const logoScale = 5;
  const cx = 256;
  const cy = 150;
  ctx.fillStyle = '#1A1A1A';
  // Top bar
  ctx.beginPath();
  ctx.roundRect(cx - 29 * logoScale / 2, cy, 29 * logoScale, 8 * logoScale, 4 * logoScale);
  ctx.fill();
  // Bottom bar
  ctx.beginPath();
  ctx.roundRect(cx - 29 * logoScale / 2, cy + 16 * logoScale, 29 * logoScale, 8 * logoScale, 4 * logoScale);
  ctx.fill();

  // Subtitle
  ctx.fillStyle = '#888888';
  ctx.font = '24px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('求职加速器', 256, 350);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function Band({
  position = [0, 0, 20] as [number, number, number],
  gravity = [0, -40, 0] as [number, number, number],
  cardStartY = 0,
  onError,
}: {
  position?: [number, number, number];
  gravity?: [number, number, number];
  cardStartY?: number;
  onError?: (err: Error) => void;
}) {
  const fixed = useRef<any>(null);
  const j1 = useRef<any>(null);
  const j2 = useRef<any>(null);
  const j3 = useRef<any>(null);
  const card = useRef<any>(null);

  const vec = useRef(new THREE.Vector3());
  const ang = useRef(new THREE.Vector3());
  const rot = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());
  const dragOffset = useRef<THREE.Vector3 | null>(null);
  const settledRef = useRef(false);

  // Load GLTF
  let nodes: any = {};
  let materials: any = {};
  try {
    const result = useGLTF(MODEL_URL);
    nodes = result.nodes;
    materials = result.materials;
  } catch (e) {
    onError?.(e as Error);
  }

  const { width, height } = useThree((state) => state.size);

  // Rope joint chain (rest length 1 each, total 3)
  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
  useSphericalJoint(j3, card, [[0, 0, 0], [0, 1.45, 0]]);

  const [hovered, hover] = useState(false);
  const [isDragged, setIsDragged] = useState(false);

  // Custom badge texture (white bg, dark text, Rising Path logo)
  const badgeTexture = useMemo(() => {
    try {
      return createBadgeTexture();
    } catch {
      return null;
    }
  }, []);

  // Rope tube mesh ref
  const ropeRef = useRef<THREE.Mesh>(null);

  // Initialize tube geometry with default curve
  useEffect(() => {
    try {
      const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.5, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(1.5, 0, 0),
      ];
      const curve = new THREE.CatmullRomCurve3(pts);
      const geom = new THREE.TubeGeometry(curve, 20, 0.08, 8, false);
      if (ropeRef.current) {
        ropeRef.current.geometry = geom;
      }
    } catch (e) {
      onError?.(e as Error);
    }
  }, []);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = isDragged ? 'grabbing' : 'grab';
      return () => { document.body.style.cursor = 'auto'; };
    }
  }, [hovered, isDragged]);

  useFrame((state, delta) => {
    try {
      const v = vec.current;
      const a = ang.current;
      const r = rot.current;
      const d = dir.current;

      if (dragOffset.current) {
        v.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
        d.copy(v).sub(state.camera.position).normalize();
        v.add(d.multiplyScalar(state.camera.position.length()));
        [card, j1, j2, j3, fixed].forEach((ref: any) => ref.current?.wakeUp());
        card.current?.setNextKinematicTranslation({
          x: v.x - dragOffset.current.x,
          y: v.y - dragOffset.current.y,
          z: v.z - dragOffset.current.z,
        });
      }

      if (fixed.current) {
        // Lerp rope joints for smooth rope simulation
        [j1, j2].forEach((ref: any) => {
          if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation());
          const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())));
          ref.current.lerped.lerp(ref.current.translation(), delta * (10 + clampedDistance * (50 - 10)));
        });

        // Update rope tube geometry from physics joints
        if (ropeRef.current) {
          const pts = [
            new THREE.Vector3().copy(j3.current.translation()),
            new THREE.Vector3().copy(j2.current.lerped),
            new THREE.Vector3().copy(j1.current.lerped),
            new THREE.Vector3().copy(fixed.current.translation()),
          ];
          const curve = new THREE.CatmullRomCurve3(pts);
          ropeRef.current.geometry.dispose();
          ropeRef.current.geometry = new THREE.TubeGeometry(curve, 20, 0.08, 8, false);
        }

        // Apply angular damping to card
        a.copy(card.current.angvel());
        r.copy(card.current.rotation());
        card.current.setAngvel({ x: a.x, y: a.y - r.y * 0.25, z: a.z });

        // Spring force to pull card toward screen center
        if (card.current && !dragOffset.current) {
          const pos = card.current.translation();
          const vel = card.current.linvel();

          // Target: center of screen in world space (y=0 for group at [0,2.5,0])
          // The card hangs at the bottom of the rope, spring pulls it to center
          const targetX = 0;
          const targetY = 0.5; // center of screen
          const targetZ = 0;

          // Strong spring + damping for fast, smooth settling
          const k = 15; // spring constant
          const dmp = 5; // damping

          const fx = k * (targetX - pos.x) - dmp * vel.x;
          const fy = k * (targetY - pos.y) - dmp * vel.y;
          const fz = k * (targetZ - pos.z) - dmp * vel.z;

          card.current.addForce({ x: fx, y: fy, z: fz }, true);

          // Check if settled
          const dist = Math.sqrt(
            (targetX - pos.x) ** 2 + (targetY - pos.y) ** 2 + (targetZ - pos.z) ** 2
          );
          const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
          if (dist < 0.05 && speed < 0.05) {
            settledRef.current = true;
          }
        }
      }
    } catch (e) {
      onError?.(e as Error);
    }
  });

  const segmentProps = { type: 'dynamic' as const, canSleep: false, colliders: false as const, angularDamping: 0.5, linearDamping: 0.5 };

  const handlePointerUp = (e: any) => {
    e.target.releasePointerCapture(e.pointerId);
    dragOffset.current = null;
    setIsDragged(false);
  };

  const handlePointerDown = (e: any) => {
    e.target.setPointerCapture(e.pointerId);
    const translation = card.current?.translation?.() ?? new THREE.Vector3();
    dragOffset.current = new THREE.Vector3().copy(e.point).sub(vec.current.copy(translation));
    setIsDragged(true);
  };

  return (
    <group position={position}>
      <RigidBody ref={fixed} {...(segmentProps as any)} type="fixed" />
      <RigidBody ref={j1} {...(segmentProps as any)} position={[0.5, 0, 0]}>
        <BallCollider args={[0.1]} />
      </RigidBody>
      <RigidBody ref={j2} {...(segmentProps as any)} position={[1, 0, 0]}>
        <BallCollider args={[0.1]} />
      </RigidBody>
      <RigidBody ref={j3} {...(segmentProps as any)} position={[1.5, 0, 0]}>
        <BallCollider args={[0.1]} />
      </RigidBody>
      <RigidBody
        ref={card}
        {...(segmentProps as any)}
        position={[2, cardStartY, 0]}
        type={isDragged ? 'kinematicPosition' : 'dynamic'}
      >
        <CuboidCollider args={[0.8, 1.125, 0.01]} />
        <group
          scale={2.25}
          position={[0, -1.2, -0.05]}
          onPointerOver={() => hover(true)}
          onPointerOut={() => hover(false)}
          onPointerUp={handlePointerUp}
          onPointerDown={handlePointerDown}
        >
          {/* Card face with white Rising Path badge */}
          <mesh geometry={nodes?.card?.geometry}>
            <meshPhysicalMaterial
              map={badgeTexture || undefined}
              color={badgeTexture ? undefined : '#FFFFFF'}
              clearcoat={0.5}
              clearcoatRoughness={0.2}
              roughness={0.2}
              metalness={0.0}
            />
          </mesh>
          <mesh geometry={nodes?.clip?.geometry}>
            <meshPhysicalMaterial color="#CCCCCC" roughness={0.3} metalness={0.6} />
          </mesh>
          <mesh geometry={nodes?.clamp?.geometry}>
            <meshPhysicalMaterial color="#CCCCCC" roughness={0.3} metalness={0.6} />
          </mesh>
        </group>
      </RigidBody>
      {/* Rope tube */}
      <mesh ref={ropeRef}>
        <meshPhysicalMaterial
          color="#FFFFFF"
          roughness={0.8}
          metalness={0.0}
          transparent
          opacity={0.85}
        />
      </mesh>
    </group>
  );
}

export default function Lanyard({
  position = [0, 0, 20],
  gravity = [0, -40, 0],
  cameraPosition = [0, 0.5, 13] as [number, number, number],
  cameraFov = 25,
  cardStartY = 0,
  onError,
}: {
  position?: [number, number, number];
  gravity?: [number, number, number];
  cameraPosition?: [number, number, number];
  cameraFov?: number;
  cardStartY?: number;
  onError?: (err: Error) => void;
}) {
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback((err: Error) => {
    console.error('[Lanyard] error:', err);
    setHasError(true);
    onError?.(err);
  }, [onError]);

  if (hasError) {
    return (
      <div className="w-full h-full flex items-center justify-center text-white/60 text-sm">
        加载失败
      </div>
    );
  }

  return (
    <Canvas
      camera={{ position: cameraPosition, fov: cameraFov }}
      style={{ width: '100%', height: '100%' }}
      onError={(e) => { console.error('[Canvas] error:', e); handleError(new Error('Canvas error')); }}
      onCreated={(state) => {
        const gl = state.gl;
        gl.domElement.addEventListener('webglcontextlost', (e: Event) => {
          e.preventDefault();
          console.warn('[Canvas] WebGL context lost');
        });
        gl.domElement.addEventListener('webglcontextrestored', () => {
          console.log('[Canvas] WebGL context restored');
        });
      }}
    >
      <ambientLight intensity={Math.PI} />
      <Physics interpolate gravity={gravity} timeStep={1 / 60}>
        <Band
          position={position}
          gravity={gravity}
          cardStartY={cardStartY}
          onError={handleError}
        />
      </Physics>
      <Environment background blur={0.75}>
        <color attach="background" args={['black']} />
        <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
      </Environment>
    </Canvas>
  );
}