/* eslint-disable react/no-unknown-property, react-hooks/immutability */
'use client';
// Fix R3F v9.7.0 + React 19: Next.js dev tools inject data-inspector-* attributes.
// R3F resolve() first checks `key in root` — registering the full hyphenated prop
// name as a noop property on THREE prototypes makes that check hit, so R3F treats
// it as a plain direct assignment (no piercing, no throw).
import * as THREE from 'three';
if (typeof window !== 'undefined') {
  const protos = [THREE.Object3D.prototype, THREE.Material.prototype, THREE.BufferGeometry.prototype];
  const inspectorProps = [
    'data-inspector-column',
    'data-inspector-line',
    'data-inspector-file',
    'data-inspector-component',
    'data-inspector-path',
    'data-inspector-name',
  ];
  for (const proto of protos) {
    for (const prop of inspectorProps) {
      if (!Object.prototype.hasOwnProperty.call(proto, prop)) {
        Object.defineProperty(proto, prop, {
          get() { return 0; },
          set() { /* silently accept */ },
          configurable: true,
        });
      }
    }
  }
  // Suppress known harmless library-internal warnings
  const origWarn = console.warn.bind(console);
  console.warn = (...args) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('THREE.Clock') || msg.includes('deprecated parameters') || msg.includes('data-inspector')) return;
    origWarn(...args);
  };
}
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, extend, useFrame } from '@react-three/fiber';
import { useGLTF, useTexture, Environment, Lightformer } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';
// replace with your own imports, see the usage snippet for details
const cardGLB = '/card.glb';
const lanyard = '/lanyard.png';
import './Lanyard.css';
extend({ MeshLineGeometry, MeshLineMaterial });
// 1x1 transparent pixel — lets useTexture be called unconditionally when a
// front/back image isn't supplied.
const BLANK_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// The card model's front face is UV-mapped to the LEFT half of the texture
// atlas and the back face to the RIGHT half (measured from card.glb). Each
// custom image is composited into its own half so the two faces render
// independently, aspect-preserving (no stretching).
// Measured from the actual card.glb UV islands (front face): u 0.0008..0.4989, v 0.0042..0.7548
const FRONT_UV_RECT = { x: 0.0008, y: 0.0042, w: 0.4981, h: 0.7506 };
const BACK_UV_RECT = { x: 0.5, y: 0.0042, w: 0.4981, h: 0.7506 };
// The model's UV region aspect (0.664) is narrower than its physical face aspect
// (0.716) — textures are horizontally stretched ~8% by design. Counteract by
// squashing the visual group X so printed artwork keeps its native proportion.
const CARD_X_SQUASH = 0.9263;
function detectWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * @param {object} props
 * @param {[number, number, number]} [props.position]
 * @param {[number, number, number]} [props.gravity]
 * @param {number} [props.fov]
 * @param {boolean} [props.transparent]
 * @param {string | null} [props.frontImage]
 * @param {string | null} [props.backImage]
 * @param {'cover' | 'contain'} [props.imageFit]
 * @param {string | null} [props.lanyardImage]
 * @param {number} [props.lanyardWidth]
 */
export default function Lanyard({
  position = [0, 2, 12],
  gravity = [0, -55, 0],
  fov = 24,
  transparent = true,
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  lanyardImage = null,
  lanyardWidth = 0.7
}) {
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [webglOk, setWebglOk] = useState(true);
  const [contextLost, setContextLost] = useState(false);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  useEffect(() => {
    setWebglOk(detectWebGL());
  }, []);
  if (!webglOk || contextLost) {
    return (
      <div className="lanyard-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
        <div style={{ textAlign: 'center', opacity: 0.6 }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="M8 2v4" /><path d="M16 2v4" /><path d="M2 10h20" />
          </svg>
          <p style={{ fontSize: '14px' }}>3D 效果暂不可用</p>
        </div>
      </div>
    );
  }
  return (
    <div className="lanyard-wrapper">
      <Canvas
        camera={{ position: position, fov: fov }}
        dpr={[1, isMobile ? 1.5 : 2]}
        gl={{ alpha: transparent, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
        onCreated={({ gl }) => {
          gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1);
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            setContextLost(true);
          });
        }}
      >
        <ambientLight intensity={Math.PI * 0.4} />
        <directionalLight position={[5, 8, 10]} intensity={0.8} />
        <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}>
          <Band
            isMobile={isMobile}
            frontImage={frontImage}
            backImage={backImage}
            imageFit={imageFit}
            lanyardImage={lanyardImage}
            lanyardWidth={lanyardWidth}
          />
        </Physics>
        <Environment blur={0.6}>
          {/* Overhead key light — strong highlight on card top edge and clip */}
          <Lightformer
            intensity={6}
            color="white"
            position={[0, 8, 4]}
            rotation={[-Math.PI / 4, 0, 0]}
            scale={[60, 4, 1]}
          />
          {/* Front fill — illuminates card face evenly */}
          <Lightformer
            intensity={3}
            color="white"
            position={[0, 0, 8]}
            rotation={[0, 0, 0]}
            scale={[40, 20, 1]}
          />
          {/* Left rim light — edge highlight for 3D depth */}
          <Lightformer
            intensity={4}
            color="#e8f0ff"
            position={[-8, 2, 2]}
            rotation={[0, Math.PI / 3, 0]}
            scale={[40, 6, 1]}
          />
          {/* Right rim light — warm accent */}
          <Lightformer
            intensity={3}
            color="#fff5e8"
            position={[8, 1, 2]}
            rotation={[0, -Math.PI / 3, 0]}
            scale={[40, 6, 1]}
          />
          {/* Bottom bounce — subtle fill from below */}
          <Lightformer
            intensity={1.5}
            color="#f0ebe5"
            position={[0, -6, 3]}
            rotation={[Math.PI / 3, 0, 0]}
            scale={[60, 2, 1]}
          />
          {/* Back strip — metal reflection streak */}
          <Lightformer
            intensity={8}
            color="white"
            position={[0, 4, -6]}
            rotation={[0, Math.PI, 0]}
            scale={[80, 1, 1]}
          />
        </Environment>
      </Canvas>
    </div>
  );
}
function Band({
  maxSpeed = 50,
  minSpeed = 0,
  isMobile = false,
  frontImage = null,
  backImage = null,
  imageFit = 'cover',
  lanyardImage = null,
  lanyardWidth = 0.7
}) {
  const band = useRef(),
    fixed = useRef(),
    j1 = useRef(),
    j2 = useRef(),
    j3 = useRef(),
    card = useRef();
  const vec = new THREE.Vector3(),
    ang = new THREE.Vector3(),
    rot = new THREE.Vector3(),
    dir = new THREE.Vector3(),
    quat = new THREE.Quaternion(),
    jointPos = new THREE.Vector3();
  const segmentProps = { type: 'dynamic', canSleep: true, colliders: false, angularDamping: 3, linearDamping: 3 };
  const { nodes, materials } = useGLTF(cardGLB);
  const texture = useTexture(lanyardImage || lanyard);
  // useTexture must be called unconditionally; use a blank pixel when an image
  // isn't supplied for a given face, then skip compositing it below.
  const frontTex = useTexture(frontImage || BLANK_PIXEL);
  const backTex = useTexture(backImage || BLANK_PIXEL);
  // Composite the front/back images into the card's texture atlas (front = left
  // half, back = right half). Each image is drawn aspect-preserving (no stretch).
  const cardMap = useMemo(() => {
    const baseMap = materials.base.map;
    if (!frontImage && !backImage) return baseMap;
    const baseImg = baseMap.image;
    const W = baseImg.width;
    const H = baseImg.height;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return baseMap;
    // Keep the original baked atlas for the card edges and any untouched face.
    ctx.drawImage(baseImg, 0, 0, W, H);
    const drawFitted = (img, rect) => {
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      const pick = imageFit === 'contain' ? Math.min : Math.max;
      const scale = pick(rw / img.width, rh / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = rx + (rw - dw) / 2;
      const dy = ry + (rh - dh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    };
    if (frontImage && frontTex.image) drawFitted(frontTex.image, FRONT_UV_RECT);
    if (backImage && backTex.image) drawFitted(backTex.image, BACK_UV_RECT);
    const composite = new THREE.CanvasTexture(canvas);
    composite.colorSpace = THREE.SRGBColorSpace;
    composite.flipY = baseMap.flipY;
    composite.anisotropy = 16;
    composite.needsUpdate = true;
    return composite;
  }, [frontImage, backImage, imageFit, frontTex, backTex, materials.base.map]);
  const [curve] = useState(
    () =>
      new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()])
  );
  const [dragged, drag] = useState(false);
  const [hovered, hover] = useState(false);

  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], 1]);
  useSphericalJoint(j3, card, [
    [0, 0, 0],
    [0, 1.5, 0]
  ]);
  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab';
      return () => void (document.body.style.cursor = 'auto');
    }
  }, [hovered, dragged]);
  // Initial drop: strong downward impulse + slight spin so the entrance feels weighty
  useEffect(() => {
    const c = card.current;
    if (!c) return;
    c.setLinvel({ x: 0, y: -2, z: 0 }, true);
    c.setAngvel({ x: 0, y: 0, z: -0.6 }, true);
  }, []);
  useFrame((state, delta) => {
    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.add(dir.multiplyScalar(state.camera.position.length()));
      [card, j1, j2, j3, fixed].forEach(ref => ref.current?.wakeUp());
      card.current?.setNextKinematicTranslation({ x: vec.x - dragged.x, y: vec.y - dragged.y, z: vec.z - dragged.z });
    }
    if (fixed.current) {
      [j1, j2].forEach(ref => {
        if (!ref.current.lerped) ref.current.lerped = new THREE.Vector3().copy(ref.current.translation());
        const clampedDistance = Math.max(0.1, Math.min(1, ref.current.lerped.distanceTo(ref.current.translation())));
        ref.current.lerped.lerp(
          ref.current.translation(),
          delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed))
        );
      });
      // Compute band end from card transform (exact joint position, immune to physics solver lag)
      const cp = card.current.translation();
      const cr = card.current.rotation();
      quat.set(cr.x, cr.y, cr.z, cr.w);
      jointPos.set(0, 1.5, 0).applyQuaternion(quat);
      curve.points[0].set(cp.x + jointPos.x, cp.y + jointPos.y, cp.z + jointPos.z);
      curve.points[1].copy(j2.current.lerped);
      curve.points[2].copy(j1.current.lerped);
      curve.points[3].copy(fixed.current.translation());
      band.current.geometry.setPoints(curve.getPoints(isMobile ? 16 : 32));
      ang.copy(card.current.angvel());
      rot.copy(card.current.rotation());
      card.current.setAngvel({ x: ang.x, y: ang.y - rot.y * 0.25, z: ang.z });
    }
  });
  curve.curveType = 'chordal';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return (
    <>
      <group position={[0, 4.6, 0]}>
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />
        <RigidBody position={[0.5, 0, 0]} ref={j1} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1, 0, 0]} ref={j2} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[1.5, 0, 0]} ref={j3} {...segmentProps}>
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[2, 0.5, 0]} ref={card} {...segmentProps} type={dragged ? 'kinematicPosition' : 'dynamic'}>
          <CuboidCollider args={[0.8, 1.125, 0.01]} />
          <group
            scale={[2.25 * CARD_X_SQUASH, 2.25, 2.25]}
            position={[0, -1.2, -0.05]}
            onPointerOver={() => hover(true)}
            onPointerOut={() => hover(false)}
            onPointerUp={e => (e.target.releasePointerCapture(e.pointerId), drag(false))}
            onPointerDown={e => (
              e.target.setPointerCapture(e.pointerId),
              drag(new THREE.Vector3().copy(e.point).sub(vec.copy(card.current.translation())))
            )}
          >
            <mesh geometry={nodes.card.geometry}>
              {/* Unlit: printed badge faces must render true to the design colors,
                  PBR lighting always washes printed artwork out at some angle. */}
              <meshBasicMaterial map={cardMap} toneMapped={false} />
            </mesh>
            <mesh geometry={nodes.clip.geometry}>
              <meshStandardMaterial color={0x0a0a0a} metalness={0.7} roughness={0.28} envMapIntensity={0.5} />
            </mesh>
            <mesh geometry={nodes.clamp.geometry}>
              <meshStandardMaterial color={0x0a0a0a} metalness={0.7} roughness={0.28} envMapIntensity={0.5} />
            </mesh>
          </group>
        </RigidBody>
      </group>
      <mesh ref={band}>
        <meshLineGeometry />
        <meshLineMaterial
          color="white"
          depthTest={false}
          resolution={isMobile ? [1000, 2000] : [1000, 1000]}
          useMap
          map={texture}
          repeat={[-4, 1]}
          lineWidth={lanyardWidth}
        />
      </mesh>
    </>
  );
}
