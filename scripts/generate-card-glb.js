import * as THREE from 'three';
import { GLTFExporter } from 'three-stdlib';
import fs from 'fs';

const scene = new THREE.Scene();

// Card (main body)
const cardGeo = new THREE.BoxGeometry(1.6, 2.25, 0.05);
const baseMat = new THREE.MeshStandardMaterial({
  color: '#ffffff',
  roughness: 0.9,
  metalness: 0.0,
  map: new THREE.DataTexture(new Uint8Array([255,255,255,255]), 1, 1),
});
const cardMesh = new THREE.Mesh(cardGeo, baseMat);
cardMesh.name = 'card';
cardMesh.position.set(0, 0, 0);

// Clip (metal clip at top)
const clipGeo = new THREE.BoxGeometry(0.5, 0.25, 0.05);
const metalMat = new THREE.MeshStandardMaterial({
  color: '#999999',
  roughness: 0.3,
  metalness: 0.8,
});
const clipMesh = new THREE.Mesh(clipGeo, metalMat);
clipMesh.name = 'clip';
clipMesh.position.set(0, 1.25, 0);

// Clamp
const clampGeo = new THREE.BoxGeometry(0.3, 0.15, 0.05);
const clampMesh = new THREE.Mesh(clampGeo, metalMat);
clampMesh.name = 'clamp';
clampMesh.position.set(0, 1.42, 0);

const group = new THREE.Group();
group.add(cardMesh);
group.add(clipMesh);
group.add(clampMesh);
scene.add(group);

const exporter = new GLTFExporter();
exporter.parse(scene, (glb) => {
  const buffer = glb instanceof ArrayBuffer ? Buffer.from(glb) : Buffer.from(JSON.stringify(glb));
  fs.writeFileSync('/workspace/projects/public/card.glb', buffer);
  console.log('Created card.glb:', buffer.length, 'bytes');
}, (err) => {
  console.error('Error:', err);
}, { binary: true });
