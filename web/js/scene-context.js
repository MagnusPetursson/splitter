// Screen-space annotations are projected from the real model, not a second plan.
import * as THREE from 'three';
const $=id=>document.getElementById(id),vec=a=>new THREE.Vector3(...a);
const hide=(el,on)=>el.toggleAttribute('hidden',on);
const clamp=(x,a,b)=>Math.max(a,Math.min(Math.max(a,b),x));
export class SceneContext {
  constructor(editor){
    this.e=editor;this.v=editor.v;this.stage=document.querySelector('.stage');
    this.ring=new THREE.Mesh(new THREE.RingGeometry(.86,1,64),new THREE.MeshBasicMaterial({color:'#f6d48b',side:THREE.DoubleSide,depthTest:false}));
    this.ring.renderOrder=40;this.ring.visible=false;this.v.scene.add(this.ring);
    this.depth=new THREE.Group();this.depth.visible=false;this.v.scene.add(this.depth);
    this.v.cb.onFrame=()=>this.update();
  }
  project(p){const r=this.v.renderer.domElement.getBoundingClientRect(),s=this.stage.getBoundingClientRect(),q=p.clone().project(this.v.camera);return{x:r.x-s.x+(q.x+1)*r.width/2,y:r.y-s.y+(1-q.y)*r.height/2,z:q.z};}
  update(){
    const {S}=this.e.a,v=this.v,step=this.e.step(),stage=this.stage.getBoundingClientRect(),canvas=v.renderer.domElement.getBoundingClientRect(),top=canvas.top-stage.top,bottom=canvas.bottom-stage.top;
    const cut=$('cutReadout'),active=step==='split'&&v.view==='cuts'&&v.dragNode!=null;
    hide(cut,!active);
    if(active){
      const p=this.project(v.tcObj.position);
      cut.textContent=v.tc.dragging?(this.cutText||v.cutDescription()):v.cutDescription();
      cut.dataset.dragging=String(v.tc.dragging);
      cut.style.left=clamp(p.x+90,12,stage.width-cut.offsetWidth-12)+'px';cut.style.top=clamp(p.y+65,top+8,bottom-cut.offsetHeight-8)+'px';
      const g=v.cutMeshes[v.dragNode],size=v.camera.position.distanceTo(v.tcObj.position)*2*Math.tan(THREE.MathUtils.degToRad(v.camera.fov/2))/canvas.height;
      g.userData.pivot.scale.setScalar(size*4);
    }
    const j=S.plan?.joints.find(j=>j.id===S.sel.joint),pop=$('pinPopover'),badge=$('pinBadge'),leader=$('pinLeader');
    const expanded=this.stage.classList.contains('expanded'),parent=expanded?this.stage:$('stepJoints');if(pop.parentElement!==parent)parent.prepend(pop);
    const show=step==='join'&&v.view==='cuts'&&j&&v.jointMeshes[j.id]&&!this.e.drag?.moved;
    this.ring.visible=!!show;this.depth.visible=!!show&&v.cameraPose!=='face';
    hide(badge,!show);hide(leader,!show||pop.hidden);
    if(show){
      const m=v.jointMeshes[j.id],p=this.project(m.position),pixels=v.camera.position.distanceTo(m.position)*2*Math.tan(THREE.MathUtils.degToRad(v.camera.fov/2))/canvas.height;
      this.ring.position.copy(m.position);this.ring.quaternion.copy(m.quaternion);this.ring.scale.setScalar(Math.max((j.d||3)/2+pixels*4,pixels*14));
      const number=S.plan.joints.filter(x=>S.plan.patches[x.patch].node===S.face).findIndex(x=>x.id===j.id)+1;
      badge.textContent=String(number);badge.style.left=(p.x+18)+'px';badge.style.top=(p.y-34)+'px';
      // The inspector stays outside the inspection rectangle on phones.
      if(innerWidth<=760){pop.style.top=(this.stage.classList.contains('expanded')?innerHeight-360:stage.bottom+4)+'px';}
      else pop.style.removeProperty('top');
      const pr=pop.getBoundingClientRect(),mobile=innerWidth<=760,end=mobile?{x:stage.width/2,y:pr.top-stage.top}:{x:pr.right-stage.left,y:pr.top-stage.top+28};
      leader.querySelector('path').setAttribute('d',`M${p.x},${p.y} L${end.x},${mobile?bottom-12:end.y} L${end.x},${end.y}`);
      // Both mating depths use the planner's resolved hole depths, not the requested input.
      const key=JSON.stringify([j.id,j.d,j.holeNeg,j.holePos,j.origin,j.x,j.y,j.z]);
      if(key!==this.depthKey){this.depthKey=key;while(this.depth.children.length){const o=this.depth.children[0];this.depth.remove(o);o.geometry.dispose();o.material.dispose();}
        for(const [side,length] of [['neg',j.holeNeg],['pos',j.holePos]]){
          if(!(length>0))continue;
          const g=new THREE.CylinderGeometry(j.d/2+j.clear,j.d/2+j.clear,length,32);g.rotateX(Math.PI/2);g.translate(0,0,(side==='neg'?-1:1)*length/2);
          const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:side==='neg'?'#e39f55':'#5aa2e3',transparent:true,opacity:.35,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));m.userData.side=side;m.renderOrder=9;this.depth.add(m);
        }
        this.depth.position.set(...j.origin);this.depth.quaternion.copy(m.quaternion);
      }
      if(p.z<-1||p.z>1||p.x<0||p.x>stage.width||p.y<top||p.y>bottom){hide(badge,true);hide(leader,true);}
    }
    this.fit(step,stage,top,bottom);
  }
  fit(step,stage,top,bottom){
    const svg=$('fitDimensions'),v=this.v,show=step==='fit'&&v.view==='model'&&v.box&&v.bed;hide(svg,!show);
    const legend=$('fitLegend');if(legend)hide(legend,!show);if(!show)return;
    const g=v.fitGeometry(),size=v.box.getSize(new THREE.Vector3()),usable=[v.bed.x,v.bed.y,v.bed.z];
    const cen=this.project(g.all.getCenter(new THREE.Vector3())),edge=12,W=stage.width;
    // Labels sit outside the geometry: pushed away from the projected centre of
    // model ∪ volume, then held at least 12 px inside the viewport.
    const narrow=W<560,placed=[],out=[];
    // Order H, W, D: the failing axis is placed last so it is the one nudged
    // into free space, and every pill keeps a 6 px gap from the others.
    for(const i of [2,0,1]){
      const [lo,hi]=g.lines[i],p=this.project(vec(lo)),q=this.project(vec(hi)),over=size.getComponent(i)>usable[i]+1e-6,val=size.getComponent(i).toFixed(1);
      const label=`${['W','D','H'][i]} ${val}`+(over?` / ${usable[i].toFixed(1)} mm${narrow?'':' usable'}`:' mm');
      const w=Math.round(label.length*7.2+22),h=24,mx=(p.x+q.x)/2,my=(p.y+q.y)/2;let dx=mx-cen.x,dy=my-cen.y;const n=Math.hypot(dx,dy)||1;dx/=n;dy/=n;
      const off=i===2?w/2+10:i===1?28:22;
      let x=clamp(mx+dx*off,edge+w/2,W-edge-w/2),y=clamp(my+dy*off+(i===2?0:4),top+edge+h/2,bottom-edge-h/2);
      const hit=(x,y)=>placed.find(r=>Math.abs(r.x-x)<(r.w+w)/2+6&&Math.abs(r.y-y)<(r.h+h)/2+6);
      for(let k=0,r;(r=hit(x,y))&&k<8;k++){const sy=y>=r.y?1:-1,ny=r.y+sy*((r.h+h)/2+6);
        y=ny<top+edge+h/2||ny>bottom-edge-h/2?clamp(r.y-sy*((r.h+h)/2+6),top+edge+h/2,bottom-edge-h/2):ny;}
      placed.push({x,y,w,h});
      out[i]=`<g data-dimension="${['width','depth','height'][i]}" class="${over?'over':'ok'}"><path d="M${p.x.toFixed(1)},${p.y.toFixed(1)}L${q.x.toFixed(1)},${q.y.toFixed(1)}" marker-start="url(#dimArrow)" marker-end="url(#dimArrow)"/><rect class="dim-bg" x="${(x-w/2).toFixed(1)}" y="${(y-h/2).toFixed(1)}" width="${w}" height="${h}" rx="6"/><text x="${x.toFixed(1)}" y="${(y+4.5).toFixed(1)}">${label}</text></g>`;
    }
    // Lines first, pills on top, so no arrow is drawn across a label.
    const lines=out.map(o=>o.replace(/<rect[\s\S]*$/,'</g>')).join(''),pills=out.map(o=>o.replace(/<path[^>]*\/>/,'')).join('');
    svg.innerHTML=`<defs><marker id="dimArrow" viewBox="0 0 8 8" refX="4" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M8 4 L0 0 L0 8Z" fill="context-stroke"/></marker></defs>`+lines.replace(/data-dimension="(\w+)"/g,'data-dim-line="$1"')+pills;
  }
}

export function depthProfile(j){
  const neg=Math.max(0,j.holeNeg||0),pos=Math.max(0,j.holePos||0),scale=115/Math.max(neg,pos,1),w=neg*scale,h=pos*scale;
  return `<figure id="pinDepthPreview"><figcaption>Accepted hole depths · side section${['dowel','press'].includes(j.kind)?' · includes 0.3 mm end allowance':''}</figcaption><svg viewBox="0 0 300 82" role="img" aria-label="Hole depth: negative side ${neg.toFixed(1)} mm, positive side ${pos.toFixed(1)} mm"><rect x="8" y="24" width="142" height="34" fill="#4a3a2a"/><rect x="150" y="24" width="142" height="34" fill="#26394a"/><rect data-side="neg" x="${150-w}" y="34" width="${w}" height="14" fill="#e39f55"/><rect data-side="pos" x="150" y="34" width="${h}" height="14" fill="#5aa2e3"/><path d="M150 17V64" stroke="#fff" stroke-dasharray="3 3"/><text x="76" y="15">− side ${neg.toFixed(1)} mm</text><text x="224" y="15">+ side ${pos.toFixed(1)} mm</text><text x="150" y="78">cut plane · lengths to scale</text></svg></figure>`;
}
