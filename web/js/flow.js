// Five workflow steps share one model and plan. No duplicated planner state.
import {readiness} from './readiness.js';
import {ico} from './icons.js';
const $ = id => document.getElementById(id);
const steps = ['load','fit','split','join','export'];
const panels = ['stepModel','stepPrinter','stepSplit','stepJoints','stepExport'];
const names = ['Load','Fit','Split','Join','Export'];
const AXIS=['wide','deep','tall'],AXN=['Width','Depth','Height'],mm=v=>v.toFixed(1);
// The fit verdict states the result first, then what Plan cuts will do about
// it. The orientation test mirrors the planner's whole-model candidates:
// world-axis "down" directions (only +Z when parts stay upright) and quarter
// turns on the bed. The planner may still find a diagonal fit this misses.
export function fitAssess(size,u,upright=false){
  const over=[0,1,2].filter(k=>size[k]>u[k]+1e-9);
  const perms=upright?[[0,1,2],[1,0,2]]:[[0,1,2],[1,0,2],[0,2,1],[2,0,1],[1,2,0],[2,1,0]];
  const p=over.length?perms.slice(1).find(q=>q.every((a,i)=>size[a]<=u[i]+1e-9)):null;
  const resolve=!over.length?'as-placed':!p?'none':p[2]===2?'turn':'side';
  // Quarter-turn taking old axis p[i] to new axis i; one row is negated when
  // the permutation is odd, so it is a rotation (det +1), never a mirror.
  let rot=null;if(p){rot=[0,0,0,0,0,0,0,0,0];p.forEach((a,i)=>rot[i*3+a]=1);const odd=(p[0]>p[1])+(p[0]>p[2])+(p[1]>p[2]);if(odd%2)rot[0*3+p[0]]=-1;}
  if(!over.length)return{over,resolve,head:'Fits as placed',metric:`${size.map(mm).join(' × ')} mm in ${u.map(mm).join(' × ')} mm usable`,
    short:'Plan cuts chooses its print orientation',next:'No cut is needed. Plan cuts chooses the print orientation and only adds a cut if your Split preference trades one for less support.'};
  const head=`Doesn’t fit as placed: ${over.map(k=>`${mm(size[k]-u[k])} mm too ${AXIS[k]}`).join(', ')}`;
  const metric=over.map(k=>`${AXN[k]} ${mm(size[k])} / ${mm(u[k])} mm usable`).join(' · ');
  const how=resolve==='turn'?'turned 90° on the bed':'laid on its side';
  if(p)return{over,resolve,rot,how,act:resolve==='turn'?'Turn 90° on the bed':'Lay it on its side',head,metric,short:`Fits in one piece if ${how}`,
    next:`Or go straight to Plan cuts: it tries print orientations before it cuts. Nothing is scaled.`};
  const any=upright?'No upright orientation':'No orientation';
  return{over,resolve,head,metric,short:`${any} fits whole · Plan cuts proposes pieces`,
    next:`${any} fits it whole. Plan cuts proposes cuts and a print orientation for each piece; you review them before anything is built.`};
}
export class GuidedFlow {
  constructor({S, viewer, setView, split, prepare, onSync}) {
    this.S=S;this.viewer=viewer;this.setView=setView;this.step='load';
    this.split=split;this.prepare=prepare;this.onSync=onSync;
    this.expert=localStorage.getItem('ps.expert')==='1';
    $('expertMode').addEventListener('click',()=>this.mode(!this.expert));
    document.querySelectorAll('#flowNav [data-step]').forEach(b=>b.addEventListener('click',()=>this.go(b.dataset.step)));
    $('flowBack').addEventListener('click',()=>this.go(steps[steps.indexOf(this.step)-1]));
    $('flowNext').addEventListener('click',()=>this.next());
    document.querySelectorAll('[data-weight]').forEach(b=>b.addEventListener('click',()=>{
      $('supportWeight').value=b.dataset.weight;$('supportWeight').dispatchEvent(new Event('input'));this.sync();
    }));
    $('supportWeight').addEventListener('input',()=>this.sync());
    $('upright').addEventListener('change',()=>this.sync());
    $('printer').addEventListener('change',()=>{if($('printer').value==='custom')$('printerAdvanced').open=true;this.sync();});
    for(const id of ['bedX','bedY','bedZ','margin','nozzle'])$(id).addEventListener('input',()=>this.sync());
    $('frameModel').addEventListener('click',()=>viewer.frameCurrent());
    $('replaceCompact').addEventListener('click',()=>$('fileInput').click());
    $('expandView').addEventListener('click',()=>this.expand(!this.expanded));
    document.addEventListener('keydown',e=>{
      if(!this.expanded)return;
      if(e.key==='Escape'){e.preventDefault();this.expand(false);}
      if(e.key==='Tab') {
        const list=[...document.querySelectorAll('.stage button:not(:disabled), .stage select, .stage canvas[tabindex]')].filter(e=>e.checkVisibility());
        const i=list.indexOf(document.activeElement);
        if((e.shiftKey&&i===0)||(!e.shiftKey&&i===list.length-1)){e.preventDefault();list[e.shiftKey?list.length-1:0]?.focus();}
      }
    });
    $('cameraView').addEventListener('change',e=>viewer.cameraView(e.target.value));
    $('spreadParts').addEventListener('click',()=>{
      $('explode').value=viewer.explode<.02?'.5':'0';$('explode').dispatchEvent(new Event('input'));$('explode').dispatchEvent(new Event('change'));this.sync();
    });
    // Busy is shared by both independent workers. Observe only this presentation
    // flag, not the whole DOM, to keep flow controls and re-entry safe.
    new MutationObserver(()=>this.sync()).observe($('busy'),{attributes:true,attributeFilter:['class']});
    this.mode(this.expert,false);this.sync();
  }
  mode(on,announce=true) {
    this.expert=on;document.body.dataset.expert=String(on);
    $('expertMode').setAttribute('aria-pressed',String(on));
    document.querySelectorAll('details.advanced').forEach(d=>{d.open=on;});
    localStorage.setItem('ps.expert',on?'1':'0');$('pinSelector').open=on;
    document.dispatchEvent(new Event('expertchange'));this.onSync?.();this.sync();
    if(announce)this.say(on?'Expert mode on. Detailed controls are open in each step.':'Guided mode on. Advanced controls remain available in each step.');
  }
  expand(on) {
    this.expanded=on;
    const stage=document.querySelector('.stage');stage.classList.toggle('expanded',on);
    if(on){stage.setAttribute('role','dialog');stage.setAttribute('aria-modal','true');}
    else {stage.setAttribute('role','main');stage.removeAttribute('aria-modal');}
    $('expandView').setAttribute('aria-expanded',String(on));$('expandView').textContent=on?'Close view':'Enlarge view';
    this.sync();requestAnimationFrame(()=>{this.viewer.resize();this.viewer.frameCurrent();$('expandView').focus();});
  }
  printerName() {return this.S.printers.find(p=>p.id===$('printer').value)?.name||'custom printer';}
  async next() {
    if(this.step==='load'){this.go('fit');return;}
    if(this.step==='fit'||(this.step==='split'&&(!this.S.plan||this.S.settingsDirty))){
      this.go('split');this.autoAdvance=true;await this.split();this.autoAdvance=false;return;
    }
    if(this.step==='split'){this.go('join');return;}
    if(this.S.export){document.querySelector('#exportInfo a[download$=".zip"]')?.click();return;}
    if(readiness(this.S).ok){this.go('export');await this.prepare();}
  }
  allowed(step) {return step==='load'||((step==='fit'||step==='split')?!!this.S.model:!!this.S.plan&&!this.S.settingsDirty);}
  go(step,{focus=true,view=true}={}) {
    if(!steps.includes(step)||!this.allowed(step))return;
    this.step=step;document.body.dataset.step=step;
    panels.forEach((id,i)=>{$(id).hidden=steps[i]!==step;});
    if(view)this.setView(step==='load'||step==='fit'?'model':step==='export'&&this.S.built?'parts':'cuts');
    $('side').scrollTop=0;
    document.querySelector('.skip').href='#'+panels[steps.indexOf(step)];
    this.sync();
    if(focus)$(panels[steps.indexOf(step)]).focus({preventScroll:true});
    this.say(`Step ${steps.indexOf(step)+1} of 5: ${names[steps.indexOf(step)]}.`);
  }
  loaded() {this.go('fit',{focus:true});this.say(`Model loaded. Check the dimensions against ${this.printerName()}, then split.`);}
  planned() {if(this.autoAdvance&&this.S.plan.fits)this.go('join');this.sync();this.say(`Split ready. ${this.S.plan.leaves.filter(l=>!l.empty).length} parts. ${this.S.plan.fits?'All fit.':'Some do not fit; review the warnings.'} Continue to Join.`);}
  say(text) { $('flowStatus').textContent=text; }
  picked(kind) {
    const next=kind==='joint'||kind==='patch'?'join':this.step==='join'&&kind==='cut'?'join':'split';
    if(this.step!==next)this.go(next,{focus:false,view:false});

  }
  sync() {
    const S=this.S,busy=!$('busy').classList.contains('hidden'),i=steps.indexOf(this.step);
    $('planStale').hidden=!S.settingsDirty;
    const ready=readiness(S);
    $('buildBtn').disabled=busy||!S.workerReady||!ready.ok;
    $('readiness').textContent=ready.text;
    $('readiness').classList.toggle('warnc',!ready.ok);
    $('loadedActions').hidden=!S.model;$('drop').hidden=!!S.model;
    $('loadedStrip').hidden=!S.model||this.step==='load';
    $('loadedStripText').textContent=S.model?`${S.model.name} loaded · ${Math.abs((S.model.scale||1)-1)<1e-9?'original scale':`scale ${S.model.scale}×`}`:'';
    document.querySelector('#stepModel .samples').hidden=!!S.model;
    $('loadHeading').textContent=S.model?`${S.model.name.replace(/\.[^.]+$/,'').replace(/_/g,' ')} loaded`:'Start with your model.';
    document.querySelector('#stepModel .step-intro').textContent=S.model?`${Math.abs((S.model.scale||1)-1)<1e-9?'Original size retained.':`Scale ${S.model.scale}× applied.`} Replace the file or review its measurements below.`:'Keep its size. We’ll make the pieces fit your printer.';
    document.body.dataset.loaded=String(!!S.model);document.body.dataset.exported=String(!!S.export);
    $('exportBtn').disabled=busy||!S.built||!!S.settingsDirty;
    document.querySelectorAll('#flowNav button').forEach((b,j)=>{
      b.disabled=busy||!this.allowed(steps[j]);
      if(j===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');
      const done=[!!S.model,!!S.plan&&!S.settingsDirty,!!S.plan&&!S.settingsDirty,!!S.built,!!S.export][j];
      const blocked=!this.allowed(steps[j]);
      const state=j===i?'current':done?'done':blocked?'blocked':'upcoming';
      const why=blocked?(!S.model?'Load a model':S.settingsDirty?'Recalculate split':'Find cuts first'):state==='done'?'Done':state==='current'?'Current':'Available';
      b.dataset.state=state;b.title=`${names[j]} · ${why}`;b.removeAttribute('aria-label');b.setAttribute('aria-description',why);
      b.querySelector('small').textContent=why;b.querySelector('small').classList.add('sr-only');b.classList.toggle('done',done);
      {const n=b.querySelector('.step-number'),v=done&&j!==i?'done':String(j+1);if(n.dataset.v!==v){n.dataset.v=v;n.innerHTML=v==='done'?ico('check'):v;}}b.querySelector('.step-number').setAttribute('aria-hidden','true');
    });
    $('flowBack').disabled=busy||i===0;
    const canAct=i===0?!!S.model:i<=2?!!S.model:i>=3?ready.ok:false;
    $('flowNext').disabled=busy||!canAct;
    {const nt=i===0?(S.model?'Check printer fit':busy?'Preparing model…':'Load a model to continue'):i===1||i===2&&(!S.plan||S.settingsDirty)?`Plan cuts for ${this.printerName()}`:i===2?'Review joints':!ready.ok?(S.pendingPin?'Apply or discard pin edits':'Resolve warnings first'):S.export?'Download ZIP':S.built?'Prepare downloads':S.outputStale?'Rebuild & prepare downloads':'Build & prepare downloads';const m=/^Plan cuts for (.+)$/.exec(nt);if($('flowNext').dataset.t!==nt){$('flowNext').dataset.t=nt;$('flowNext').title=nt;$('flowNext').textContent=m?'Plan cuts':nt;}}
    const editing=!$('jointDlg').classList.contains('hidden');
    $('side').inert=busy||editing||!!this.expanded;
    for(const el of document.querySelectorAll('.top, #flowNav, .flow-footer'))el.inert=editing||!!this.expanded;
    document.querySelector('.stage').inert=editing&&!$('jointDlg').classList.contains('docked');
    $('views').inert=busy;$('viewerTools').inert=busy;
    // Presentations are views of the current step, not another navigation.
    $('views').hidden=!S.model||(!this.expert&&this.step!=='export');$('viewerTools').hidden=!S.model;
    $('viewCaption').textContent=({load:'Model',fit:'Printer fit',split:'Cuts',join:'Joints',export:'Built parts'})[this.step];
    for(const b of document.querySelectorAll('#views button')) {
      b.disabled=(b.dataset.view==='cuts'&&!S.plan)||(['parts','plates'].includes(b.dataset.view)&&!S.built);
      b.setAttribute('aria-pressed',String(this.viewer.view===b.dataset.view));
    }
    $('spreadParts').hidden=!S.built||this.viewer.view!=='parts';
    $('spreadParts').setAttribute('aria-pressed',String(this.viewer.explode>=.02));
    $('spreadParts').textContent=this.viewer.explode>=.02?'Exploded':'Assembled';
    const x=+$('bedX').value,y=+$('bedY').value,z=+$('bedZ').value,m=+$('margin').value;
    const u=[Math.max(0,x-2*m),Math.max(0,y-2*m),Math.max(0,z-m)];
    const f=S.model?fitAssess(S.model.size,u,$('upright').checked):null,turnedNow=S.model?.rot&&JSON.stringify(S.model.rot.flat?S.model.rot.flat():S.model.rot)!=='[1,0,0,0,1,0,0,0,1]';if(f&&turnedNow&&!f.over.length)f.head='Fits as turned';
    $('fitReadout').innerHTML=`<div class="readout-head"><b>Model vs usable volume</b><span>W × D × H · mm</span></div><dl class="metrics">${['Width','Depth','Height'].map((n,k)=>`<div class="${f&&f.over.includes(k)?'over':''}"><dt>${n}</dt><dd>${S.model?`${S.model.size[k].toFixed(1)}<span>of ${u[k].toFixed(1)} usable</span>`:u[k].toFixed(1)}</dd></div>`).join('')}</dl><p>Usable = bed ${x} × ${y} × ${z} mm less clearance. Reserve ${m} mm at each side and the top; nothing is scaled.</p>`;
    {const pn=this.printerName(),k=JSON.stringify([pn,f,S.model?.rot]);if($('fitVerdict').dataset.k!==k){$('fitVerdict').dataset.k=k;
      $('fitVerdict').dataset.summary=f?f.head+'\n'+f.short:'';
      const turned=S.model&&JSON.stringify((S.model.rot||[]).flat())!=='[1,0,0,0,1,0,0,0,1]'&&S.model.rot;
      const fix=f&&f.rot?`<div class="fit-fix"><button type="button" data-fit-rotate>${ico('rotate')}${f.act}</button><span>Fits in one piece ${f.how}.</span></div>`:'';
      const undo=turned?`<p class="fit-turned">Turned from the file’s orientation. <button type="button" class="linkish" data-fit-restore>Restore file orientation</button></p>`:'';
      $('fitVerdict').innerHTML=!f?'':`${ico(f.over.length?'alert':'success')}<div><b class="fit-head">${f.head}</b><p class="fit-metric">${f.metric} on <span class="pn"></span></p>${fix}<p class="fit-next">${f.next}</p>${undo}</div>`;
      $('fitVerdict').querySelector('[data-fit-rotate]')?.addEventListener('click',()=>dispatchEvent(new CustomEvent('ps-rotate',{detail:{rot:f.rot,done:`Turned: it now fits in one piece (${f.how}).`}})));
      $('fitVerdict').querySelector('[data-fit-restore]')?.addEventListener('click',()=>dispatchEvent(new CustomEvent('ps-rotate',{detail:'restore'})));$('fitVerdict').querySelectorAll('.pn').forEach(e=>e.textContent=pn);}}
    $('fitVerdict').classList.toggle('over',!!f&&f.over.length>0);
    $('fitVerdict').dataset.resolve=f?f.resolve:'';
    const simp=S.model?.simplified;$('fitMeshNote').hidden=!simp;
    $('fitMeshNote').textContent=simp?`Simplified for planning: ${simp.inputTris.toLocaleString()} → ${simp.outputTris.toLocaleString()} triangles. Maximum sampled deviation ${simp.maxDev.toFixed(3)} mm. ${S.model.originalKept?'Full-detail original retained for export.':'Export will use this simplified mesh.'} See Load for the complete repair and simplification report.`:'';
    document.querySelectorAll('[data-weight]').forEach(b=>b.setAttribute('aria-pressed',String(+$('supportWeight').value===+b.dataset.weight)));
    $('viewerHint').textContent=this.step==='split'&&S.plan?'Drag the blue arrow to move · Tilt cut for arcs · Esc cancels':this.step==='join'?'Click or drag pins · Add pin then click a cut face':'Drag to orbit · scroll to zoom · F to fit';
    this.onSync?.();
    if(!S.model&&this.step!=='load')this.go('load',{focus:false,view:false});
  }
}
