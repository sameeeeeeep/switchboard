'use client';
// Showcase: the same brief runs in the wrapp first (a recreation of the real app screens), then plain
// Claude Code (a recreation of the real terminal) gets the same clock and we show where it got to.
// Illustrated timing. Brandbrain frames follow the real app: build form → "Setting up your brand…" →
// "Reading your market…" → research studio auto-build → "Your brand is built."
import {useEffect, useRef, useState, type ReactNode} from 'react';
import {RotateCcw, Play, Home, Rocket, Compass, Sparkles, Activity, Plus, ArrowLeft, Target, Check, Globe, Download, GitBranch, Boxes, Image as ImageIcon} from 'lucide-react';
import './harness-run.css';

type TermLine = {at:number; kind:'user'|'text'|'tool'|'sub'|'paste'|'spin'; text:string};
type Script = {brief:string; done:number; terminal:TermLine[]; ranOut:string; clockScale:number; native:[number,number]};

const scripts:Record<string,Script>={
 brandbrain:{brief:'Build Verra, a skincare brand for a simpler daily routine. Use my product notes.',done:9600,clockScale:16,native:[1100,660],
  terminal:[
   {at:200,kind:'user',text:'Build Verra, a skincare brand for a simpler daily routine. Use my product notes.'},
   {at:1500,kind:'spin',text:'Thinking…'},
   {at:2600,kind:'text',text:'I don’t see product notes in this directory. Paste them, or point me at the file?'},
   {at:3500,kind:'paste',text:'[Pasted text · 41 lines] product-notes.md'},
   {at:5000,kind:'spin',text:'Reading…'},
   {at:5900,kind:'text',text:'Got it. I’ll look at the category first.'},
   {at:6400,kind:'tool',text:'Web Search("simpler skincare routine brands")'},
   {at:7600,kind:'sub',text:'Did 1 search in 14s'},
   {at:8100,kind:'tool',text:'Fetch(https://…/best-minimal-skincare-brands)'},
   {at:9100,kind:'sub',text:'Received 48.1KB (200 OK)'},
   {at:9300,kind:'spin',text:'Researching…'}],
  ranOut:'You were the operator here — notes pasted by hand · still researching · nothing saved'},
 adforge:{brief:'Make three ads for Verra. Keep our positioning and brand voice.',done:7200,clockScale:16,native:[1100,720],
  terminal:[
   {at:200,kind:'user',text:'Make three ads for Verra. Keep our positioning and brand voice.'},
   {at:1400,kind:'spin',text:'Thinking…'},
   {at:2300,kind:'text',text:'What is Verra? Share the positioning, voice and any product details.'},
   {at:3300,kind:'paste',text:'[Pasted text · 30 lines] brand brief'},
   {at:4700,kind:'spin',text:'Drafting…'},
   {at:5600,kind:'text',text:'Three ad angles:  1. Routine — “Less to think about.”  2. Product — “Your daily essential.”  3. Lifestyle —'},
   {at:6800,kind:'text',text:'For the visuals you’ll want to take these into a design tool.'}],
  ranOut:'You were the operator here — brief pasted again · headlines as text · no images'},
 crest:{brief:'Explore a logo for Verra. Use the brand direction we already developed.',done:7400,clockScale:16,native:[1100,700],
  terminal:[
   {at:200,kind:'user',text:'Explore a logo for Verra. Use the brand direction we already developed.'},
   {at:1400,kind:'spin',text:'Thinking…'},
   {at:2300,kind:'text',text:'I don’t have that brand direction here. Paste it?'},
   {at:3300,kind:'paste',text:'[Pasted text · 18 lines] brand direction'},
   {at:4700,kind:'spin',text:'Thinking…'},
   {at:5600,kind:'text',text:'Three directions, described:  1. A lowercase wordmark with generous spacing —  2. A single-letter mark —'},
   {at:6900,kind:'text',text:'I can’t render images here. Take the descriptions to a logo tool.'}],
  ranOut:'You were the operator here — direction pasted again · descriptions only · nothing rendered'},
};

function clock(ms:number,scale:number){const s=Math.max(0,Math.round(ms*scale/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
const typed=(text:string,t:number,from:number,to:number)=>t<=from?'':t>=to?text:text.slice(0,Math.round(text.length*(t-from)/(to-from)));

// Draws children at a fixed "native" size and scales them to the container width.
function Frame({native,children,className}:{native:[number,number];children:ReactNode;className?:string}){
 const ref=useRef<HTMLDivElement>(null);const [w,setW]=useState(0);
 useEffect(()=>{const el=ref.current;if(!el)return;const ro=new ResizeObserver(([e])=>setW(e.contentRect.width));ro.observe(el);return()=>ro.disconnect();},[]);
 const scale=w?Math.max(.5,w/native[0]):1;const height=native[1]*scale;
 return <div ref={ref} className={'hc-frame '+(className??'')} style={{height,overflow:'hidden'}}><div className="hc-native" style={{width:native[0],height:native[1],transform:`scale(${scale})`}}>{children}</div></div>;
}

/* ---------- Brandbrain — recreation of the real screens ---------- */
function BBSidebar({stage,build}:{stage:'form'|'brand';build?:boolean}){
 return <aside className="bb-side"><div className="bb-logo"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="#C8F250" strokeWidth="2.2" strokeLinecap="round"><path d="M4 3v14M4 3h7a3 3 0 0 1 0 6H4M11 9l5 8"/></svg>brandbrain</div>
  {stage==='form'?<a className="bb-nav bb-nav-on"><Home size={13}/>Home</a>:<>
   <a className="bb-nav"><Home size={13}/>Home</a>
   <div className="bb-brandchip"><span>Verra</span><small>BUILDING</small></div>
   <a className="bb-nav bb-sub-head"><Rocket size={13}/>Launchpad<span>⌄</span></a>
   <a className={'bb-nav bb-sub'+(build?'':' bb-nav-on')}><i><Target size={10}/></i>Foundation</a>
   <a className={'bb-nav bb-sub'+(build?' bb-nav-on':'')}><i><Sparkles size={10}/></i>Build</a>
   <a className="bb-nav bb-sub"><i><Rocket size={10}/></i>Launch</a>
   <a className="bb-nav"><Activity size={13}/>OS</a></>}
  <div className="bb-side-foot"><a><Sparkles size={13}/>Ask brandbrain</a><a><Compass size={13}/>Discover brands</a><div className="bb-newrow"><button><Plus size={13}/>New brand</button><span>S</span></div></div>
 </aside>;
}
const marketCards=[['CATEGORY','Minimal-routine skincare'],['INCUMBENTS','The ten-step giants'],['NEW ENTRANTS','Three routine-first brands'],['HOW IT BEHAVES','Bought on trust, kept on habit'],['THE GAP','Fewer steps, proven'],['WHY NOW','Routine fatigue is public']];
const studioCards:[string,string,string,string?][]=[
 ['APPROACH','THE ENEMY','Ten-step routines'],
 ['IDENTITY','POSITIONING','Less, but considered.'],['IDENTITY','AUDIENCE','Routine minimalists'],['IDENTITY','BRAND NAME','Verra'],['IDENTITY','STORY & VOICE','The plainspoken minimalist'],['IDENTITY','VISUAL IDENTITY','The quiet shelf','palette'],
 ['MARKET','COMPETITOR DEEP-DIVE','The routine-first three'],['MARKET','PRICING','Accessible proof'],
 ['PRODUCT','PRODUCT FORM','One serum, one cleanser'],['PRODUCT','LAUNCH RANGE','One ritual, three steps']];
function BrandbrainScene({t,brief}:{t:number;brief:string}){
 if(t<2100){const typing=typed(brief,t,200,1300);const setting=t>=1400;
  return <div className="bb"><BBSidebar stage="form"/><main className="bb-main bb-form">
   <span className="bb-kicker">BUILD</span><h1>What are you building?</h1>
   <div className="bb-tabs"><b>I have a brand</b><span>I have an idea</span><span>I lived a gap</span><span>Clone a brand</span></div>
   <p>Describe it in a line — brandbrain fills in the rest, then walks you through every decision, showing how real brands made each call.</p>
   <div className="bb-textarea" data-on={typing.length>0}>{typing||'e.g. a new-age incense stick brand for gen z — relaxation, masking smoke, fragrance like candles'}{typing&&t<1300&&<i className="bb-caret"/>}</div>
   <div className="bb-launch"><Compass size={13}/>India<span>⌄</span></div>
   <div className="bb-formrow"><small>try an example</small><button className="bb-start" data-on={t>=1250} data-busy={setting}><Sparkles size={13}/>{setting?'Setting up your brand…':'Start building'}</button></div>
   <div className="bb-chip"><i/>Claude Code · Switchboard</div>
  </main></div>;}
 const build=t>=5800;const filled=marketCards.filter((_,i)=>t>=4200+i*250).length;const nStudio=studioCards.filter((_,i)=>t>=6100+i*250).length;const done=t>=8900;
 const groups=['APPROACH','IDENTITY','MARKET','PRODUCT'];
 return <div className="bb"><BBSidebar stage="brand" build={build}/><main className="bb-main">
  <div className="bb-top"><a><ArrowLeft size={12}/>all brands</a><span>/</span><h2>Verra</h2><div className="bb-chip bb-chip-top" data-busy={!done}><i/>{done?'Claude Code · idle':'Claude Code · working'}</div><div className="bb-region"><Compass size={12}/>India<span>›</span></div></div>
  {!build?<>
   <span className="bb-kicker">THE MARKET</span><h1>Reading your market…</h1>
   <p>Before you decide anything, brandbrain maps the category, how it behaves, who’s already in it — the incumbents and the new entrants — and where the gap is.</p>
   <div className="bb-spin"><i/>{t<2600?'Mapping the category, the landscape and the gap…':t<3300?'Web search · simpler skincare routine brands':t<4200?'Fetching 2 competitor sites · reading product-notes.md from your vault':'Mapping the category, the landscape and the gap…'}</div>
   <div className="bb-grid3">{marketCards.map(([k,v],i)=><div key={k} className="bb-card" data-on={i<filled}><small>{k}</small><strong>{v}</strong></div>)}</div>
  </>:<>
   <div className="bb-goal"><small><Target size={11}/>GOING AFTER</small><strong>A simpler daily ritual</strong><span>Fewer steps, clear ingredients, a routine people keep — proven against the ten-step incumbents.</span><em>change</em></div>
   <div className="bb-studio"><div><small>RESEARCH STUDIO</small><span><Check size={12}/>{nStudio<10?`Auto-building · ${nStudio} of 10`:'Auto-built · 10 to review'}</span></div><div className="bb-studio-tools"><b><Sparkles size={11}/>Auto-build on</b><span><Boxes size={11}/>Blueprint</span><span>Map</span></div><i style={{width:`${Math.max(4,nStudio*10)}%`}}/></div>
   {groups.map(g=>{const cards=studioCards.map((c,i)=>({c,i})).filter(({c})=>c[0]===g);const n=cards.filter(({i})=>i<nStudio).length;if(!n)return null;return <div key={g} className="bb-group"><div className="bb-group-head"><GitBranch size={11}/>{g}<span>{n}/{cards.length}</span></div><div className="bb-grid4">{cards.map(({c,i})=><div key={c[1]} className="bb-card bb-card-s" data-on={i<nStudio}><small>{c[1]}</small><strong>{c[2]}</strong>{c[3]==='palette'&&<span className="bb-palette"><i style={{background:'#f2efe4'}}/><i style={{background:'#1b1d1a'}}/><i style={{background:'#8a8f86'}}/><i style={{background:'#637752'}}/></span>}<b className={i<nStudio-2?'ok':''}/></div>)}</div></div>;})}
   <div className="bb-foot" data-on={done}><span>Your brand is built.</span><button><Sparkles size={12}/>View one-pager</button><button className="bb-primary"><Rocket size={12}/>Take it to Launch Studio →</button></div>
  </>}
 </main></div>;
}

/* ---------- AdForge — recreation ---------- */
const concepts=[['UGC HOOK','I forgot I was wearing anything.','Less to think about. One serum, one cleanser, out the door — and skin that stays calm through a real day.','Less to think about','Shop now →'],['PROBLEM → AGITATE → SOLVE','Your routine has ten steps. Your morning has ten minutes.','Verra is the routine you can actually keep: clear ingredients, one uncomplicated ritual.','Your daily essential','Learn more →'],['OFFER-LED URGENCY','Most brands sell you more steps. We sell you fewer.','Three products. One ritual. Made for real mornings, not shelfies.','Made for real mornings','Get offer →']];
function AdForgeScene({t,brief}:{t:number;brief:string}){
 const typing=typed(brief,t,200,1100);const forging=t>=1300;const log=[[1500,'brand loaded from switchboard — verra · positioning, voice, palette, product image'],[2300,'claude · drafting three concepts against your positioning'],[3100,'image tool · rendering product-in-scene ×3'],[6400,'saved to verra — 3 concepts, pick one below']].filter(([at])=>t>=Number(at));
 return <div className="af"><header className="af-top"><span className="af-logo">AdForge</span><span className="af-chip"><i/>Verra · via Switchboard</span></header>
  <div className="af-row"><div className="af-brand"><ImageIcon size={12}/>Verra <small>brand from Switchboard</small></div><button className="af-forge" data-on={forging}>{t>=6400?'Forged ✓':forging?'Forging…':'Forge concepts'}</button></div>
  <div className="af-sub"><span>Use a URL instead</span><span>See a sample — Allbirds</span><span className="af-ok">Switchboard connected — <b>your Claude</b> forges for real.</span></div>
  <small className="af-kicker">ANGLE STEER · OPTIONAL</small>
  <div className="af-input" data-on={typing.length>0}>{typing||'one line to steer all three concepts — e.g. founder story, urgency, UGC hook'}</div>
  <div className="af-log" data-on={log.length>0}><small>● FORGE LOG</small>{log.map(([,l])=><p key={String(l)}>{l}</p>)}</div>
  <div className="af-concepts" data-on={t>=3800}><div className="af-concepts-head"><small>02 · THREE CONCEPTS — PICK ONE</small><span>Regenerate</span></div>
   <div className="af-context"><b>Verra</b>A simpler daily routine — one serum, one cleanser, clear ingredients. Warm, honest, unfussy.</div>
   <div className="af-grid">{concepts.map((c,i)=><article key={c[0]} data-on={t>=4200+i*800}><div className="af-card-top"><small>{c[0]}</small>{i===0&&<b>RECOMMENDED</b>}</div><h3>{c[1]}</h3><div className="af-visual"><span className="af-bottle"><i/><b>v.</b></span><span>verra</span></div><p>{c[2]}</p><footer><strong>{c[3]}</strong><span>{c[4]}</span></footer></article>)}</div>
  </div>
 </div>;
}

/* ---------- Crest — recreation ---------- */
function CrestScene({t,brief}:{t:number;brief:string}){
 const typing=typed(brief,t,200,1100);const run=t>=1300;
 const steps=[[1500,'brand foundation · your Claude'],[2800,'three directions · your Claude'],[3800,'rendering four marks · Higgsfield via Switchboard'],[6600,'saved to Verra · same palette']].filter(([at])=>t>=Number(at));
 return <div className="cr"><header className="cr-top"><span className="cr-logo">▪ CR EST</span><span className="cr-chip"><i/>Connected · Verra</span></header>
  <h1>A brief in. <em>A logo out.</em></h1>
  <p>Describe your brand in a line — your own Claude drafts a brand foundation and three directions, you pick a look, and Crest renders four marks. Runs on your Claude + Higgsfield via Switchboard — the operator holds no key and never sees your data.</p>
  <small className="cr-kicker">YOUR BRIEF (VERRA DIRECTION ATTACHED)</small>
  <div className="cr-input" data-on={typing.length>0}>{typing||'Northwind — a small-batch coffee roaster for early-morning commuters…'}<button data-on={run}>{t>=6600?'Done ✓':run?'Running…':'Run'}</button></div>
  <ol className="cr-steps">{steps.map(([,s],i)=><li key={String(s)} data-live={i===steps.length-1&&t<6600}>{s}</li>)}</ol>
  <div className="cr-found" data-on={t>=2600}><small>FOUNDATION</small><span><b>Audience</b>Routine minimalists</span><span><b>Positioning</b>Less, but considered.</span><span><b>Palette</b><i style={{background:'#f2efe4'}}/><i style={{background:'#1b1d1a'}}/><i style={{background:'#637752'}}/></span></div>
  <div className="cr-dirs" data-on={t>=3600}>{[['Everyday warmth','lowercase wordmark'],['The essential mark','single letter'],['Quiet confidence','spaced caps']].map(([a,b],i)=><span key={a} data-pick={i===0}><b>{a}</b>{b}</span>)}</div>
  <div className="cr-marks" data-on={t>=4300}>{['verra','v.','VERRA','vé'].map((m,i)=><div key={m} data-on={t>=4300+i*600} className={'cr-mark cr-mark-'+i}><strong>{m}</strong><small>{['wireframe','real image','real image','real image'][i]}</small></div>)}</div>
 </div>;
}

/* ---------- Claude Code — recreation of the terminal ---------- */
function ClaudeCodeScene({t,s,running}:{t:number;s:Script;running:boolean}){
 const lines=s.terminal.filter(l=>l.at<=t);const last=lines[lines.length-1];
 return <div className="cc">
  <div className="cc-banner"><b>✻ Welcome to Claude Code!</b><span>/help for help, /status for your current setup</span><span>cwd: /Users/you/verra</span></div>
  {lines.map((l,i)=>{const isLast=i===lines.length-1;if(l.kind==='spin')return isLast&&running?<div key={i} className="cc-spin"><b>✻</b> {l.text} <i>(esc to interrupt)</i></div>:null;
   if(l.kind==='user')return <div key={i} className="cc-user"><b>&gt;</b> {typed(l.text,t,l.at,l.at+1100)}</div>;
   if(l.kind==='paste')return <div key={i} className="cc-user"><b>&gt;</b> <i>{l.text}</i></div>;
   if(l.kind==='tool')return <div key={i} className="cc-tool"><b>⏺</b> {l.text}</div>;
   if(l.kind==='sub')return <div key={i} className="cc-sub">⎿ {l.text}</div>;
   return <div key={i} className="cc-text"><b>⏺</b> {l.text}</div>;})}
  {!running&&last&&last.kind==='spin'&&<div className="cc-spin cc-spin-stopped"><b>✻</b> {last.text}</div>}
  <div className="cc-prompt"><span>&gt;</span><i/></div>
  <div className="cc-hint">? for shortcuts</div>
 </div>;
}

export default function HarnessRun({id,name,icon}:{id:string;name:string;icon:string}){
 const s=scripts[id]??scripts.brandbrain;
 const [phase,setPhase]=useState<'idle'|'harness'|'terminal'|'done'>('idle');
 const [t,setT]=useState(0);
 const [reduced,setReduced]=useState(false);
 const root=useRef<HTMLDivElement>(null);
 const started=useRef(false);
 useEffect(()=>{setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);},[]);
 useEffect(()=>{const el=root.current;if(!el||started.current)return;const io=new IntersectionObserver(([e])=>{if(e.isIntersecting&&!started.current){started.current=true;setPhase('harness');setT(0);io.disconnect();}},{threshold:.3});io.observe(el);return()=>io.disconnect();},[]);
 useEffect(()=>{if(phase!=='harness'&&phase!=='terminal')return;if(reduced){setT(s.done);setPhase('done');return;}
  const start=Date.now();const iv=window.setInterval(()=>{const e=Date.now()-start;if(e>=s.done){window.clearInterval(iv);setT(s.done);setPhase(p=>p==='harness'?'terminal':'done');return;}setT(e);},60);return()=>window.clearInterval(iv);},[phase,reduced,s.done]);
 const replay=()=>{started.current=true;setPhase('idle');setT(0);window.setTimeout(()=>setPhase('harness'),60);};
 const hT=phase==='idle'?0:phase==='harness'?t:s.done;
 const cT=phase==='terminal'?t:phase==='done'?s.done:0;
 const hs=phase==='idle'?['WAITING','']:phase==='harness'?['RUNNING',clock(hT,s.clockScale)]:['DONE',clock(s.done,s.clockScale)];
 const cs=phase==='terminal'?['RUNNING',clock(cT,s.clockScale)]:phase==='done'?['TIME’S UP',clock(s.done,s.clockScale)]:['WAITING','gets the same clock'];
 const Scene=id==='adforge'?AdForgeScene:id==='crest'?CrestScene:BrandbrainScene;
 return <div ref={root} className="hc" data-phase={phase}>
  <div className="hc-brief"><span className="hc-brief-label">ONE BRIEF</span><p>{s.brief}</p>
   <button onClick={replay} className="hc-replay">{phase==='done'?<RotateCcw size={12}/>:<Play size={12}/>}{phase==='done'?'Replay':phase==='idle'?'Play':'Running'}</button></div>
  <section className="hc-win hc-app" data-state={hs[0].toLowerCase()} aria-label={name+' running on your Claude Code'}>
   <header><img src={icon} alt=""/><span>{name}</span><small>a harness on your Claude Code · Switchboard is the operator</small><b className="hc-status"><i/>{hs[0]}{hs[1]&&<em>{hs[1]}</em>}</b></header>
   <Frame native={s.native}><Scene t={hT} brief={s.brief}/></Frame>
  </section>
  <section className="hc-win hc-term" data-state={cs[0].toLowerCase().replace(/[^a-z]/g,'')} aria-label="The same brief in Claude Code">
   <header><span className="hc-term-dots"><i/><i/><i/></span><span>Claude Code</span><small>same brief · you are the operator</small><b className="hc-status"><i/>{cs[0]}{cs[1]&&<em>{cs[1]}</em>}</b></header>
   <div className="hc-term-body">
    {(phase==='idle'||phase==='harness')?<p className="hc-term-wait">Waits for {name} to finish, then gets the same {clock(s.done,s.clockScale)}.</p>:<ClaudeCodeScene t={cT} s={s} running={phase==='terminal'}/>}
    {phase==='done'&&<div className="hc-ranout"><span>⏱ {clock(s.done,s.clockScale)}</span>{s.ranOut}</div>}
   </div>
  </section>
 </div>;
}
