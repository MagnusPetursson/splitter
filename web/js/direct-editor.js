// Direct manipulation is an input adapter over the application's accepted plan.
// The preview is disposable; only pointer release submits a geometry request.
import * as THREE from 'three';
import {SceneContext,depthProfile} from './scene-context.js';
const $=id=>document.getElementById(id);
const v3=a=>new THREE.Vector3(...a);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export class DirectEditor {
  constructor(app){
    this.a=app;this.v=app.viewer;this.dom=this.v.renderer.domElement;
    this.ray=new THREE.Raycaster();this.drag=null;this.hover=null;this.context=new SceneContext(this);$('stepJoints').prepend($('pinPopover'));
    const camera=()=>{$('cameraView').value=this.v.cameraPose||'iso';$('viewFace').setAttribute('aria-pressed',String(this.v.cameraPose==='face'));};
    document.addEventListener('viewer-camera',camera);
    this.ghost=new THREE.Mesh(new THREE.RingGeometry(.85,1,48),new THREE.MeshBasicMaterial({color:'#a6e4c9',side:THREE.DoubleSide,depthTest:false,transparent:true}));
    this.ghost.visible=false;this.ghost.renderOrder=30;this.v.scene.add(this.ghost);
    for(const [id,mode] of [['cutMove','translate'],['cutTilt','rotate']])$(id).addEventListener('click',()=>{this.v.cutMode(mode);this.feedback(mode==='rotate'?'Drag a coloured arc to tilt · release to apply · Esc cancels':'Drag the blue arrow along the cut normal · release to apply · Esc cancels');this.sync();});
    $('viewAddJoint').addEventListener('click',()=>{app.setAddMode(!app.S.addMode);this.sync();});
    $('viewFace').addEventListener('click',()=>{if(this.v.view!=='cuts')app.setView('cuts');this.v.faceView(app.S.face);this.feedback('Section view · true-size holes; gold ring marks your selection');});
    $('joinExplode').addEventListener('click',async()=>{
      if(this.v.view==='parts'){app.setView('cuts');this.sync();return;}
      if(!app.S.built)await app.build();
      if(app.S.built){this.v.setExplode(.7);app.setView('parts');this.sync();this.feedback('Exploded inspection · choose Face-on view to edit again');}
    });
    $('editUndo').addEventListener('click',()=>app.restore('undo'));
    $('editRedo').addEventListener('click',()=>app.restore('redo'));
    for(const [event,fn] of [['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','cancel']])this.dom.addEventListener(event,e=>this[fn](e),true);
    this.dom.addEventListener('pointerleave',()=>{if(!this.drag){this.hoverJoint(null);this.ghost.visible=false;this.v.dirty();}});
    document.addEventListener('keydown',e=>{
      if(app.jed.open||e.target.matches('input,textarea,select')||e.target.closest('dialog,[role="dialog"]'))return;
      if(e.key==='Escape'&&(this.drag||app.S.addMode||this.v.tc.dragging)){
        e.preventDefault();e.stopImmediatePropagation();this.cancel();app.setAddMode(false);this.v.cancelCut();this.feedback('Edit cancelled. Nothing changed.');return;
      }
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){
        e.preventDefault();if(this.active()&&!this.drag&&!this.v.tc.dragging)app.restore(e.shiftKey?'redo':'undo');
      }
    },true);
    this.dom.addEventListener('keydown',e=>{
      if(!this.active()||this.step()!=='join')return;
      const js=app.S.plan.joints.filter(j=>app.S.plan.patches[j.patch].node===app.S.face);
      if(e.key==='['||e.key===']'){e.preventDefault();e.stopImmediatePropagation();const i=js.findIndex(j=>j.id===app.S.sel.joint),j=js[(i+(e.key===']'?1:js.length-1)+js.length)%js.length];if(j)app.selectJoint(j.id);}
      if(e.shiftKey&&e.key.startsWith('Arrow')){
        const j=js.find(j=>j.id===app.S.sel.joint);if(!j)return;
        e.preventDefault();e.stopImmediatePropagation();const d={ArrowLeft:[-.5,0],ArrowRight:[.5,0],ArrowUp:[0,.5],ArrowDown:[0,-.5]}[e.key],q=[j.p[0]+d[0],j.p[1]+d[1]],check=this.check(q,j);
        if(check.valid)app.moveJoint(j,q,check.pid);else this.feedback(check.text,false);
      }
    },true);
    this.v.tc.addEventListener('change',()=>{if(this.v.tc.axis)this.dom.style.cursor=this.v.tc.dragging?'grabbing':'grab';});
    this.v.cb.onCutPreview=(text)=>{this.context.cutText=text;this.feedback('Release to apply · Esc cancels');};
  }
  step(){return document.body.dataset.step;}
  active(){return !!this.a.S.plan&&!this.a.S.settingsDirty&&$('busy').classList.contains('hidden')&&!this.dom.closest('[inert]');}
  face(){return this.a.S.plan?.faces.find(f=>f.node===this.a.S.face);}
  feedback(text,valid=true){$('editFeedback').textContent=text;$('editFeedback').dataset.valid=String(valid);}
  sync(){
    const {S,history}=this.a,step=this.step(),join=step==='join',split=step==='split';
    const visible=!!S.plan&&(join||split);
    $('directTools').hidden=!visible;
    for(const id of ['cutMove','cutTilt'])$(id).hidden=!split||S.sel.cut==null;
    for(const id of ['viewAddJoint','joinExplode'])$(id).hidden=!join;
    $('viewFace').hidden=!S.plan?.faces.length||!(join||S.sel.cut!=null);
    $('viewAddJoint').setAttribute('aria-pressed',String(!!S.addMode));
    $('viewAddJoint').textContent=S.addMode?'Stop adding':'Add pin';
    $('viewFace').setAttribute('aria-pressed',String(this.v.cameraPose==='face'));
    $('joinExplode').setAttribute('aria-pressed',String(this.v.view==='parts'));
    $('joinExplode').textContent=this.v.view==='parts'?'Back to joints':'Explode';
    $('editUndo').disabled=!history.past.length||!this.active();$('editRedo').disabled=!history.future.length||!this.active();
    for(const id of ['cutMove','cutTilt','viewAddJoint','viewFace','joinExplode'])$(id).disabled=!this.active();
    $('cutMove').setAttribute('aria-pressed',String(this.v.tc.mode!=='rotate'));$('cutTilt').setAttribute('aria-pressed',String(this.v.tc.mode==='rotate'));
    const changed=this.v.editStep!==step;this.v.editStep=step;
    if(this.v.planMat){this.v.planMat.transparent=join;this.v.planMat.opacity=join ? 0.20 : 1;this.v.planMat.depthWrite=!join;}
    if(this.v.modelMesh)this.v.modelMesh.visible=!this.v.faceFocus;
    if(changed)this.v.highlight();
    this.v.groups.cuts.children.forEach(g=>{g.visible=!join||g.userData.node===S.face;if(g.userData.quad)g.userData.quad.visible=!join;if(g.userData.rim)g.userData.rim.visible=!join;if(g.userData.pivot)g.userData.pivot.visible=!join&&g.userData.node===S.sel.cut;if(g.userData.normalArrow)g.userData.normalArrow.visible=!join&&g.userData.node===S.sel.cut;g.children.filter(o=>o.isSprite).forEach(o=>o.visible=!join);});
    Object.values(this.v.jointMeshes||{}).forEach(m=>{const j=S.plan?.joints.find(j=>j.id===m.userData.joint);m.visible=!join||S.plan?.patches[j?.patch]?.node===S.face;m.scale.set(1,1,1);m.geometry=join?m.userData.footprint:m.userData.volume;m.material=join?m.userData.flat:m.userData.shaded;});
    if(!S.addMode&&!this.drag)this.ghost.visible=false;
    this.v.dirty();this.popover();
  }
  popover(){
    const S=this.a.S,j=S.plan?.joints.find(j=>j.id===S.sel.joint),el=$('pinPopover');
    el.hidden=!j||this.step()!=='join'||this.v.view!=='cuts';
    if(el.hidden){this.popKey=null;if(S.pendingPin){S.pendingPin=false;queueMicrotask(()=>this.a.syncFlow());}return;}
    const key=JSON.stringify([j,document.body.dataset.expert]);if(key===this.popKey)return;this.popKey=key;
    if(S.pendingPin){S.pendingPin=false;queueMicrotask(()=>this.a.syncFlow());}
    const name=this.a.jointName(j),fixed=j.kind==='filament'||['insert','bolt'].includes(j.kind);
    el.innerHTML=`<header><b>${esc(name)}</b><button id="pinClose" aria-label="Deselect pin">×</button></header><div class="pin-fields"><div class="row three"><label>Diameter (mm)<input id="pinDiameter" type="number" min="1" max="30" step="0.25" value="${j.d||3}" ${fixed?'disabled':''}></label><label>Depth (mm)<input id="pinDepth" type="number" min="1" max="60" step="0.5" value="${j.depth||8}"></label><label>Clearance (mm)<input id="pinClearance" type="number" min="0" max="1" step="0.01" value="${j.clear}"></label></div><p class="small mute">Radial clearance for this joint only. ${fixed?'Diameter is fixed by its type; hardware sizes are in Advanced.':''}</p>${this.clearance(j)}${depthProfile(j)}${(j.warnings||[]).map(w=>`<p class="badc">${esc(w)}</p>`).join('')}</div><div class="pin-actions"><p id="pinState" class="small" role="status">Applied · preview shows accepted geometry</p><div class="btns"><button id="pinApply" class="primary" disabled>Apply pin</button><button id="pinDelete" class="danger">Delete pin</button></div></div>`;
    for(const input of el.querySelectorAll('input'))input.oninput=()=>{
      const changed=+$('pinDiameter').value!==j.d||+$('pinDepth').value!==j.depth||Math.abs(+$('pinClearance').value-j.clear)>1e-9;
      const valid=[...el.querySelectorAll('input')].every(i=>i.checkValidity());
      S.pendingPin=changed;$('pinApply').disabled=!changed||!valid;
      $('pinState').textContent=changed?'Not applied · preview still shows accepted geometry':'Applied · preview shows accepted geometry';this.a.syncFlow();
    };
    $('pinClose').onclick=()=>{this.a.selectFace(S.face,true);this.dom.focus();};
    $('pinDelete').onclick=()=>{this.a.deleteJoint(j.id);this.dom.focus();};
    $('pinApply').onclick=()=>{
      const inputs=[...el.querySelectorAll('input')];if(inputs.some(i=>!i.reportValidity()))return;
      const next={...j,d:fixed?j.d:+$('pinDiameter').value,depth:+$('pinDepth').value,clearOverride:+$('pinClearance').value};
      S.pendingPin=false;this.a.editJoint(next);this.dom.focus();
    };
  }
  // Measured edge room against the planner's requirement for this joint.
  clearance(j){
    const dist=this.a.jmap?.distAt?.(j.p),need=j.rreq;
    if(!(Number.isFinite(dist)&&Number.isFinite(need)&&need>0))return '';
    const ok=dist>=need-1e-6;
    return `<p id="pinRoom" class="pin-room" data-ok="${ok}"><b>Edge room ${dist.toFixed(1)} mm</b> measured · ${need.toFixed(1)} mm required. ${ok?'Enough material around this pin.':'Too close to an edge or hole: drag it toward the middle of the face or use a smaller diameter.'}</p>`;
  }
  project(a){const p=v3(a).project(this.v.camera),r=this.dom.getBoundingClientRect();return{x:r.x+(p.x+1)*r.width/2,y:r.y+(1-p.y)*r.height/2,z:p.z};}
  hit(e){
    const S=this.a.S;let found=null,best=22;
    for(const j of S.plan.joints){if(S.plan.patches[j.patch].node!==S.face)continue;const p=this.project(j.origin),d=Math.hypot(e.clientX-p.x,e.clientY-p.y);if(p.z>-1&&p.z<1&&d<best){best=d;found=j;}}
    return found;
  }
  point(e){
    const f=this.face();if(!f)return null;
    const r=this.dom.getBoundingClientRect();this.ray.setFromCamera(new THREE.Vector2((e.clientX-r.x)/r.width*2-1,1-(e.clientY-r.y)/r.height*2),this.v.camera);
    const plane=new THREE.Plane(v3(f.frame.n),-v3(f.frame.n).dot(v3(f.frame.o))),p=this.ray.ray.intersectPlane(plane,new THREE.Vector3());if(!p)return null;
    const d=p.clone().sub(v3(f.frame.o));return{q:[d.dot(v3(f.frame.u)),d.dot(v3(f.frame.v))],world:p};
  }
  check(q,j){
    const {jmap,S}=this.a,pid=jmap.patchAt(q),dist=jmap.distAt(q),proto=j||this.a.protoJoint($('addKind').value),need=proto.rreq||0;
    const overlap=S.plan.joints.find(other=>other.id!==j?.id&&other.patch===pid&&Math.hypot(other.p[0]-q[0],other.p[1]-q[1])<((other.d||3)+(proto.d||3))/2+(other.clear||0)+(proto.clear||0)+1.2);
    const valid=pid!=null&&dist>=need&&!overlap;
    return {pid,valid,text:pid==null?'Outside the cut face or inside a hole — not placed':dist<need?`Too close to an edge or hole: ${dist.toFixed(1)} mm available; ${need.toFixed(1)} mm needed`:overlap?'Too close to another pin — move it farther away':`${q[0].toFixed(1)}, ${q[1].toFixed(1)} mm · edge room ${dist.toFixed(1)} / ${need.toFixed(1)} mm needed · release to apply`};
  }
  hoverJoint(id){
    if(id===this.hover)return;this.hover=id;
    for(const [key,m] of Object.entries(this.v.jointMeshes||{}))m.material.emissive?.set(+key===id||+key===this.a.S.sel.joint?'#8a5b29':'#000');
    this.a.jmap.opts.hover=id;this.a.jmap.draw();
    if(this.a.jed.open){this.a.jed.map.opts.hover=id;this.a.jed.map.draw();}
    this.v.dirty();
  }
  down(e){
    if(!this.active()||this.step()!=='join'||this.v.view!=='cuts'||e.button!==0)return;
    const j=this.a.S.addMode?null:this.hit(e);if(!j&&!this.a.S.addMode)return;
    const pos=this.point(e);if(!pos)return;
    e.preventDefault();e.stopImmediatePropagation();this.dom.focus();this.dom.setPointerCapture(e.pointerId);this.v.controls.enabled=false;
    if(j)this.a.selectJoint(j.id);
    this.drag={j,origin:j?.origin.slice(),start:[e.clientX,e.clientY],offset:j?[j.p[0]-pos.q[0],j.p[1]-pos.q[1]]:[0,0],moved:false,pointer:e.pointerId};
    this.move(e);
  }
  move(e){
    if(!this.active()||this.step()!=='join'||this.v.view!=='cuts')return;
    if(!this.drag&&!this.a.S.addMode){const j=this.hit(e);this.hoverJoint(j?.id??null);this.dom.style.cursor=j?'grab':'';return;}
    const p=this.point(e);if(!p)return;
    if(this.drag){e.stopImmediatePropagation();p.q=p.q.map((x,k)=>x+this.drag.offset[k]);this.drag.moved ||= Math.hypot(e.clientX-this.drag.start[0],e.clientY-this.drag.start[1])>3;if(this.drag.moved)$('pinPopover').hidden=true;}
    const j=this.drag?.j,check=this.check(p.q,j),fr=this.face().frame;
    const world=v3(fr.o).addScaledVector(v3(fr.u),p.q[0]).addScaledVector(v3(fr.v),p.q[1]);
    this.preview={...p,world,check};
    const need=j?.rreq||this.a.protoJoint($('addKind').value).rreq;
    this.ghost.position.copy(world);this.ghost.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),v3(fr.n));this.ghost.scale.setScalar(need);this.ghost.visible=true;this.ghost.material.color.set(check.valid?'#a6e4c9':'#ff655b');
    if(j&&this.drag.moved){const m=this.v.jointMeshes[j.id];m.position.copy(world);m.material.color.set(check.valid?'#a6e4c9':'#ff655b');}
    this.dom.style.cursor=this.drag?'grabbing':'crosshair';this.feedback(check.text,check.valid);this.v.dirty();
  }
  up(e){
    if(!this.drag)return;e.preventDefault();e.stopImmediatePropagation();
    const drag=this.drag,preview=this.preview;this.cancel();
    if(!preview)return;
    if(!preview.check.valid){this.feedback(preview.check.text,false);return;}
    if(drag.j){if(drag.moved)this.a.moveJoint(drag.j,preview.q,preview.check.pid);}
    else {this.a.setAddMode(false);this.a.addJoint(preview.check.pid,preview.q);}
  }
  cancel(){
    const d=this.drag;if(d?.j&&this.v.jointMeshes[d.j.id])this.v.jointMeshes[d.j.id].position.set(...d.origin);
    if(d&&this.dom.hasPointerCapture(d.pointer))this.dom.releasePointerCapture(d.pointer);
    this.drag=null;this.preview=null;this.ghost.visible=false;this.v.controls.enabled=true;this.dom.style.cursor='';this.popover();this.v.dirty();
  }
}
