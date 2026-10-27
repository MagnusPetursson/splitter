// Five workflow steps share one model and plan. No duplicated planner state.
const $ = id => document.getElementById(id);
const steps = ['load','fit','split','join','export'];
const panels = ['stepModel','stepPrinter','stepSplit','stepJoints','stepExport'];
const names = ['Load','Fit','Split','Join','Export'];
export class GuidedFlow {
  constructor({S, viewer, setView}) {
    this.S=S;this.viewer=viewer;this.setView=setView;this.step='load';
    this.expert=localStorage.getItem('ps.expert')==='1';
    $('expertMode').addEventListener('click',()=>this.mode(!this.expert));
    document.querySelectorAll('#flowNav [data-step]').forEach(b=>b.addEventListener('click',()=>this.go(b.dataset.step)));
    $('flowBack').addEventListener('click',()=>this.go(steps[steps.indexOf(this.step)-1]));
    $('flowNext').addEventListener('click',()=>this.go(steps[steps.indexOf(this.step)+1]));
    document.querySelectorAll('[data-weight]').forEach(b=>b.addEventListener('click',()=>{
      $('supportWeight').value=b.dataset.weight;$('supportWeight').dispatchEvent(new Event('input'));this.sync();
    }));
    $('supportWeight').addEventListener('input',()=>this.sync());
    $('printer').addEventListener('change',()=>{if($('printer').value==='custom')$('printerAdvanced').open=true;this.sync();});
    for(const id of ['bedX','bedY','bedZ','margin','nozzle'])$(id).addEventListener('input',()=>this.sync());
    $('frameModel').addEventListener('click',()=>viewer.frameCurrent());
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
    localStorage.setItem('ps.expert',on?'1':'0');
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
  loaded() {this.go('load',{focus:false,view:false});this.say('Model loaded. Check its dimensions, then continue to Fit.');}
  planned() {this.sync();this.say(`Split ready. ${this.S.plan.leaves.filter(l=>!l.empty).length} parts. ${this.S.plan.fits?'All fit.':'Some do not fit; review the warnings.'} Continue to Join.`);}
  say(text) { $('flowStatus').textContent=text; }
  picked(kind) {
    const next=kind==='joint'||kind==='patch'?'join':this.step==='join'&&kind==='cut'?'join':'split';
    if(this.step!==next)this.go(next,{focus:false,view:false});
    if(next==='join')$('mapWrap').querySelector('details').open=true;
  }
  sync() {
    const S=this.S,busy=!$('busy').classList.contains('hidden'),i=steps.indexOf(this.step);
    $('planStale').hidden=!S.settingsDirty;
    $('buildBtn').disabled=busy||!S.plan||!S.workerReady||!!S.settingsDirty;
    $('exportBtn').disabled=busy||!S.built||!!S.settingsDirty;
    document.querySelectorAll('#flowNav button').forEach((b,j)=>{
      b.disabled=busy||!this.allowed(steps[j]);
      if(j===i)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');
      b.classList.toggle('done',j<i);
    });
    $('flowBack').disabled=busy||i===0;
    const next=steps[i+1];
    $('flowNext').disabled=busy||!next||!this.allowed(next);
    $('flowNext').textContent=i===4?(S.export?'Downloads ready ✓':'Build, then download'):!this.allowed(next)?(i===0?'Choose a model first':'Find cuts to continue'):`Continue to ${names[i+1]} →`;
    const editing=!$('jointDlg').classList.contains('hidden');
    $('side').inert=busy||editing||!!this.expanded;
    for(const el of document.querySelectorAll('.top, #flowNav, .flow-footer'))el.inert=editing||!!this.expanded;
    document.querySelector('.stage').inert=editing&&!$('jointDlg').classList.contains('docked');
    $('views').inert=busy;$('viewerTools').inert=busy;
    $('views').hidden=!S.model;$('viewerTools').hidden=!S.model;
    for(const b of document.querySelectorAll('#views button')) {
      b.disabled=(b.dataset.view==='cuts'&&!S.plan)||(['parts','plates'].includes(b.dataset.view)&&!S.built);
      b.setAttribute('aria-pressed',String(this.viewer.view===b.dataset.view));
    }
    $('spreadParts').hidden=!S.built||this.viewer.view!=='parts';
    $('spreadParts').setAttribute('aria-pressed',String(this.viewer.explode>=.02));
    $('spreadParts').textContent=this.viewer.explode>=.02?'Exploded':'Assembled';
    const x=+$('bedX').value,y=+$('bedY').value,z=+$('bedZ').value,m=+$('margin').value;
    $('fitReadout').innerHTML=`${x} × ${y} × ${z} mm<small>Usable: ${Math.max(0,x-2*m)} × ${Math.max(0,y-2*m)} × ${Math.max(0,z-m)} mm · ${m} mm margin</small>`;
    document.querySelectorAll('[data-weight]').forEach(b=>b.setAttribute('aria-pressed',String(+$('supportWeight').value===+b.dataset.weight)));
    $('viewerHint').textContent=this.step==='split'&&S.plan?'Select a cut, then drag its arrow · or use its numeric offset':this.step==='join'?'Select a face or joint · open the map for precise edits':'Drag to orbit · scroll to zoom · F to fit';
    if(!S.model&&this.step!=='load')this.go('load',{focus:false,view:false});
  }
}
