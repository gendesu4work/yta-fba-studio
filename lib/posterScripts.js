// Ready-made page scripts for the Poster tab. Claude runs them with javascript_tool, so it never has to read whole pages
// (page dumps and screenshots are what made browser runs expensive). Each call returns a short JSON-able value.
// Learned from the live sites (2026-11): Flow is at flow.google.com with an agent prompt box that accepts paste; Meta's
// composer accepts a pasted caption, a scripted date and AM/PM, but hours/minutes need real typing (computer tool).

const FLOW_LIB = `window.__F={s:(ms)=>new Promise(r=>setTimeout(r,ms)),
b(re){return [...document.querySelectorAll('button,[role=button],[role=menuitem]')].find(e=>re.test(((e.getAttribute('aria-label')||'')+' '+(e.innerText||'')).trim()))},
lab(){return new Set([...document.querySelectorAll('button,[role=button]')].map(e=>(e.innerText||'').trim()).filter(Boolean))},
n(){return document.querySelectorAll('img[alt^="Tile displaying"]').length},
async start(p){const s=this.s;for(let i=0;i<30&&!this.b(/New project/i);i++)await s(300);
 const np=this.b(/New project/i);if(!np)return{ok:false,detail:'no New project button (signed in to Flow?)'};np.click();
 for(let i=0;i<40&&!location.pathname.includes('/project/');i++)await s(250);await s(2000);
 const st=[...document.querySelectorAll('button[aria-label="Settings"]')].pop();let sq=false;
 if(st){st.click();await s(900);const g=[...document.querySelectorAll('[role=radiogroup]')],pk=(re)=>{const x=g.find(y=>re.test(y.innerText)),r=x&&[...x.querySelectorAll('[role=radio]')].find(z=>re.test(z.innerText));if(r)r.click();return!!r};
  sq=pk(/1:1/);pk(/x2/);await s(300);const sv=this.b(/^Save$/);if(sv)sv.click();await s(700);}
 const box=document.querySelector('[role=textbox][aria-label="What do you want to create?"]');if(!box)return{ok:false,detail:'prompt box not found'};
 box.focus();const dt=new DataTransfer();dt.setData('text/plain',p);box.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));await s(600);
 const go=document.querySelector('button[aria-label="Start generation"]');if(!go||go.disabled)return{ok:false,detail:'Start generation not available'};
 const base=this.lab(),n0=this.n();go.click();this.bg(base,n0);return{ok:true,square:sq};},
async bg(base,n0){const s=this.s,t0=Date.now();
 while(Date.now()-t0<240000){await s(2000);
  const c=[...document.querySelectorAll('button')].find(e=>{const t=(e.innerText||'').trim();return !base.has(t)&&/^(Generate|Confirm|Yes|Continue|Approve|Create)( |$)/i.test(t)&&t.length<30});if(c){base.add(c.innerText.trim());c.click();}
  if(this.n()-n0>=2||(this.n()>n0&&Date.now()-t0>120000))break;}
 if(this.n()<=n0)return;await s(3000);
 const m=[...document.querySelectorAll('button[aria-label="More options"]')].find(e=>e.getBoundingClientRect().top<120);if(!m)return;m.click();await s(900);
 const d=[...document.querySelectorAll('[role=menuitem]')].find(e=>/Download project/i.test(e.innerText));if(!d)return;d.click();await s(1500);
 const ok=[...document.querySelectorAll('[role=dialog] button')].find(e=>e.innerText.trim()==='Download');if(ok)ok.click();}};
`;

// sched: null (post now) or { date: 'MM/DD/YYYY', hh: '07', mm: '51', ap: 'AM'|'PM' }
// Meta notes: use textContent, not innerText (innerText forces a layout per element and the composer has hundreds of
// buttons, which froze the page past the 45 s tool limit). Hours/minutes/AM-PM ignore scripted values but accept
// document.execCommand('insertText'), so no mouse/keyboard tool is needed.
const META_LIB = `window.__M={s:(ms)=>new Promise(r=>setTimeout(r,ms)),
tx(e){return((e.getAttribute('aria-label')||e.textContent||'')+'').replace(/[\\u200b\\s]+/g,' ').trim()},
b(re){return [...document.querySelectorAll('[role=button],button,[role=option],[role=menuitem],[role=menuitemradio]')].find(e=>re.test(this.tx(e)))},
ed(){return [...document.querySelectorAll('[contenteditable=true]')].find(e=>/Write into the dialogue box/.test(e.getAttribute('aria-label')||''))},
pg(){const c=document.querySelector('[role=combobox]');return c?this.tx(c):''},
async until(f,ms){for(const t=Date.now();Date.now()-t<ms;await this.s(250)){const v=f();if(v)return v;}return null},
async prep(page,cap){const s=this.s;
 if(!await this.until(()=>this.b(/^Add photo\\/video/),15000))return{ok:false,detail:'composer did not load'};
 if(!this.pg().includes(page)){const cb=document.querySelector('[role=combobox]');if(cb){cb.click();await s(1000);}const o=this.b(new RegExp(page.replace(/[.*+?^$()|[\\]\\\\]/g,'\\\\$&')));if(o){o.click();await s(1200);}
  if(!this.pg().includes(page))return{ok:false,detail:'could not select the Page "'+page+'"; it shows "'+this.pg()+'"'};}
 const w=[...document.querySelectorAll('[role=switch]')].find(x=>/Set date and time/.test(x.getAttribute('aria-label')||''));if(w&&w.getAttribute('aria-checked')==='true')w.click();
 const oc=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type==='file'){window.__fi=this;if(!this.isConnected){this.style.display='none';document.body.appendChild(this);}this.setAttribute('aria-label','ssimg7 upload');return;}return oc.call(this);};
 this.b(/^Add photo\\/video/).click();if(!await this.until(()=>window.__fi,4000))return{ok:false,detail:'file input not found'};
 const ed=this.ed();if(!ed)return{ok:false,detail:'caption box not found'};ed.focus();const dt=new DataTransfer();dt.setData('text/plain',cap);ed.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));await s(400);
 return{ok:true};},
state(){return{page:this.pg(),photo:[...document.querySelectorAll('img')].filter(i=>/^blob:|scontent/.test(i.src)&&i.width>60).length,caption:((this.ed()||{}).textContent||'').trim().slice(0,60)}},
async go(ai,page,cap,dry){const s=this.s;await this.until(()=>this.state().photo,10000);const st=this.state(),bad=[];
 if(!st.page.includes(page))bad.push('page');if(!st.photo)bad.push('photo');if(!st.caption||!cap.startsWith(st.caption.slice(0,20)))bad.push('caption');
 if(bad.length)return{ok:false,wrong:bad,state:st};if(dry)return{ok:true,dry:true,state:st};
 const t=[...document.querySelectorAll('[role=switch]')].find(x=>/\\bAI\\b/.test(x.getAttribute('aria-label')||''));if(t&&(t.getAttribute('aria-checked')==='true')!==!!ai){t.click();await s(500);}
 const btn=this.b(/^Publish$/);if(!btn||btn.getAttribute('aria-disabled')==='true')return{ok:false,detail:'Publish button not available',state:st};
 btn.click();
 const done=await this.until(()=>!this.b(/^Add photo\\/video/)||[...document.querySelectorAll('[role=alert],[role=dialog]')].some(e=>/error|couldn|can.t|failed|invalid/i.test(e.textContent)),30000);
 const err=[...document.querySelectorAll('[role=alert],[role=dialog]')].map(e=>e.textContent.trim()).filter(x=>/error|couldn|can.t|failed|invalid/i.test(x)).join(' | ');
 if(err)return{ok:false,detail:err.slice(0,200)};return done?{ok:true,detail:'published'}:{ok:false,detail:'no confirmation after 30s',state:this.state()};}};
`;

// Getting the library into the page cheaply (the script text was the biggest token cost):
// - Flow allows eval: the first run sends the library inline and keeps a copy in IndexedDB; later runs send a short
//   loader + call (FLOW(prompt, full)).
// - Meta's composer blocks eval but allows blob: scripts. A short loader (META) reads the library from IndexedDB and
//   runs it as a blob script. If it is missing, the loader adds a hidden file input and returns INSTALL_NEEDED; Claude
//   then uploads the library FILE (written by the app, so Claude never types it) and META_INSTALL stores and runs it.
// Bump a version whenever its library changes.
const LIBS = { flow: { v: '2', lib: FLOW_LIB, store: true }, meta: { v: '5', lib: META_LIB } };
const IDB = "var ssdb=()=>new Promise((r,j)=>{const q=indexedDB.open('ss_store',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});";
const flowInstall = (call) => `${FLOW_LIB}${IDB}try{var db=await ssdb();await new Promise(r=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(${JSON.stringify(FLOW_LIB)},'flow_v${LIBS.flow.v}');t.oncomplete=r;t.onerror=r});}catch(e){}${call}`;
const flowShort = (call) => `${IDB}var L=await ssdb().then(db=>new Promise(r=>{const g=db.transaction('kv').objectStore('kv').get('flow_v${LIBS.flow.v}');g.onsuccess=()=>r(g.result);g.onerror=()=>r(null)})).catch(()=>null);L?((0,eval)(L),${call}):'INSTALL_NEEDED'`;
const FLOW = (prompt, full = true) => { const call = `await __F.start(${JSON.stringify(prompt)})`; return full ? flowInstall(call) : flowShort(call); };

// window.* so the helpers survive between tool calls
const KIT = "window.ssdb=()=>new Promise((r,j)=>{const q=indexedDB.open('ss_store',1);q.onupgradeneeded=()=>q.result.createObjectStore('kv');q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)});"
  + "window.ssrun=L=>new Promise((ok,no)=>{const s=document.createElement('script');s.src=URL.createObjectURL(new Blob([L],{type:'text/javascript'}));s.onload=ok;s.onerror=no;document.head.appendChild(s)}).catch(()=>(0,eval)(L));"
  + "window.ssget=k=>ssdb().then(db=>new Promise(r=>{const g=db.transaction('kv').objectStore('kv').get(k);g.onsuccess=()=>r(g.result);g.onerror=()=>r(null)})).catch(()=>null);"
  + "window.ssinst=async k=>{const i=document.querySelector('input[aria-label=\"sslib7 loader\"]');const L=await i.files[0].text();const db=await ssdb();await new Promise(r=>{const t=db.transaction('kv','readwrite');t.objectStore('kv').put(L,k);t.oncomplete=r;t.onerror=r});await ssrun(L);i.remove();};";
const metaKey = () => `meta_v${LIBS.meta.v}`;
const metaCall = (page, caption) => `await __M.prep(${JSON.stringify(page)},${JSON.stringify(caption)})`;
const META = (page, caption) => `${KIT}var L=await ssget('${metaKey()}');L?(await ssrun(L),${metaCall(page, caption)}):(()=>{const i=document.createElement('input');i.type='file';i.style.display='none';i.setAttribute('aria-label','sslib7 loader');document.body.appendChild(i);return'INSTALL_NEEDED'})()`;
const META_INSTALL = (page, caption) => `await ssinst('${metaKey()}');${metaCall(page, caption)}`;
const META_FILE = () => ({ name: `${metaKey()}.js`, text: META_LIB });

module.exports = { FLOW, META, META_INSTALL, META_FILE, LIBS };
