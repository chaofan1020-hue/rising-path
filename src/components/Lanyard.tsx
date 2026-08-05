'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { useGLTF, useTexture, Environment, Lightformer, Line } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import * as THREE from 'three';

const MODEL_URL = 'https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/5huRVDzcoDwnbgrKUo1Lzs/53b6dd7d6b4ffcdbd338fa60265949e1/tag.glb';
const BAND_URL = 'https://assets.vercel.com/image/upload/contentful/image/e5382hct74si/SOT1hmCesOHxEYxL7vkoZ/c57b29c85912047c414311723320c16b/band.jpg';

function Band({ position = [0, 0, 20] as [number, number, number], gravity = [0, -40, 0] as [number, number, number], cardStartY = 0 }) {
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

  const { nodes, materials } = useGLTF(MODEL_URL);
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

  // Rope line ref (for dynamic geometry updates via drei Line component)
  const lineRef = useRef<any>(null);

  const bandTexture = useMemo(() => {
    const t = rawBandTexture.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }, [rawBandTexture]);

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

      // Update curve control points
      curve.points[0].copy(j3.current.translation());
      curve.points[1].copy(j2.current.lerped);
      curve.points[2].copy(j1.current.lerped);
      curve.points[3].copy(fixed.current.translation());

      // Update Line2 geometry with interpolated curve points
      const pts = curve.getPoints(20);
      const positions: number[] = [];
      pts.forEach((p: THREE.Vector3) => {
        positions.push(p.x, p.y, p.z);
      });
      if (lineRef.current) {
        const geom = lineRef.current.geometry;
        if (geom && typeof geom.setPositions === 'function') {
          geom.setPositions(positions);
          lineRef.current.computeLineDistances();
        }
      }

      a.copy(card.current.angvel());
      r.copy(card.current.rotation());
      card.current.setAngvel({ x: a.x, y: a.y - r.y * 0.25, z: a.z });
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
          <mesh geometry={(nodes as any).card.geometry}>
            <meshPhysicalMaterial
              map={(materials as any).base.map}
              map-anisotropy={16}
              clearcoat={1}
              clearcoatRoughness={0.15}
              roughness={0.3}
              metalness={0.5}
            />
          </mesh>
          <mesh geometry={(nodes as any).clip.geometry}>
            <meshPhysicalMaterial {...(materials as any).metal} roughness={0.3} />
          </mesh>
          <mesh geometry={(nodes as any).clamp.geometry}>
            <meshPhysicalMaterial {...(materials as any).metal} />
          </mesh>
        </group>
      </RigidBody>
      {/* Rope rendered with drei Line component */}
      <Line
        ref={lineRef}
        points={[[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]]}
        lineWidth={4}
        color="#E2D0B8"
        transparent
        opacity={0.9}
      />
    </group>
  );
}

export default function Lanyard({
  position = [0, 0, 20],
  gravity = [0, -40, 0],
  cameraPosition = [0, 0, 13] as [number, number, number],
  cameraFov = 25,
  cardStartY = 0,
  frontImage,
  backImage,
  imageFit = 'cover',
  lanyardImage,
  lanyardWidth = 1,
}: {
  position?: [number, number, number];
  gravity?: [number, number, number];
  cameraPosition?: [number, number, number];
  cameraFov?: number;
  cardStartY?: number;
  frontImage?: string;
  backImage?: string;
  imageFit?: string;
  lanyardImage?: string;
  lanyardWidth?: number;
}) {
  return (
    <Canvas camera={{ position: cameraPosition, fov: cameraFov }} style={{ width: '100%', height: '100%' }}>
      <ambientLight intensity={Math.PI} />
      <Physics interpolate gravity={gravity} timeStep={1 / 60}>
        <Band position={position} gravity={gravity} cardStartY={cardStartY} />
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