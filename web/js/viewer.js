// three.js viewport: model + build volume, cut planes, joints, parts, plates.
import * as THREE from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { TransformControls } from '../vendor/three/TransformControls.js';

export const PALETTE = ['#e07a3f', '#3fa7e0', '#7bc96f', '#c96fb8', '#e0c23f', '#6f8fc9', '#c9786f', '#4fc9b0', '#a3a3e0', '#e09f9f', '#9fe0c6', '#d4a373'];
export const KIND_COLORS = { dowel: '#f5f5f5', press: '#ffd166', filament: '#bde0fe', peg: '#90e0a0', keyed: '#5cc98a', magnet: '#c77dff', insert: '#f4a261', bolt: '#e76f51', snap: '#4cc9f0' };

export function partColor(i) { return PALETTE[i % PALETTE.length]; }

// identical to Go geom.AlignToDown / PrintTransform
export function printMatrix(down, angle) {
  const l = Math.hypot(...down); const d = down.map((x) => x / l);
  const c = -d[2];
  let R;
  if (c > 1 - 1e-12) R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  else if (c < -1 + 1e-12) R = [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
  else {
    let ax = [-d[1], d[0], 0]; const al = Math.hypot(...ax); ax = ax.map((x) => x / al);
    const s = Math.sqrt(1 - c * c), [x, y, z] = ax, C = 1 - c;
    R = [[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]];
  }
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const Z = [[ca, -sa, 0], [sa, ca, 0], [0, 0, 1]];
  const M = Z.map((r) => [0, 1, 2].map((j) => r[0] * R[0][j] + r[1] * R[1][j] + r[2] * R[2][j]));
  return new THREE.Matrix4().set(M[0][0], M[0][1], M[0][2], 0, M[1][0], M[1][1], M[1][2], 0, M[2][0], M[2][1], M[2][2], 0, 0, 0, 0, 1);
}

function geomFrom(positions, indices, flat = true) {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  if (flat) g = g.toNonIndexed();
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function outOfBedMaterial(color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide, vertexColors: false });
  mat.userData.uniforms = { boxMin: { value: new THREE.Vector3(-1e9, -1e9, -1e9) }, boxMax: { value: new THREE.Vector3(1e9, 1e9, 1e9) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, mat.userData.uniforms);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;\nuniform vec3 boxMin;\nuniform vec3 boxMax;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        bool outside = any(lessThan(vWorldP, boxMin)) || any(greaterThan(vWorldP, boxMax));
        if (outside) { float s = step(0.5, fract((vWorldP.x + vWorldP.y + vWorldP.z) * 0.12)); gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(vec3(0.95,0.25,0.2), vec3(0.75,0.15,0.12), s), 0.75); }`);
  };
  return mat;
}

function makeLabel(text, size) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#e07a3f';
  x.beginPath(); x.roundRect(4, 8, 120, 48, 14); x.fill();
  x.fillStyle = '#fff'; x.font = 'bold 34px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 64, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(size * 2, size, 1);
  sp.renderOrder = 20;
  return sp;
}

export class Viewer {
  constructor(el, cb = {}) {
    this.el = el;
    this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#101819');
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 20000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(400, -500, 380);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',e=>{this.controls.enableDamping=!e.matches;});
    this.controls.addEventListener('change', () => this.dirty());
    const hemi = new THREE.HemisphereLight('#dfe8f2', '#30261f', 1.4);
    hemi.position.set(0, 0, 1);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 1.6);
    this.sun.position.set(0.6, -0.8, 1.4);
    this.scene.add(this.sun);
    this.camLight = new THREE.DirectionalLight('#ffffff', 0.7);
    this.camera.add(this.camLight);
    this.scene.add(this.camera);
    this.groups = {};
    for (const n of ['bed', 'model', 'cuts', 'joints', 'parts', 'plates']) {
      this.groups[n] = new THREE.Group();
      this.scene.add(this.groups[n]);
    }
    this.tc = new TransformControls(this.camera, this.renderer.domElement);
    this.tc.setSpace('local');
    this.tc.showX = false; this.tc.showY = false;
    this.tc.setSize(1.05);
    this.tcHelper = this.tc.getHelper();
    this.scene.add(this.tcHelper);
    this.tc.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if(e.value){this.cutChanged=false;this.cutCancelled=false;this._cutWasDrag=true;}
      else if(this.dragNode!=null&&this.cutChanged&&!this.cutCancelled)this.cb.onCutDragEnd?.(this.dragNode,this.dragD,this.dragNormal);
    });
    this.tc.addEventListener('objectChange', () => this.onTCChange());
    this.tc.addEventListener('change', () => this.dirty());
    this.raycaster = new THREE.Raycaster();
    this.view = 'model';
    this.explode = 0.35;
    this.sel = {};
    this._down = null;
    const dom = this.renderer.domElement;
    dom.tabIndex = 0;
    dom.setAttribute('role', 'img');
    dom.setAttribute('aria-label', 'Interactive 3D model. Arrow keys orbit, Shift and arrows pan, plus and minus zoom, F fits. Cut and part buttons in Split provide an accessible selection alternative.');
    dom.addEventListener('keydown', e => this.cameraKey(e));
    dom.addEventListener('pointerdown', (e) => { this._down = [e.clientX, e.clientY]; });
    dom.addEventListener('pointerup', (e) => {
      const wasCutDrag=this.tc.dragging||this._cutWasDrag;this._cutWasDrag=false;
      if (wasCutDrag||!this._down || Math.hypot(e.clientX - this._down[0], e.clientY - this._down[1]) > 4) return;
      this.pick(e);
    });
    new ResizeObserver(() => this.resize()).observe(el);
    this.resize();
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      if (this._dirty) {
        this.groups.cuts.traverse(o=>{if(o.isSprite){const pos=o.getWorldPosition(new THREE.Vector3()),size=this.camera.position.distanceTo(pos)*2*Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2))*24/this.renderer.domElement.clientHeight;o.scale.set(size*2,size,1);}});
        this._dirty = false; this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  dirty() { this._dirty = true; }

  clearAll(){for(const k of Object.keys(this.groups))this.clear(k);this.tc.detach();this.box=null;this.modelMesh=null;this.modelGeom=null;this.modelIndexed=null;this.plan=null;this.cutMeshes={};this.jointMeshes={};this.partMeshes=[];this.dirty();}

  cutMode(mode){this.tc.setMode(mode);this.tc.showX=mode==='rotate';this.tc.showY=mode==='rotate';this.tc.showZ=mode!=='rotate';this.highlight();}

  cancelCut(){
    if(!this.tc.dragging)return false;
    this.cutCancelled=true;this.tc.reset();this.tc.dragging=false;
    const g=this.cutMeshes[this.dragNode];if(g&&this.tcStart){g.position.copy(this.tcStart.grpPos);g.quaternion.copy(this.tcStart.quat);}
    this.controls.enabled=true;this.highlight();return true;
  }

  faceView(node){
    const f=this.plan?.faces.find(f=>f.node===node);if(!f)return;
    const points=f.loops.flat(),u0=Math.min(...points.map(p=>p[0])),u1=Math.max(...points.map(p=>p[0])),v0=Math.min(...points.map(p=>p[1])),v1=Math.max(...points.map(p=>p[1]));
    const fr=f.frame,c=new THREE.Vector3(...fr.o).addScaledVector(new THREE.Vector3(...fr.u),(u0+u1)/2).addScaledVector(new THREE.Vector3(...fr.v),(v0+v1)/2);
    const distance=Math.max((v1-v0)*1.5,(u1-u0)/this.camera.aspect)*1.65;
    this.faceFocus=true;this.modelMesh.visible=false;
    this.camera.up.set(...fr.v);this.controls._quat.setFromUnitVectors(this.camera.up,new THREE.Vector3(0,1,0));this.controls._quatInverse.copy(this.controls._quat).invert();this.camera.position.copy(c).addScaledVector(new THREE.Vector3(...fr.n),Math.max(20,distance));this.controls.target.copy(c);this.controls.update();this.dirty();
  }

  frameCurrent() { this.frame(this.view === 'plates' ? this.platesBox : this.view === 'parts' ? this.explodedBox() : this.box); }

  cameraView(view) {
    if (!this.box) return;
    this.frameCurrent();
    const c = this.controls.target, d = this.camera.position.distanceTo(c);
    const dirs = {top:[0,-.001,1],front:[0,-1,0],right:[1,0,0]};
    if (dirs[view]) this.camera.position.copy(c).addScaledVector(new THREE.Vector3(...dirs[view]).normalize(),d);
    this.controls.update(); this.dirty();
  }

  cameraKey(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const delta = this.camera.position.clone().sub(this.controls.target), r = delta.length();
    if (e.key === 'f' || e.key === 'F') {e.preventDefault();this.frameCurrent();return;}
    if (['+','=','-','_'].includes(e.key)) {
      e.preventDefault();this.camera.position.copy(this.controls.target).addScaledVector(delta, e.key==='-'||e.key==='_'?1.15:1/1.15);
    } else if(e.key.startsWith('Arrow')) {
      e.preventDefault();
      const dx=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0,dy=e.key==='ArrowUp'?1:e.key==='ArrowDown'?-1:0;
      if(e.shiftKey) {
        const v=new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,0).multiplyScalar(dx*r*.025).addScaledVector(new THREE.Vector3().setFromMatrixColumn(this.camera.matrix,1),dy*r*.025);
        this.camera.position.add(v);this.controls.target.add(v);
      } else {
        const theta=Math.atan2(delta.y,delta.x)+dx*.12,phi=THREE.MathUtils.clamp(Math.acos(delta.z/r)-dy*.12,.05,Math.PI-.05);
        this.camera.position.copy(this.controls.target).add(new THREE.Vector3(r*Math.sin(phi)*Math.cos(theta),r*Math.sin(phi)*Math.sin(theta),r*Math.cos(phi)));
      }
    } else return;
    this.controls.update();this.dirty();
  }

  resize() {
    const w = this.el.clientWidth || 800, h = this.el.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty();
  }

  clear(g) {
    const grp = this.groups[g];
    while (grp.children.length) {
      const c = grp.children.pop();
      c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.dispose) o.material.dispose(); });
    }
  }

  // ---------- model + bed ----------
  setModel(positions, indices) {
    this.clear('model'); this.clear('cuts'); this.clear('joints'); this.clear('parts'); this.clear('plates');
    this.modelGeom = geomFrom(positions, indices, true);
    this.modelIndexed = { positions, indices };
    this.modelMat = outOfBedMaterial('#b8c4cf');
    this.modelMesh = new THREE.Mesh(this.modelGeom, this.modelMat);
    this.groups.model.add(this.modelMesh);
    this.box = this.modelGeom.boundingBox.clone();
    this.center = this.box.getCenter(new THREE.Vector3());
    this.frame();
    this.updateBed();
    this.dirty();
  }

  frame(box = this.box) {
    if (!box) return;
    this.faceFocus=false;if(this.modelMesh)this.modelMesh.visible=true;
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() * 0.5 || 100;
    this.camera.up.set(0,0,1);this.controls._quat.setFromUnitVectors(this.camera.up,new THREE.Vector3(0,1,0));this.controls._quatInverse.copy(this.controls._quat).invert();
    const dir = new THREE.Vector3(0.75, -1.05, 0.8).normalize();
    // 2.9 r fits the vertical 40° field; a tall, narrow view (the 3D view
    // beside the joint editor, phones) must back off by the aspect ratio
    const aspect = this.camera.aspect || 1;
    this.camera.position.copy(c).addScaledVector(dir, r * 2.9 * Math.max(1, 1.25 / aspect));
    this.camera.near = r / 50; this.camera.far = r * 60;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(c);
    this.controls.update();
    this.dirty();
  }

  setBed(x, y, z) { this.bed = { x, y, z }; this.updateBed(); }

  updateBed() {
    this.clear('bed');
    if (!this.bed || !this.box) return;
    const { x, y, z } = this.bed;
    if (this.view === 'plates') return;
    const c = this.center, zmin = this.box.min.z;
    const min = new THREE.Vector3(c.x - x / 2, c.y - y / 2, zmin);
    const max = new THREE.Vector3(c.x + x / 2, c.y + y / 2, zmin + z);
    const g = new THREE.BoxGeometry(x, y, z);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: '#3fa7e0', transparent: true, opacity: 0.8 }));
    edges.position.set(c.x, c.y, zmin + z / 2);
    this.groups.bed.add(edges);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(x, y), new THREE.MeshBasicMaterial({ color: '#1b3a52', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    plate.position.set(c.x, c.y, zmin - 0.05);
    this.groups.bed.add(plate);
    const grid = new THREE.GridHelper(Math.max(x, y), Math.round(Math.max(x, y) / 10), '#2c4a62', '#20354a');
    grid.rotation.x = Math.PI / 2;
    grid.position.set(c.x, c.y, zmin - 0.02);
    grid.scale.set(x / Math.max(x, y), 1, y / Math.max(x, y));
    this.groups.bed.add(grid);
    const u = this.modelMat && this.modelMat.userData.uniforms;
    if (u) {
      u.boxMin.value.copy(min).addScalar(-0.01);
      u.boxMax.value.copy(max).addScalar(0.01);
    }
    this.groups.bed.visible = this.view === 'model';
    this.dirty();
  }

  fitsAsIs() {
    if (!this.box || !this.bed) return null;
    const s = this.box.getSize(new THREE.Vector3());
    return { size: s, fits: s.x <= this.bed.x && s.y <= this.bed.y && s.z <= this.bed.z };
  }

  // ---------- plan (cuts + joints) ----------
  setPlan(plan) {
    this.plan = plan;
    this.clear('cuts'); this.clear('joints');
    this.tc.detach();
    if (!plan || !this.modelIndexed) return;
    const tree = plan.tree;
    const leafIndex = {};
    plan.leaves.forEach((l, i) => { leafIndex[l.id] = i; });
    this.leafIndex = leafIndex;
    // colour the model by part (triangle centroid → leaf)
    const pos = this.modelGeom.attributes.position.array;
    const n = pos.length / 9;
    const colors = new Float32Array(pos.length);
    const cols = plan.leaves.map((_, i) => new THREE.Color(partColor(i)));
    for (let t = 0; t < n; t++) {
      const o = t * 9;
      const p = [(pos[o] + pos[o + 3] + pos[o + 6]) / 3, (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3, (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3];
      let id = tree.root;
      for (let g = 0; g < 64; g++) {
        const nd = tree.nodes[id];
        if (!nd.cut) break;
        const v = nd.cut.n[0] * p[0] + nd.cut.n[1] * p[1] + nd.cut.n[2] * p[2] - nd.cut.d;
        id = v < 0 ? nd.neg : nd.pos;
      }
      const c = cols[leafIndex[id]] || cols[0];
      for (let k = 0; k < 3; k++) { colors[o + 3 * k] = c.r; colors[o + 3 * k + 1] = c.g; colors[o + 3 * k + 2] = c.b; }
    }
    this.modelGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // opaque, so the parts read clearly; joints are drawn on top instead
    this.planMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.05, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.cutMeshes = {};
    for (const f of plan.faces) {
      if (!f.loops || !f.loops.length) continue;
      const fr = f.frame;
      const U = new THREE.Vector3(...fr.u), V = new THREE.Vector3(...fr.v), N = new THREE.Vector3(...fr.n), O = new THREE.Vector3(...fr.o);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const l of f.loops) for (const p of l) { u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]); }
      const pad = 0.08 * Math.max(u1 - u0, v1 - v0) + 4;
      u0 -= pad; u1 += pad; v0 -= pad; v1 += pad;
      const grp = new THREE.Group();
      const basis = new THREE.Matrix4().makeBasis(U, V, N);
      grp.quaternion.setFromRotationMatrix(basis);
      grp.position.copy(O);
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(u1 - u0, v1 - v0), new THREE.MeshBasicMaterial({ color: '#ffd9b8', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      quad.position.set((u0 + u1) / 2, (v0 + v1) / 2, 0);
      quad.userData = { pick: 'cut', node: f.node };
      grp.add(quad);
      const rim = new THREE.LineSegments(new THREE.EdgesGeometry(quad.geometry), new THREE.LineBasicMaterial({ color: '#e07a3f' }));
      rim.position.copy(quad.position);
      grp.add(rim);
      // section outline
      const pts = [];
      for (const l of f.loops) {
        for (let i = 0; i < l.length; i++) {
          const a = l[i], b = l[(i + 1) % l.length];
          pts.push(a[0], a[1], 0.05, b[0], b[1], 0.05, a[0], a[1], -0.05, b[0], b[1], -0.05);
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const outline = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#fff3e6' }));
      grp.add(outline);
      // Fill actual material, not its bounding rectangle; nested loops retain holes.
      const inside=(p,loop)=>{let yes=false;for(let i=0,j=loop.length-1;i<loop.length;j=i++){const a=loop[i],b=loop[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
      const loops=f.loops.map(l=>l.map(p=>new THREE.Vector2(...p))),depth=f.loops.map(l=>f.loops.filter(other=>other!==l&&inside(l[0],other)).length);
      loops.forEach((l,i)=>{if(depth[i]%2)return;const shape=new THREE.Shape(l);loops.forEach((hole,j)=>{if(depth[j]===depth[i]+1&&inside(f.loops[j][0],f.loops[i]))shape.holes.push(new THREE.Path(hole));});const cap=new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color:'#496f66',side:THREE.DoubleSide,transparent:true,opacity:.72,depthWrite:false}));cap.userData={pick:'cut',node:f.node,tag:'material'};cap.renderOrder=3;grp.add(cap);});

      const label = makeLabel(document.body.dataset.expert==='true'?(plan.tree.nodes[f.node].label || `C${f.node}`):`Cut ${plan.faces.indexOf(f)+1}`, Math.max(8, 0.06 * Math.max(u1 - u0, v1 - v0)));
      label.position.set(u1, v1, 0);
      grp.add(label);
      grp.userData = { node: f.node, n: N.clone(), d: plan.tree.nodes[f.node].cut.d, quad, rim, center: new THREE.Vector3((u0 + u1) / 2, (v0 + v1) / 2, 0) };
      this.groups.cuts.add(grp);
      this.cutMeshes[f.node] = grp;
    }
    // joints
    this.jointMeshes = {};
    const faceBy = {};
    for (const f of plan.faces) faceBy[f.node] = f;
    for (const j of plan.joints) {
      const r = Math.max(0.9, (j.d || 3) / 2);
      const h = Math.max(2, j.holeNeg + j.holePos);
      const g = new THREE.CylinderGeometry(r, r, h, 20);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, (j.holePos - j.holeNeg) / 2);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: (j.warnings && j.warnings.length) ? '#e0564a' : (KIND_COLORS[j.kind] || '#fff'), roughness: 0.4, emissive: '#000', depthTest: false, transparent: true, opacity: 0.95 }));
      m.renderOrder = 10;
      const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(...j.x), new THREE.Vector3(...j.y), new THREE.Vector3(...j.z));
      m.quaternion.setFromRotationMatrix(basis);
      m.position.set(...j.origin);
      m.userData = { pick: 'joint', joint: j.id };
      this.groups.joints.add(m);
      this.jointMeshes[j.id] = m;
    }
    // seam outlines (dashed rim of the patch)
    for (const p of plan.patches) {
      if (!p.seam || p.seam.kind === 'none') continue;
      const f = faceBy[p.node];
      if (!f) continue;
      const fr = f.frame;
      const c = new THREE.Vector3(...fr.o).addScaledVector(new THREE.Vector3(...fr.u), p.centroid[0]).addScaledVector(new THREE.Vector3(...fr.v), p.centroid[1]);
      const s = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.5, Math.sqrt(p.area) / 25), 16, 12), new THREE.MeshStandardMaterial({ color: '#4cc9f0', depthTest: false, transparent: true }));
      s.renderOrder = 10;
      s.position.copy(c);
      s.userData = { pick: 'patch', patch: p.id };
      this.groups.joints.add(s);
    }
    this.applyView();
    this.highlight();
  }

  // ---------- built parts ----------
  setParts(parts, plan) {
    this.clear('parts'); this.clear('plates');
    this.parts = parts;
    this.plan = plan;
    const leafIndex = {};
    plan.leaves.forEach((l, i) => { leafIndex[l.id] = i; });
    this.partMeshes = [];
    for (const p of parts) {
      const g = geomFrom(p.mesh.positions, p.mesh.indices, true);
      const col = partColor(leafIndex[p.leaf] || 0);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.05 }));
      const c = g.boundingBox.getCenter(new THREE.Vector3());
      m.userData = { pick: 'part', leaf: p.leaf, label: p.label, center: c };
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 35), new THREE.LineBasicMaterial({ color: '#0b0e12', transparent: true, opacity: 0.35 }));
      m.add(edges);
      this.groups.parts.add(m);
      this.partMeshes.push(m);
    }
    this.applyExplode();
    this.buildPlates(parts, plan);
    this.applyView();
  }

  setExplode(f) { this.explode = f; this.applyExplode(); }

  applyExplode() {
    if (!this.partMeshes || !this.center || !this.plan) return;
    // every contact patch wants its two parts separated by `step` along its
    // cut normal; relax the constraints (Gauss–Seidel) so gaps come out even
    // even when cuts are nested
    const r = this.box.getSize(new THREE.Vector3()).length() * 0.5;
    const step = this.explode * r * 0.3;
    const off = {};
    for (const l of this.plan.leaves) off[l.id] = new THREE.Vector3();
    const cons = this.plan.patches.map((p) => ({ a: p.negLeaf, b: p.posLeaf, n: new THREE.Vector3(...this.plan.tree.nodes[p.node].cut.n) }));
    for (let it = 0; it < 200; it++) {
      for (const c of cons) {
        const g = off[c.b].clone().sub(off[c.a]).dot(c.n);
        const dlt = (step - g) / 2;
        off[c.b].addScaledVector(c.n, dlt);
        off[c.a].addScaledVector(c.n, -dlt);
      }
    }
    const mean = new THREE.Vector3();
    const ids = Object.keys(off);
    for (const k of ids) mean.add(off[k]);
    mean.multiplyScalar(1 / Math.max(1, ids.length));
    for (const m of this.partMeshes) m.position.copy(off[m.userData.leaf] || new THREE.Vector3()).sub(mean);
    this.dirty();
  }

  explodedBox() {
    const b = new THREE.Box3();
    for (const m of this.partMeshes || []) { m.updateMatrixWorld(); b.expandByObject(m); }
    return b.isEmpty() ? this.box : b;
  }

  // plates: same orientation + shelf packing as the Go exporter
  buildPlates(parts, plan) {
    this.clear('plates');
    const bed = plan.usable;
    const leafBy = {};
    plan.leaves.forEach((l, i) => { leafBy[l.id] = { ...l, idx: i }; });
    const items = [];
    for (const p of parts) {
      const l = leafBy[p.leaf];
      const g = geomFrom(p.mesh.positions, p.mesh.indices, true);
      g.applyMatrix4(printMatrix(l.down, l.angle));
      g.computeBoundingBox();
      const bb = g.boundingBox;
      g.translate(-bb.min.x, -bb.min.y, -bb.min.z);
      const s = bb.getSize(new THREE.Vector3());
      items.push({ g, w: s.x, h: s.y, color: partColor(l.idx), label: p.label });
    }
    for (const pin of (this.pins || [])) {
      for (let k = 0; k < pin.count; k++) {
        const g = geomFrom(pin.mesh.positions, pin.mesh.indices, true);
        g.computeBoundingBox();
        const s = g.boundingBox.getSize(new THREE.Vector3());
        items.push({ g: k === 0 ? g : g.clone(), w: s.x, h: s.y, color: '#f5f5f5', label: 'pin' });
      }
    }
    const placed = pack(items, bed.X, bed.Y, 6);
    const nPl = Math.max(0, ...placed.map((p) => p.plate + 1));
    const gap = 40;
    for (let k = 0; k < nPl; k++) {
      const ox = k * (bed.X + gap);
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(bed.X, bed.Y), new THREE.MeshBasicMaterial({ color: '#1b3a52', side: THREE.DoubleSide }));
      plate.position.set(ox + bed.X / 2, bed.Y / 2, -0.1);
      this.groups.plates.add(plate);
      const grid = new THREE.GridHelper(Math.max(bed.X, bed.Y), Math.round(Math.max(bed.X, bed.Y) / 10), '#2c4a62', '#24405a');
      grid.rotation.x = Math.PI / 2;
      grid.scale.set(bed.X / Math.max(bed.X, bed.Y), 1, bed.Y / Math.max(bed.X, bed.Y));
      grid.position.set(ox + bed.X / 2, bed.Y / 2, -0.05);
      this.groups.plates.add(grid);
      const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(bed.X, bed.Y, bed.Z)), new THREE.LineBasicMaterial({ color: '#3fa7e0', transparent: true, opacity: 0.12, depthTest: true }));
      box.position.set(ox + bed.X / 2, bed.Y / 2, bed.Z / 2);
      this.groups.plates.add(box);
    }
    for (const pc of placed) {
      const it = pc.item;
      const m = new THREE.Mesh(it.g, new THREE.MeshStandardMaterial({ color: it.color, roughness: 0.55 }));
      if (pc.rot) { m.rotation.z = Math.PI / 2; m.position.set(it.h, 0, 0); }
      m.position.x += pc.x + pc.plate * (bed.X + gap);
      m.position.y += pc.y;
      this.groups.plates.add(m);
    }
    this.plateCount = nPl;
    this.platesBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(nPl * (bed.X + gap), bed.Y, bed.Z * 0.6));
  }

  // ---------- views & selection ----------
  setView(v) {
    this.faceFocus=false;if(this.modelMesh)this.modelMesh.visible=true;
    this.view = v;
    this.applyView();
    if (v === 'plates' && this.platesBox) this.frame(this.platesBox);
    else if (v === 'parts' && this.partMeshes) this.frame(this.explodedBox());
    else if (this.box) this.frame(this.box);
    this.updateBed();
  }

  applyView() {
    const v = this.view;
    const g = this.groups;
    g.bed.visible = v === 'model';
    g.model.visible = v === 'model' || v === 'cuts';
    g.cuts.visible = v === 'cuts';
    g.joints.visible = v === 'cuts' || (v === 'parts' && this.explode < 0.02);
    g.parts.visible = v === 'parts';
    g.plates.visible = v === 'plates';
    if (this.modelMesh) {
      if (v === 'cuts' && this.planMat) this.modelMesh.material = this.planMat;
      else this.modelMesh.material = this.modelMat;
    }
    this.tcHelper.visible = v === 'cuts';
    this.dirty();
  }

  select(sel) {
    this.sel = sel || {};
    this.highlight();
  }

  highlight() {
    if (this.cutMeshes) {
      for (const [node, grp] of Object.entries(this.cutMeshes)) {
        const on = this.sel.cut === +node;
        grp.userData.quad.material.opacity = on ? 0.32 : 0.14;
        grp.userData.rim.material.color.set(on ? '#ffffff' : '#e07a3f');
      }
    }
    if (this.jointMeshes) {
      for (const [id, m] of Object.entries(this.jointMeshes)) m.material.emissive.set(this.sel.joint === +id ? '#e07a3f' : '#000000');
    }
    // transform gizmo on the selected cut
    this.tc.detach();
    this.dragNode = null;
    if (this.editStep!=='join' && this.sel.cut != null && this.cutMeshes && this.cutMeshes[this.sel.cut] && this.view === 'cuts') {
      const grp = this.cutMeshes[this.sel.cut];
      if (!this.tcObj) { this.tcObj = new THREE.Object3D(); this.scene.add(this.tcObj); }
      const world = grp.userData.center.clone().applyQuaternion(grp.quaternion).add(grp.position);
      this.tcObj.position.copy(world);
      this.tcObj.quaternion.copy(grp.quaternion);
      this.tcStart = { pos: world.clone(), grpPos: grp.position.clone(), d: grp.userData.d, quat:grp.quaternion.clone() };
      this.dragNormal=null;
      this.tc.attach(this.tcObj);
      this.dragNode = this.sel.cut;
      this.dragD = grp.userData.d;
    }
    this.dirty();
  }

  onTCChange() {
    if (this.dragNode == null) return;
    const grp = this.cutMeshes[this.dragNode];
    if(this.tc.mode==='rotate'){
      const normal=new THREE.Vector3(0,0,1).applyQuaternion(this.tcObj.quaternion).normalize();
      const rotation=this.tcObj.quaternion.clone().multiply(this.tcStart.quat.clone().invert());
      grp.quaternion.copy(this.tcObj.quaternion);
      grp.position.copy(this.tcStart.grpPos).sub(this.tcStart.pos).applyQuaternion(rotation).add(this.tcStart.pos);
      this.dragNormal=normal.toArray();this.dragD=normal.dot(this.tcStart.pos);
      const degrees=THREE.MathUtils.radToDeg(this.tcStart.quat.angleTo(this.tcObj.quaternion));
      this.cutChanged=degrees>.001;this.cb.onCutPreview?.(`Tilt ${degrees.toFixed(1)}° · release to apply · Esc cancels`);return;
    }
    const n = grp.userData.n;
    const delta = this.tcObj.position.clone().sub(this.tcStart.pos).dot(n);
    // constrain the helper to the normal
    this.tcObj.position.copy(this.tcStart.pos).addScaledVector(n, delta);
    grp.position.copy(this.tcStart.grpPos).addScaledVector(n, delta);
    this.dragD = this.tcStart.d + delta;this.cutChanged=Math.abs(delta)>.001;
    this.cb.onCutPreview?.(`Offset ${this.dragD.toFixed(1)} mm · ${delta>=0?'+':''}${delta.toFixed(1)} mm · release to apply · Esc cancels`);
    this.cb.onCutDrag && this.cb.onCutDrag(this.dragNode, this.dragD);
  }

  pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    const targets = [];
    if (this.view === 'cuts') { targets.push(this.groups.joints, this.groups.cuts); }
    if (this.view === 'parts') targets.push(this.groups.parts);
    const hits = this.raycaster.intersectObjects(targets, true).filter(h=>h.object.userData?.pick&&h.object.visible&&h.object.parent?.visible);
    // prefer joints over cut quads when both are hit
    hits.sort((a, b) => (a.object.userData.pick === 'joint' ? -1 : 0) - (b.object.userData.pick === 'joint' ? -1 : 0) || a.distance - b.distance);
    const h = hits[0];
    if(!h&&this.view==='cuts'&&this.modelMesh){
      const hit=this.raycaster.intersectObject(this.modelMesh)[0];if(hit){let leaf=this.plan.tree.root;for(let k=0;k<64;k++){const n=this.plan.tree.nodes[leaf];if(!n.cut)break;leaf=new THREE.Vector3(...n.cut.n).dot(hit.point)<n.cut.d?n.neg:n.pos;}this.cb.onPick?.({pick:'part',leaf,point:hit.point.toArray()});return;}
    }
    this.cb.onPick && this.cb.onPick(h ? { ...h.object.userData, point: h.point.toArray() } : null, e);
  }

  snapshot(w = 1400, h = 900, light = false) {
    const old = this.renderer.getSize(new THREE.Vector2());
    const bg = this.scene.background;
    if (light) this.scene.background = new THREE.Color('#f4f6f8');
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const helper = this.tcHelper.visible;
    this.tcHelper.visible = false;
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.tcHelper.visible = helper;
    this.scene.background = bg;
    this.renderer.setSize(old.x, old.y, false);
    this.camera.aspect = old.x / old.y; this.camera.updateProjectionMatrix();
    this.dirty();
    return url;
  }
}

// shelf packing identical to the Go exporter (internal/export.Pack)
export function pack(items, bedX, bedY, gap) {
  const sorted = items.slice().sort((a, b) => b.w * b.h - a.w * a.h);
  const plates = [];
  const out = [];
  const place = (it) => {
    for (let pi = 0; pi < plates.length; pi++) {
      const p = plates[pi];
      for (const rot of [false, true]) {
        let w = it.w, h = it.h;
        if (rot) [w, h] = [h, w];
        if (w > bedX + 1e-6 || h > bedY + 1e-6) continue;
        for (const s of p) {
          if (s.x + w <= bedX + 1e-6 && h <= s.h + 1e-6) { out.push({ item: it, plate: pi, x: s.x, y: s.y, rot }); s.x += w + gap; return true; }
        }
        const top = p.length ? p[p.length - 1].y + p[p.length - 1].h + gap : 0;
        if (top + h <= bedY + 1e-6) { p.push({ y: top, h, x: w + gap }); out.push({ item: it, plate: pi, x: 0, y: top, rot }); return true; }
      }
    }
    return false;
  };
  for (const it of sorted) {
    if (place(it)) continue;
    plates.push([]);
    if (!place(it)) out.push({ item: it, plate: plates.length - 1, x: 0, y: 0, rot: false });
  }
  return out;
}
