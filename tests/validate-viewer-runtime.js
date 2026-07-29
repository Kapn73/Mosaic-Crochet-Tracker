const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root,'viewer.html'),'utf8');
const script = fs.readFileSync(path.join(root,'viewer.js'),'utf8');
const demoMatch = html.match(/<script id="embeddedChartData" type="application\/json">([\s\S]*?)<\/script>/);
if (!demoMatch) throw new Error('embedded demo missing');
const demoText = demoMatch[1];
const demo = JSON.parse(demoText);
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);

class ClassList {
  constructor(){this.s=new Set();}
  add(...x){x.forEach(v=>this.s.add(v));}
  remove(...x){x.forEach(v=>this.s.delete(v));}
  toggle(x,force){if(force===undefined){if(this.s.has(x)){this.s.delete(x);return false;}this.s.add(x);return true;} if(force)this.s.add(x);else this.s.delete(x);return force;}
  contains(x){return this.s.has(x);}
}
function context2d(){
  const fn=()=>{};
  return new Proxy({measureText:()=>({width:10})},{get(t,p){if(p in t)return t[p]; if(['fillStyle','strokeStyle','lineWidth','lineCap','lineJoin','font','textAlign','textBaseline','imageSmoothingEnabled'].includes(p))return t[p]; return fn;},set(t,p,v){t[p]=v;return true;}});
}
class El {
  constructor(id='',tag='DIV'){
    this.id=id;this.tagName=tag;this.style={};this.classList=new ClassList();this.dataset={};this.attributes={};this.listeners={};this.children=[];this.parentElement=null;this.textContent='';this.value='';this.checked=false;this.disabled=false;this.scrollLeft=0;this.scrollTop=0;this.clientWidth=640;this.clientHeight=480;this.width=0;this.height=0;this.firstChild=null;
  }
  addEventListener(n,f){(this.listeners[n] ||= []).push(f);}
  setAttribute(n,v){this.attributes[n]=String(v);}
  getAttribute(n){return this.attributes[n];}
  append(...els){els.forEach(e=>this.appendChild(e));}
  appendChild(e){if(typeof e==='string')return; e.parentElement=this;this.children.push(e);this.firstChild=this.children[0]||null;return e;}
  removeChild(e){this.children=this.children.filter(x=>x!==e);this.firstChild=this.children[0]||null;}
  querySelectorAll(sel){
    const out=[]; const walk=(n)=>{for(const c of n.children){if(sel==='.yarn-color-row' && c.classList.contains('yarn-color-row'))out.push(c); if(sel==='input[type="checkbox"]' && c.tagName==='INPUT' && c.type==='checkbox')out.push(c); walk(c);}};walk(this);return out;
  }
  querySelector(sel){
    if(sel==='[data-role="name"]'||sel==='[data-role="color"]'){
      const role=sel.includes('name')?'name':'color';let found=null;const walk=(n)=>{for(const c of n.children){if(c.dataset?.role===role){found=c;return;}walk(c);if(found)return;}};walk(this);return found;
    }
    return null;
  }
  getContext(){return context2d();}
  getBoundingClientRect(){return {left:0,top:0,width:this.clientWidth,height:this.clientHeight};}
  scrollTo(o){if(typeof o==='object'){if(Number.isFinite(o.left))this.scrollLeft=o.left;if(Number.isFinite(o.top))this.scrollTop=o.top;}}
  click(){}
}
const elements = new Map();
for(const id of ids){
  const tag = id.toLowerCase().includes('canvas') ? 'CANVAS' : 'DIV';
  elements.set(id,new El(id,tag));
}
for(const id of ['chartViewport']){elements.get(id).clientWidth=900;elements.get(id).clientHeight=600;}
for(const id of ['chartCanvas','segmentStripCanvas','stitchRulerCanvas']){elements.get(id).getContext=()=>context2d();}
const stripWrap=new El('stripWrap');stripWrap.clientWidth=800;stripWrap.clientHeight=110;stripWrap.appendChild(elements.get('segmentStripCanvas'));
const progressParents=['segmentProgressBar','progressBar'];for(const id of progressParents){const parent=new El(id+'Parent');parent.appendChild(elements.get(id));}
elements.get('embeddedChartData').textContent=demoText;
['focusSegment','showGrid','showSymbols'].forEach(id=>elements.get(id).checked=true);
elements.get('cellSize').value='44';
elements.get('segmentSizeInput').value='10';
elements.get('scrollMode').value='center';

const document={
  body:new El('body','BODY'),
  activeElement:null,
  visibilityState:'visible',
  getElementById:(id)=>elements.get(id)||null,
  createElement:(tag)=>{const e=new El('',tag.toUpperCase());if(tag==='input')e.type='text';return e;},
  addEventListener(){},
  querySelector(){return null;}
};
const windowObj={
  document,
  devicePixelRatio:2,
  location:{search:'?project=starter-geometric-bloom-demo',href:'viewer.html?project=starter-geometric-bloom-demo'},
  addEventListener(){},
  dispatchEvent(){},
};
const progress={completed:[],current:{row:1,segment:1,stitch:1},view:{cellSize:44,focusSegment:true,showGrid:true,showSymbols:true,showFoundation:false,scrollMode:'center',keepScreenAwake:false,crochetMode:false,segmentSize:10}};
const project={id:'starter-geometric-bloom-demo',name:'Demo',chart:demo,progress,details:{},rowNotes:{},notes:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
const ProjectStore={
  async init(){},async get(){return JSON.parse(JSON.stringify(project));},validateChart(x){return x;},normalizeProgress(x){return Object.assign(JSON.parse(JSON.stringify(progress)),x,{view:Object.assign({},progress.view,x.view||{}),current:Object.assign({},progress.current,x.current||{})});},onAutoBackupStatus(fn){fn({supported:false,enabled:false,hasHandle:false});},async getAutoBackupStatus(){},saveRecoveryProgress(){},async updateProgress(){},async put(x){return x;},async updateChart(id,c){project.chart=c;return project;},async flushAutoBackup(){},async downloadProject(){},async enableAutoBackup(){},async reconnectAutoBackup(){},async backupNow(){}
};
let errors=[];
process.on('unhandledRejection',e=>errors.push(e));
const context={console,document,window:windowObj,navigator:{},ProjectStore,URLSearchParams,URL,Blob,Map,Set,Math,JSON,Date,Intl,Number,String,Boolean,Array,Object,Promise,setTimeout,clearTimeout,requestAnimationFrame:(f)=>setTimeout(f,0),ResizeObserver:class{constructor(cb){this.cb=cb;}observe(){this.cb();}},alert:()=>{},confirm:()=>true,CustomEvent:class{}};
context.globalThis=context;windowObj.ProjectStore=ProjectStore;
vm.createContext(context);
try{vm.runInContext(script,context,{filename:'viewer.js'});}catch(e){errors.push(e);}
setTimeout(()=>{
  if(errors.length){console.error(errors);process.exit(1);}
  const status=elements.get('status').textContent;
  if(!status) throw new Error('status not updated');
  console.log('viewer runtime smoke passed:',status,elements.get('activeSegmentStripSummary').textContent,elements.get('rowNoteNumber').textContent);
},120);
