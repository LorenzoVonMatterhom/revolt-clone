import * as THREE from "three";

// NCP stores each face as a surface plane plus three or four edge planes.
// Unlike the render mesh, these are the track author's intended solid surfaces.
export function collisionMesh(buffer, origin = [0, 0, 0]) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 2) throw new Error("Invalid Re-Volt NCP header");
  const count = view.getUint16(0, true);
  if (buffer.byteLength < 2 + count * 112) throw new Error("Truncated Re-Volt NCP faces");
  const positions = [];
  for (let face = 0; face < count; face++) {
    const offset = 2 + face * 112, flags = view.getUint32(offset, true);
    if (flags & (8 | 128)) continue; // Camera-only and no-collision faces.
    const planes = Array.from({ length: 5 }, (_, i) => {
      const at = offset + 8 + i * 16;
      return { normal: new THREE.Vector3(view.getFloat32(at, true), view.getFloat32(at + 4, true), view.getFloat32(at + 8, true)), distance: view.getFloat32(at + 12, true) };
    });
    const corners = [], edgeCount = flags & 1 ? 4 : 3;
    for (let edge = 0; edge < edgeCount; edge++) {
      const a = planes[0], b = planes[edge + 1], c = planes[(edge + 1) % edgeCount + 1];
      const cross = b.normal.clone().cross(c.normal);
      const determinant = a.normal.dot(cross);
      if (Math.abs(determinant) < 1e-8) continue;
      const point = cross.multiplyScalar(-a.distance)
        .addScaledVector(c.normal.clone().cross(a.normal), -b.distance)
        .addScaledVector(a.normal.clone().cross(b.normal), -c.distance)
        .divideScalar(determinant);
      if (!point.toArray().every(Number.isFinite)) throw new Error("Invalid Re-Volt NCP plane");
      corners.push(new THREE.Vector3((point.x - origin[0]) * 0.1, -(point.y - origin[1]) * 0.1, (point.z - origin[2]) * 0.1));
    }
    if (corners.length < 3) continue;
    const normal = new THREE.Vector3(planes[0].normal.x, -planes[0].normal.y, planes[0].normal.z);
    const winding = corners[1].clone().sub(corners[0]).cross(corners[2].clone().sub(corners[0]));
    if (winding.dot(normal) < 0) corners.reverse();
    for (let i = 1; i < corners.length - 1; i++) positions.push(...corners[0].toArray(), ...corners[i].toArray(), ...corners[i + 1].toArray());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}
