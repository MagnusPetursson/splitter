// Generate the procedural sample models shipped with the web UI:
//   bracket_320mm.stl  an L-bracket with a gusset and bolt holes
//   bowl_shell_340mm.stl  a thin-walled hemispherical bowl (shell)
// Usage: node tools/make_samples.mjs web/samples
import fs from 'node:fs';
import path from 'node:path';
import Module from './node_modules/manifold-3d/manifold.js';

const wasm = await Module();
wasm.setup();
const { Manifold, CrossSection } = wasm;
const out = process.argv[2] || 'web/samples';

function stl(M, file) {
  const g = M.getMesh();
  const nt = g.triVerts.length / 3;
  const b = Buffer.alloc(84 + 50 * nt);
  b.write('splitter sample', 0);
  b.writeUInt32LE(nt, 80);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const v = g.triVerts[3 * t + k];
    for (let c = 0; c < 3; c++) b.writeFloatLE(g.vertProperties[g.numProp * v + c], 84 + 50 * t + 12 + 12 * k + 4 * c);
  }
  fs.writeFileSync(path.join(out, file), b);
  console.log(file, nt, 'triangles', M.volume().toFixed(0), 'mm³', 'genus', M.genus());
}

// L-bracket: 320 mm base × 60 mm wide × 12 mm thick, 220 mm upright, gusset.
{
  const base = Manifold.cube([320, 60, 12]);
  const up = Manifold.cube([12, 60, 220]);
  const gus = CrossSection.ofPolygons([[[12, 12], [150, 12], [12, 150]]]).extrude(10).rotate([90, 0, 0]).translate([0, 35, 0]);
  let M = base.add(up).add(gus);
  const hole = (r, h) => Manifold.cylinder(h, r, r, 48);
  for (const x of [60, 200, 290]) M = M.subtract(hole(4.5, 40).translate([x, 30, -5]));
  for (const z of [80, 190]) M = M.subtract(hole(4.5, 40).rotate([0, 90, 0]).translate([-5, 30, z]));
  M = M.subtract(hole(30, 40).rotate([0, 90, 0]).translate([-5, 30, 140]).scale([1, 0.5, 1]).translate([0, 15, 0]));
  stl(M, 'bracket_320mm.stl');
}

// Shallow bowl shell: Ø300 mm rim, 110 mm deep, 5 mm wall, foot ring.
{
  const R = 157, t = 5, depth = 110;
  const outer = Manifold.sphere(R, 160);
  const inner = Manifold.sphere(R - t, 160);
  let M = outer.subtract(inner).trimByPlane([0, 0, -1], 0).trimByPlane([0, 0, 1], -depth); // keep -depth ≤ z ≤ 0
  M = M.add(Manifold.cylinder(10, 55, 55, 128).subtract(Manifold.cylinder(10, 50, 50, 128)).translate([0, 0, -depth - 6]));
  M = M.mirror([0, 0, 1]);
  const b = M.boundingBox();
  M = M.translate([0, 0, -b.min[2]]);
  stl(M, 'bowl_shell_300mm.stl');
}
