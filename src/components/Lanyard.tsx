'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { useGLTF, useTexture, Environment, Lightformer } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import * as THREE from 'three';

const MODEL_URL = 'https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/5huRVDzcoDwnbgrKUo1Lzs/53b6dd7d6b4ffcdbd338fa60265949e1/tag.glb';
const BAND_URL = 'https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/SOT1hmCesOHxEYxL7vkoZ/c57b29c85912047c414311723320c16b/band.jpg';

const RIBBON_SEGMENTS = 20;
const RIBBON_WIDTH = 0.12;

/** Generate a badge texture with the Rising Path logo on a colored background */
function createBadgeTexture(bgColor: string, logoColor: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(0, 0, 512, 512, 48);
  ctx.fill();

  // Rising Path text
  ctx.fillStyle = logoColor;
  ctx.font = 'bold 56px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Rising Path', 256, 256);

  // Logo SVG (two bars)
  const logoScale = 6;
  const cx = 256;
  const cy = 140;
  // Top bar: M0 0h29a4 4 0 0 1 0 8H0V0z
  ctx.fillStyle = logoColor;
  ctx.beginPath();
  ctx.roundRect(cx - 29 * logoScale / 2, cy, 29 * logoScale, 8 * logoScale, 4 * logoScale);
  ctx.fill();
  // Bottom bar: M40 20H11a4 4 0 0 1 0-8h29v8z
  ctx.beginPath();
  ctx.roundRect(cx - 29 * logoScale / 2, cy + 16 * logoScale, 29 * logoScale, 8 * logoScale, 4 * logoScale);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function Band({
  position = [0, 0, 20] as [number, number, number],
  gravity = [0, -40, 0] as [number, number, number],
  cardStartY = 0,
  badgeColor = '#C46A4A',
  onError,
}: {
  position?: [number, number, number];
  gravity?: [number, number, number];
  cardStartY?: number;
  badgeColor?: string;
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

  // Load GLTF - wrap in try/catch
  let nodes: any = {};
  let materials: any = {};
  try {
    const result = useGLTF(MODEL_URL);
    nodes = result.nodes;
    materials = result.materials;
  } catch (e) {
    if (onError) onError(e as Error);
  }

  const rawBandTexture = useTexture(BAND_URL);
  const { width, height } = useThree((state) => state.size);

  const curveRef = useRef(new THREE.CatmullRomCurve3([
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
  ]));

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
  useSphericalJoint(j3, card, [[0, 0, 0], [0, 1.45, 0]]);

  const [hovered, hover] = useState(false);
  const [isDragged, setIsDragged] = useState(false);

  // Rope mesh ref
  const ropeRef = useRef<THREE.Mesh>(null);
  // Ribbon geometry ref for reuse
  const ribbonGeomRef = useRef<THREE.BufferGeometry | null>(null);

  // Custom badge texture with logo
  const badgeTexture = useMemo(() => {
    try {
      return createBadgeTexture(badgeColor, '#FFFFFF');
    } catch {
      return null;
    }
  }, [badgeColor]);

  const bandTexture = useMemo(() => {
    const t = rawBandTexture.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    return t;
  }, [rawBandTexture]);

  // Initialize ribbon geometry once
  useEffect(() => {
    try {
      const vertexCount = (RIBBON_SEGMENTS + 1) * 2;
      const positions = new Float32Array(vertexCount * 3);
      const uvs = new Float32Array(vertexCount * 2);
      const indices: number[] = [];

      for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
        const t = i / RIBBON_SEGMENTS;
        uvs[i * 4] = 0;
        uvs[i * 4 + 1] = t;
        uvs[i * 4 + 2] = 1;
        uvs[i * 4 + 3] = t;

        if (i < RIBBON_SEGMENTS) {
          const a = i * 2;
          const b = i * 2 + 1;
          const c = (i + 1) * 2;
          const d = (i + 1) * 2 + 1;
          indices.push(a, c, b);
          indices.push(b, c, d);
        }
      }

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      geom.setIndex(indices);
      geom.computeVertexNormals();

      ribbonGeomRef.current = geom;
      if (ropeRef.current) {
        ropeRef.current.geometry = geom;
      }
    } catch (e) {
      if (onError) onError(e as Error);
    }
  }, []);

  useEffect(() => {
    curveRef.current.curveType = 'chordal';
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
      const curve = curveRef.current;

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
        [j1, j2].forEach((ref: any) => {
          if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation());
          const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())));
          ref.current.lerped.lerp(ref.current.translation(), delta * (10 + clampedDistance * (50 - 10)));
        });

        // Update curve control points from physics joints
        curve.points[0].copy(j3.current.translation());
        curve.points[1].copy(j2.current.lerped);
        curve.points[2].copy(j1.current.lerped);
        curve.points[3].copy(fixed.current.translation());

        // Update ribbon geometry
        const geom = ribbonGeomRef.current;
        if (geom) {
          const points = curve.getPoints(RIBBON_SEGMENTS);
          if (points.length > 1) {
            const posAttr = geom.attributes.position as THREE.BufferAttribute;
            const posArray = posAttr.array as Float32Array;
            const tmp = new THREE.Vector3();

            for (let i = 0; i <= RIBBON_SEGMENTS; i++) {
              const p = points[i];
              if (i < RIBBON_SEGMENTS) {
                tmp.copy(points[i + 1]).sub(points[i]).normalize();
              } else {
                tmp.copy(points[i]).sub(points[i - 1]).normalize();
              }
              const n = new THREE.Vector3(-tmp.y, tmp.x, 0).normalize();

              const idx = i * 6;
              posArray[idx] = p.x + n.x * RIBBON_WIDTH;
              posArray[idx + 1] = p.y + n.y * RIBBON_WIDTH;
              posArray[idx + 2] = p.z + n.z * RIBBON_WIDTH;
              posArray[idx + 3] = p.x - n.x * RIBBON_WIDTH;
              posArray[idx + 4] = p.y - n.y * RIBBON_WIDTH;
              posArray[idx + 5] = p.z - n.z * RIBBON_WIDTH;
            }
            posAttr.needsUpdate = true;
            geom.computeVertexNormals();
          }
        }

        a.copy(card.current.angvel());
        r.copy(card.current.rotation());
        card.current.setAngvel({ x: a.x, y: a.y - r.y * 0.25, z: a.z });
      }
    } catch (e) {
      if (onError) onError(e as Error);
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
          {/* Card face with custom texture */}
          <mesh geometry={nodes?.card?.geometry}>
            <meshPhysicalMaterial
              map={badgeTexture || undefined}
              color={badgeTexture ? undefined : badgeColor}
              clearcoat={1}
              clearcoatRoughness={0.15}
              roughness={0.3}
              metalness={0.5}
            />
          </mesh>
          <mesh geometry={nodes?.clip?.geometry}>
            <meshPhysicalMaterial color="#888888" roughness={0.3} metalness={0.8} />
          </mesh>
          <mesh geometry={nodes?.clamp?.geometry}>
            <meshPhysicalMaterial color="#888888" roughness={0.3} metalness={0.8} />
          </mesh>
        </group>
      </RigidBody>
      {/* Flat ribbon lanyard strap with band texture */}
      <mesh ref={ropeRef}>
        <meshBasicMaterial map={bandTexture} transparent side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export default function Lanyard({
  position = [0, 0, 20],
  gravity = [0, -40, 0],
  cameraPosition = [0, 0, 13] as [number, number, number],
  cameraFov = 25,
  cardStartY = 0,
  badgeColor = '#C46A4A',
  onError,
}: {
  position?: [number, number, number];
  gravity?: [number, number, number];
  cameraPosition?: [number, number, number];
  cameraFov?: number;
  cardStartY?: number;
  badgeColor?: string;
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
        // Handle WebGL context loss
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
          badgeColor={badgeColor}
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