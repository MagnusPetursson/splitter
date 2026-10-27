// Screen-space annotations are projected from the real model, not a second plan.
import * as THREE from 'three';
const $=id=>document.getElementById(id),vec=a=>new THREE.Vector3(...a);
const hide=(el,on)=>el.toggleAttribute('hidden',on);
const clamp=(x,a,b)=>Math.max(a,Math.min(Math.max(a,b),x));
// Does segment (x0,y0)-(x1,y1) touch rectangle r {l,r,t,b}? (Liang–Barsky clip)
export function segRect(x0,y0,x1,y1,r){let a=0,b=1;const dx=x1-x0,dy=y1-y0;
  for(const [pp,qq] of [[-dx,x0-r.l],[dx,r.r-x0],[-dy,y0-r.t],[dy,r.b-y0]]){if(pp===0){if(qq<0)return false;continue;}const t=qq/pp;if(pp<0){if(t>b)return false;if(t>a)a=t;}else{if(t<a)return false;if(t<b)b=t;}}
  return a<=b;}
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
    // Round 4: a bottom safe area. The viewer hint and the camera/enlarge
    // controls own the lower band of the view; labels stay above it and
    // also clear any other viewport chrome (legend, corner buttons).
    const sr=this.stage.getBoundingClientRect(),chrome=[];
    for(const el of document.querySelectorAll('#gestureHint, #viewerTools, #fitLegend, .view-corner')){if(!el.checkVisibility?.()||el.hidden)continue;
      for(const c of el.matches('#viewerTools, .view-corner')?el.children:[el]){if(!c.checkVisibility?.())continue;const r=c.getBoundingClientRect();if(r.width&&r.height)chrome.push({l:r.left-sr.left,r:r.right-sr.left,t:r.top-sr.top,b:r.bottom-sr.top,el});}}
    const band=chrome.filter(c=>c.el.matches('#gestureHint, #viewerTools')&&c.t>sr.height*.6);
    if(band.length)bottom=Math.min(bottom,Math.min(...band.map(c=>c.t))-6);
    const g=v.fitGeometry(),size=v.box.getSize(new THREE.Vector3()),usable=[v.bed.x,v.bed.y,v.bed.z];
    const cen=this.project(g.all.getCenter(new THREE.Vector3())),edge=12,W=stage.width;
    // Round 3: each label gets its own slot beside its dimension line, never
    // on it. Candidates step along the line on the side away from the scene
    // centre (then the other side); the first slot that clears every
    // dimension line and arrowhead (4 px) and the other labels (6 px) wins.
    const segs=g.lines.map(([lo,hi])=>{const p=this.project(vec(lo)),q=this.project(vec(hi));return{p,q};});
    const ctx=(this.mctx||=document.createElement('canvas').getContext('2d'));
    const placed=[],out=[];
    // The model's projected bounds are an obstacle too: a label never sits on the hero.
    const mb=v.box,corners=[0,1,2,3,4,5,6,7].map(k=>this.project(new THREE.Vector3(k&1?mb.max.x:mb.min.x,k&2?mb.max.y:mb.min.y,k&4?mb.max.z:mb.min.z)));
    const model={l:Math.min(...corners.map(c=>c.x)),r:Math.max(...corners.map(c=>c.x)),t:Math.min(...corners.map(c=>c.y)),b:Math.max(...corners.map(c=>c.y))};
    for(const i of [2,0,1]){
      const {p,q}=segs[i],over=size.getComponent(i)>usable[i]+1e-6,val=size.getComponent(i).toFixed(1);
      const label=`${['W','D','H'][i]} ${val} mm`+(over?` · limit ${+usable[i].toFixed(1)} mm`:'');
      ctx.font=`${over?620:400} 13px ${getComputedStyle(document.body).fontFamily}`;
      const w=Math.ceil(ctx.measureText(label).width)+20,h=24;
      let dx=q.x-p.x,dy=q.y-p.y;const L=Math.hypot(dx,dy)||1;dx/=L;dy/=L;
      let nx=-dy,ny=dx;const mx=(p.x+q.x)/2,my=(p.y+q.y)/2;if((mx-cen.x)*nx+(my-cen.y)*ny<0){nx=-nx;ny=-ny;}
      const ext=Math.abs(nx)*w/2+Math.abs(ny)*h/2,gap=10;
      const fit=(x,y)=>({x:clamp(x,edge+w/2,W-edge-w/2),y:clamp(y,top+edge+h/2,bottom-edge-h/2)});
      const cost=({x,y})=>{let c=0;const r={l:x-w/2-4,r:x+w/2+4,t:y-h/2-4,b:y+h/2+4};
        for(const sg of segs){const ex=(sg.q.x-sg.p.x),ey=(sg.q.y-sg.p.y),el=Math.hypot(ex,ey)||1,ux=ex/el*7,uy=ey/el*7;
          if(segRect(sg.p.x-ux,sg.p.y-uy,sg.q.x+ux,sg.q.y+uy,r))c+=sg===segs[i]?100:40;}
        {const ox=Math.min(r.r,model.r)-Math.max(r.l,model.l),oy=Math.min(r.b,model.b)-Math.max(r.t,model.t);if(ox>0&&oy>0)c+=20+Math.min(30,ox*oy/(w*h)*30);}
        for(const o of placed)if(Math.abs(o.x-x)<(o.w+w)/2+6&&Math.abs(o.y-y)<(o.h+h)/2+6)c+=60;
        for(const o of chrome)if(r.l<o.r+4&&r.r>o.l-4&&r.t<o.b+4&&r.b>o.t-4)c+=80;
        return c;};
      let best=null;
      for(const side of [1,-1])for(const t of [.5,.38,.62,.25,.75]){
        const c=fit(p.x+(q.x-p.x)*t+nx*side*(ext+gap),p.y+(q.y-p.y)*t+ny*side*(ext+gap)),k=cost(c)+(side<0?1:0)+Math.abs(t-.5);
        if(!best||k<best.k)best={...c,k};if(best.k<2)break;}
      // Beyond either arrowhead, in line with the dimension.
      if(best.k>=2){const along=Math.abs(dx)*w/2+Math.abs(dy)*h/2+gap;for(const [e,sg] of [[q,1],[p,-1]]){const c=fit(e.x+dx*sg*along,e.y+dy*sg*along),k=cost(c)+1.5;if(k<best.k)best={...c,k};}}
      if(best.k>=2)for(const r of [1.6,2.4])for(const side of [1,-1]){const c=fit(mx+nx*side*(ext+gap)*r,my+ny*side*(ext+gap)*r),k=cost(c)+r;if(k<best.k)best={...c,k};}
      const {x,y}=best;placed.push({x,y,w,h});
      out[i]=`<g data-dimension="${['width','depth','height'][i]}" data-slot-cost="${Math.round(best.k)}" class="${over?'over':'ok'}"><path d="M${p.x.toFixed(1)},${p.y.toFixed(1)}L${q.x.toFixed(1)},${q.y.toFixed(1)}" marker-start="url(#dimArrow)" marker-end="url(#dimArrow)"/><rect class="dim-bg" x="${(x-w/2).toFixed(1)}" y="${(y-h/2).toFixed(1)}" width="${w}" height="${h}" rx="6"/><text x="${x.toFixed(1)}" y="${(y+4.5).toFixed(1)}">${label}</text></g>`;
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
