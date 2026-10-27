// One export gate shared by guided actions, explicit controls and history.
export function readiness(S) {
  if(S.pendingPin)return {ok:false,text:'Apply or discard the pin changes before building.'};
  if (!S.plan) return {ok:false, text:'Find cuts first.'};
  if (S.settingsDirty) return {ok:false, text:'Printer settings changed. Recalculate the split.'};
  const p=S.plan, badParts=p.leaves.filter(l=>!l.empty&&!l.fits).length;
  const badPins=p.joints.filter(j=>j.warnings?.length).length;
  const notes=p.patches.filter(p=>p.fallback||p.single).length;
  const cuts=p.faces.filter(f=>f.loops?.length).length;
  const summary=`${cuts} cut${cuts===1?'':'s'} checked · ${p.joints.length-badPins} pin${p.joints.length-badPins===1?'':'s'} valid`;
  if(badParts||badPins)return {ok:false,text:`${summary} · ${badParts?`${badParts} ${badParts===1?'part':'parts'} too large`:`${badPins} ${badPins===1?'pin needs':'pins need'} attention`}. Review before building.`};
  return {ok:true,text:`${summary}${notes?` · ${notes} contact ${notes===1?'warning':'warnings'}: review the explanations below`:''} · Ready to build & export.`};
}

// Only accepted immutable plans enter history, never an in-flight drag or a
// partially mutated request. Restoration invalidates built/exported artifacts.
export class PlanHistory {
  constructor(){this.reset();}
  reset(){this.past=[];this.future=[];this.current=null;}
  record(plan){
    if(this.current){this.past.push(this.current);if(this.past.length>20)this.past.shift();}
    this.current=structuredClone(plan);this.future=[];
  }
  take(direction){
    const from=direction==='undo'?this.past:this.future,to=direction==='undo'?this.future:this.past;
    if(!from.length)return null;
    to.push(this.current);this.current=from.pop();return structuredClone(this.current);
  }
}
