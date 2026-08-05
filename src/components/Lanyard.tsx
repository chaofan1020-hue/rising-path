'use client';

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import {
  CubeCamera,
  Environment,
  Lightformer,
  ContactShadows,
  AccumulativeShadows,
  RandomizedLight,
  Html,
} from '@react-three/drei';

import {
  RigidBody,
  useRopeJoint,
  useSphericalJoint,
  BallCollider,
  CapsuleCollider,
} from '@react-three/rapier';

const ROPE_SEGMENTS = 3;
const ROPE_RADIUS = 0.08;
const ROPE_CURVE_SEGMENTS = 16;

// Manual cubic bezier interpolation (no CatmullRomCurve3 dependency)
function bezierCurvePoints(
  p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3,
  segments: number
): Float32Array {
  const positions = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    const uu = u * u;
    const uuu = uu * u;
    const tt = t * t;
    const ttt = tt * t;
    positions[i * 3] = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    positions[i * 3 + 1] = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
    positions[i * 3 + 2] = uuu * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + ttt * p3.z;
  }
  return positions;
}

// Create a tube geometry from bezier curve
function createTubeFromBezier(
  p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3,
  curveSegments: number, radius: number, radialSegments: number
): THREE.BufferGeometry {
  // Compute curve points
  const curvePoints: THREE.Vector3[] = [];
  for (let i = 0; i <= curveSegments; i++) {
    const t = i / curveSegments;
    const u = 1 - t;
    const uu = u * u;
    const uuu = uu * u;
    const tt = t * t;
    const ttt = tt * t;
    curvePoints.push(new THREE.Vector3(
      uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
      uuu * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + ttt * p3.z,
    ));
  }

  // Compute tangents
  const tangents: THREE.Vector3[] = [];
  for (let i = 0; i <= curveSegments; i++) {
    const prev = curvePoints[Math.max(0, i - 1)];
    const next = curvePoints[Math.min(curveSegments, i + 1)];
    const tangent = new THREE.Vector3().copy(next).sub(prev);
    if (tangent.length() > 0.0001) tangent.normalize();
    else tangent.set(0, 1, 0);
    tangents.push(tangent);
  }

  // Compute initial normal
  const up = new THREE.Vector3(0, 1, 0);
  const firstTangent = tangents[0];
  let normal = new THREE.Vector3().crossVectors(firstTangent, up);
  if (normal.length() < 0.0001) normal.set(1, 0, 0);
  normal.normalize();

  const vertexCount = (curveSegments + 1) * (radialSegments + 1);
  const positions = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  for (let i = 0; i <= curveSegments; i++) {
    const tangent = tangents[i];
    const point = curvePoints[i];

    // Compute basis vectors
    const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
    const normal2 = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

    for (let j = 0; j <= radialSegments; j++) {
      const theta = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);

      const idx = i * (radialSegments + 1) + j;
      positions[idx * 3] = point.x + radius * (cos * normal2.x + sin * (-binormal.x));
      positions[idx * 3 + 1] = point.y + radius * (cos * normal2.y + sin * (-binormal.y));
      positions[idx * 3 + 2] = point.z + radius * (cos * normal2.z + sin * (-binormal.z));

      if (i < curveSegments && j < radialSegments) {
        const a = idx;
        const b = idx + radialSegments + 1;
        const c = idx + 1;
        const d = idx + radialSegments + 2;
        indices.push(a, b, c);
        indices.push(c, b, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export default function Lanyard({
  position = [0, 0, 0],
  gravity = [0, -50, 0],
  cameraPosition = [0, 0.5, 13],
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
  const bandTexture = useTexture('https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/SOT1hmCesOHxEYxL7vkoZ/c57b29c85912047c414311723320c16b/band.jpg');

  // Card texture: white with logo
  const cardTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 512, 320);

    // Logo bars
    ctx.fillStyle = '#C46A4A';
    ctx.fillRect(80, 60, 180, 28);
    ctx.fillStyle = '#B5BEB0';
    ctx.fillRect(80, 96, 140, 28);

    // Brand name
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Rising Path', 256, 175);

    // Subtitle
    ctx.fillStyle = '#888888';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText('求职加速器', 256, 220);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  const fixed = useRef<any>(null);
  const j1 = useRef<any>(null);
  const j2 = useRef<any>(null);
  const j3 = useRef<any>(null);
  const card = useRef<any>(null);
  const ropeRef = useRef<THREE.Mesh>(null);
  const ropeGeomRef = useRef<THREE.BufferGeometry | null>(null);
  const settledRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [isDragged, setIsDragged] = useState(false);
  const dragOffset = useRef<THREE.Vector3 | null>(null);

  const vec = useRef(new THREE.Vector3());
  const ang = useRef(new THREE.Vector3());
  const rot = useRef(new THREE.Vector3());
  const dir = useRef(new THREE.Vector3());

  // Initialize rope geometry once
  useEffect(() => {
    try {
      const initP0 = new THREE.Vector3(0, 0, 0);
      const initP3 = new THREE.Vector3(0, 1, 0);
      const initP1 = new THREE.Vector3(0, 0.3, 0.1);
      const initP2 = new THREE.Vector3(0, 0.7, -0.1);
      const geom = createTubeFromBezier(initP0, initP1, initP2, initP3, ROPE_CURVE_SEGMENTS, ROPE_RADIUS, 6);
      ropeGeomRef.current = geom;
      if (ropeRef.current) {
        ropeRef.current.geometry = geom;
      }
    } catch (e) {
      // silently handle
    }
  }, []);

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1.5]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1.5]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1.5]);
  useSphericalJoint(j3, card, [
    [0, 0, 0], [0, -1.45, 0]
  ]);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = isDragged ? 'grabbing' : 'grab';
      return () => { document.body.style.cursor = 'auto'; };
    }
  }, [hovered, isDragged]);

  useFrame((state, delta) => {
    try {
      if (!fixed.current || !j1.current || !j2.current || !j3.current || !card.current) return;

      const v = vec.current;
      const a = ang.current;
      const r = rot.current;
      const d = dir.current;

      // Drag handling
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

      // Lerp rope joints for smooth simulation
      [j1, j2].forEach((ref: any) => {
        if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation());
        const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())));
        ref.current.lerped.lerp(ref.current.translation(), delta * (10 + clampedDistance * (50 - 10)));
      });

      // Update rope geometry using manual bezier (no CatmullRomCurve3)
      if (ropeRef.current) {
        try {
          const j3Pos = new THREE.Vector3().copy(j3.current.translation());
          const j2Pos = j2.current.lerped.clone();
          const j1Pos = j1.current.lerped.clone();
          const fixedPos = new THREE.Vector3().copy(fixed.current.translation());

          // Create control points with slight Z variation to avoid flat curve
          const midY = (fixedPos.y + j3Pos.y) / 2;
          const sag = Math.abs(fixedPos.y - j3Pos.y) * 0.15 + 0.1;

          const p0 = fixedPos; // fixed point at top
          const p1 = new THREE.Vector3(j2Pos.x, midY + sag, j2Pos.z * 0.5);
          const p2 = new THREE.Vector3(j1Pos.x, midY - sag, j1Pos.z * 0.5);
          const p3 = j3Pos; // card attachment point

          const newGeom = createTubeFromBezier(p0, p1, p2, p3, ROPE_CURVE_SEGMENTS, ROPE_RADIUS, 6);
          ropeRef.current.geometry.dispose();
          ropeRef.current.geometry = newGeom;
        } catch (_e) {
          // Skip rope update this frame
        }
      }

      // Apply angular damping
      a.copy(card.current.angvel());
      r.copy(card.current.rotation());
      card.current.setAngvel({ x: a.x, y: a.y - r.y * 0.25, z: a.z });

      // Spring force to pull card toward screen center
      if (!dragOffset.current) {
        const pos = card.current.translation();
        const vel = card.current.linvel();
        const targetX = 0;
        const targetY = 0.5;
        const targetZ = 0;
        const k = 15;
        const dmp = 5;

        const fx = k * (targetX - pos.x) - dmp * vel.x;
        const fy = k * (targetY - pos.y) - dmp * vel.y;
        const fz = k * (targetZ - pos.z) - dmp * vel.z;

        card.current.addForce({ x: fx, y: fy, z: fz }, true);

        const dist = Math.sqrt(
          (targetX - pos.x) ** 2 + (targetY - pos.y) ** 2 + (targetZ - pos.z) ** 2
        );
        const speed = Math.sqrt(vel.x ** 2 + vel.y ** 2 + vel.z ** 2);
        if (dist < 0.05 && speed < 0.05) {
          settledRef.current = true;
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

  const handlePointerEnter = () => setHovered(true);
  const handlePointerLeave = () => setHovered(false);

  return (
    <group position={position}>
      {/* Rope */}
      <mesh ref={ropeRef}>
        <meshBasicMaterial color="#FFFFFF" transparent opacity={0.7} />
      </mesh>

      {/* Fixed point at top */}
      <RigidBody ref={fixed} type="fixed" position={[0, 6, 0]}>
        <BallCollider args={[0.001]} />
      </RigidBody>

      {/* Rope segments */}
      <RigidBody ref={j1} position={[0, 4, 0]} {...segmentProps}>
        <CapsuleCollider args={[0.1, 0.1]} />
      </RigidBody>
      <RigidBody ref={j2} position={[0, 2, 0]} {...segmentProps}>
        <CapsuleCollider args={[0.1, 0.1]} />
      </RigidBody>
      <RigidBody ref={j3} position={[0, 0, 0]} {...segmentProps}>
        <CapsuleCollider args={[0.1, 0.1]} />
      </RigidBody>

      {/* Card */}
      <RigidBody
        ref={card}
        type="dynamic"
        position={[0, cardStartY, 0]}
        colliders="hull"
        mass={2}
        gravityScale={0.5}
        canSleep={false}
        angularDamping={0.5}
        linearDamping={0.5}
      >
        <group
          onPointerUp={handlePointerUp}
          onPointerDown={handlePointerDown}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          {/* Card body - white ID card */}
          <mesh>
            <boxGeometry args={[2.0, 1.4, 0.08]} />
            <meshStandardMaterial map={cardTexture} />
          </mesh>

          {/* Metal clip at top */}
          <mesh position={[0, 0.75, 0]}>
            <boxGeometry args={[0.5, 0.12, 0.08]} />
            <meshStandardMaterial color="#999999" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.82, 0]}>
            <boxGeometry args={[0.3, 0.08, 0.08]} />
            <meshStandardMaterial color="#999999" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      </RigidBody>
    </group>
  );
}