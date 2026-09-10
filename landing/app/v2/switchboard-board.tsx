'use client';
import {useEffect, useState} from 'react';
import './board.css';

/* The board: every app calls in on the top rail, passes the consent gate, and is patched
   through to the user's own AI, connectors, context, data and local models on the bank below.
   Illustrated routing; no live model calls. */

type Jack = {id:string; x:number; y:number; label:string; img?:string; glyph?:'files'|'web'|'folder'|'mic'|'cpu'|'clock'};
const APPS:Jack[] = [
  {id:'brandbrain', x:125, y:74, label:'Brandbrain', img:'/wrapps/brandbrain.png'},
  {id:'adforge',    x:270, y:74, label:'AdForge',    img:'/wrapps/adforge.png'},
  {id:'redline',    x:415, y:74, label:'Redline',    img:'/wrapps/redline.png'},
  {id:'crest',      x:560, y:74, label:'Crest',      img:'/wrapps/crest.png'},
  {id:'flow',       x:705, y:74, label:'Flow',       img:'/wrapps/flow.png'},
  {id:'autopilot',  x:850, y:74, label:'Autopilot · 07:00', glyph:'clock'},
];
const BANK:Jack[] = [
  {id:'claude', x:110, y:392, label:'Claude Code', img:'/brands/claude-code.png'},
  {id:'codex',  x:190, y:392, label:'Codex',       img:'/brands/codex.png'},
  {id:'files',  x:300, y:392, label:'Files',  glyph:'files'},
  {id:'web',    x:370, y:392, label:'Web',    glyph:'web'},
  {id:'github', x:440, y:392, label:'GitHub', img:'/connectors/github.svg'},
  {id:'notion', x:510, y:392, label:'Notion', img:'/connectors/notion.svg'},
  {id:'meta',   x:580, y:392, label:'Meta Ads', img:'/connectors/meta.svg'},
  {id:'vault',  x:680, y:392, label:'brand vault', glyph:'folder'},
  {id:'data',   x:750, y:392, label:'your files',  glyph:'folder'},
  {id:'whisper',x:820, y:392, label:'Whisper', glyph:'mic'},
  {id:'ollama', x:870, y:392, label:'Ollama',  glyph:'cpu'},
];
const GROUPS = [
  {x:72,  w:170, label:'YOUR AI'},
  {x:262, w:360, label:'YOUR CONNECTORS'},
  {x:642, w:150, label:'CONTEXT · DATA'},
  {x:796, w:98,  label:'LOCAL'},
];
type Call = {app:string; to:string[]; line:string; result:string};
const CALLS:Call[] = [
  {app:'brandbrain', to:['claude','web','vault'],        line:'Brandbrain asks for your Claude, the web and the brand vault', result:'market brief · saved to the vault'},
  {app:'adforge',    to:['claude','vault','meta'],       line:'AdForge asks for your Claude, the vault and Meta Ads',          result:'three ad concepts · on brand'},
  {app:'redline',    to:['codex','files','vault'],       line:'Redline asks for Codex, your files and the vault',              result:'11 copy edits · staged, not written'},
  {app:'flow',       to:['whisper','ollama'],            line:'Flow asks for Whisper and Ollama, on the machine',              result:'dictated · nothing left the Mac'},
  {app:'crest',      to:['claude','vault','data'],       line:'Crest asks for your Claude, the vault and your files',          result:'three logo directions'},
  {app:'autopilot',  to:['claude','vault','meta','github'], line:'Autopilot, on the clock, asks for your Claude, the vault, Meta Ads and GitHub', result:'3 moves drafted · outward ones wait at the gate'},
];
const GATE = {x:450, y:236};

function cord(a:{x:number;y:number}, b:{x:number;y:number}){
  const sag = 34 + Math.abs(a.x-b.x)*0.08;
  const my = (a.y+b.y)/2 + sag;
  return `M${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;
}
function Glyph({kind}:{kind:NonNullable<Jack['glyph']>}){
  const p = {
    files:'M4 3h5l2 2h9v13H4z', web:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 0c3 3 3 15 0 18m0-18c-3 3-3 15 0 18M3 12h18',
    folder:'M3 5h6l2 2h10v12H3z', mic:'M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm-6 9a6 6 0 0 0 12 0M12 18v3',
    cpu:'M8 8h8v8H8zM4 10h2M4 14h2M18 10h2M18 14h2M10 4v2M14 4v2M10 18v2M14 18v2', clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 4v5l3 2',
  }[kind];
  return <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={p}/></svg>;
}

export default function SwitchboardBoard(){
  const [i,setI] = useState(0);
  const [phase,setPhase] = useState(0); // 0 ring · 1 gate · 2 patched · 3 result
  const [motion,setMotion] = useState(true);
  useEffect(()=>{
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMotion(!m.matches);
    const f = ()=>setMotion(!m.matches); m.addEventListener('change',f); return ()=>m.removeEventListener('change',f);
  },[]);
  useEffect(()=>{
    if(!motion){setPhase(3);return;}
    setPhase(0);
    const t = [
      window.setTimeout(()=>setPhase(1), 700),
      window.setTimeout(()=>setPhase(2), 1500),
      window.setTimeout(()=>setPhase(3), 3100),
      window.setTimeout(()=>setI(v=>(v+1)%CALLS.length), 5200),
    ];
    return ()=>t.forEach(window.clearTimeout);
  },[i,motion]);
  const call = CALLS[i];
  const app = APPS.find(a=>a.id===call.app)!;
  const targets = call.to.map(id=>BANK.find(b=>b.id===id)!);
  return (
    <div className="board" data-phase={phase}>
      <svg viewBox="0 0 900 520" role="img" aria-label="Switchboard: apps on the top rail are patched through a consent gate to your own AI, connectors, context and local models">
        <defs>
          <linearGradient id="bd-panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#151b12"/><stop offset=".5" stopColor="#0d120b"/><stop offset="1" stopColor="#090c08"/></linearGradient>
          <linearGradient id="bd-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0"/><stop offset=".5" stopColor="#fff" stopOpacity=".05"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient>
          <radialGradient id="bd-hole" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#000"/><stop offset=".7" stopColor="#050705"/><stop offset="1" stopColor="#2a3524"/></radialGradient>
          <radialGradient id="bd-bezel" cx=".4" cy=".35" r=".7"><stop offset="0" stopColor="#5a6a48"/><stop offset="1" stopColor="#1c2418"/></radialGradient>
          <radialGradient id="bd-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#c8f250" stopOpacity=".5"/><stop offset="1" stopColor="#c8f250" stopOpacity="0"/></radialGradient>
          <filter id="bd-shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity=".7"/></filter>
          <filter id="bd-soft"><feGaussianBlur stdDeviation="1.2"/></filter>
          <clipPath id="bd-r8"><rect x="-13" y="-13" width="26" height="26" rx="7"/></clipPath>
        </defs>

        {/* panel */}
        <g filter="url(#bd-shadow)"><rect x="12" y="12" width="876" height="496" rx="18" fill="url(#bd-panel)" stroke="#2a3524"/></g>
        <rect x="12" y="12" width="876" height="496" rx="18" fill="url(#bd-sheen)"/>
        {[[30,30],[870,30],[30,490],[870,490]].map(([x,y])=><g key={x+'-'+y}><circle cx={x} cy={y} r="5" fill="url(#bd-bezel)"/><path d={`M${x-2.5} ${y-2.5} L${x+2.5} ${y+2.5}`} stroke="#0a0d08" strokeWidth="1.2"/></g>)}
        <text x="450" y="40" textAnchor="middle" className="bd-name">SWITCHBOARD</text>
        <text x="60" y="40" className="bd-tiny">CALLS IN</text>
        <text x="840" y="40" textAnchor="end" className="bd-tiny">YOUR MACHINE</text>

        {/* group brackets on the bank */}
        {GROUPS.map(g=><g key={g.label}><path d={`M${g.x} 348 v-6 h${g.w} v6`} fill="none" stroke="#2f3b28"/><text x={g.x+g.w/2} y="334" textAnchor="middle" className="bd-tiny">{g.label}</text></g>)}
        
        {/* consent gate */}
        <g className="bd-gate" data-on={phase>=1}>
          <rect x={GATE.x-190} y={GATE.y-26} width="380" height="52" rx="8" fill="#0a0e08" stroke="#2f3b28"/>
          <rect x={GATE.x-190} y={GATE.y-26} width="380" height="52" rx="8" fill="url(#bd-glow)" className="bd-gate-glow"/>
          <circle cx={GATE.x-162} cy={GATE.y} r="5" className="bd-lamp"/>
          <text x={GATE.x-146} y={GATE.y+4} className="bd-gate-text">CONSENT GATE · you approve each app once</text>
          <text x={GATE.x+174} y={GATE.y+4} textAnchor="end" className="bd-gate-state">{phase>=1?'GRANTED':'WAITING'}</text>
        </g>

        {/* cords: app → gate → targets. shadow / body / core */}
        <g className="bd-cords">
          {[cord(app,GATE), ...targets.map(t=>cord(GATE,t))].map((d,k)=>{
            const on = k===0 ? phase>=0 : phase>=2;
            return <g key={i+'-'+k} className="bd-cord" data-on={on} data-late={k>0}>
              <path d={d} className="bd-cord-shadow"/>
              <path d={d} className="bd-cord-body"/>
              <path d={d} className="bd-cord-core" pathLength={1}/>
              <path d={d} className="bd-cord-signal" pathLength={1}/>
            </g>;
          })}
        </g>

        {/* app jacks (top rail) */}
        {APPS.map(a=>{
          const live = a.id===call.app;
          return <g key={a.id} className="bd-jack bd-app" data-live={live} transform={`translate(${a.x} ${a.y})`}>
            <circle r="22" fill="url(#bd-bezel)"/><circle r="17" fill="url(#bd-hole)"/>
            {a.img ? <image href={a.img} x="-13" y="-13" width="26" height="26" clipPath="url(#bd-r8)"/> : <g className="bd-glyph" transform="translate(-7 -7)"><Glyph kind={a.glyph!}/></g>}
            <circle cx="0" cy="-30" r="3.5" className="bd-lamp"/>
            <text y="42" textAnchor="middle" className="bd-label">{a.label}</text>
          </g>;
        })}

        {/* bank jacks */}
        {BANK.map(b=>{
          const live = call.to.includes(b.id) && phase>=2;
          return <g key={b.id} className="bd-jack bd-bank" data-live={live} transform={`translate(${b.x} ${b.y})`}>
            <circle r="20" fill="url(#bd-bezel)"/><circle r="15" fill="url(#bd-hole)"/>
            {b.img ? <image href={b.img} x="-11" y="-11" width="22" height="22" clipPath="url(#bd-r8)"/> : <g className="bd-glyph" transform="translate(-7 -7)"><Glyph kind={b.glyph!}/></g>}
            <circle cx="0" cy="-27" r="3" className="bd-lamp"/>
            <text y="38" textAnchor="middle" className="bd-label">{b.label}</text>
          </g>;
        })}
      </svg>

      <div className="bd-log" aria-live="polite">
        <span className="bd-log-dot"/>
        <span className="bd-log-line">{phase<3 ? call.line : call.result}</span>
        <span className="bd-log-state">{['RINGING','AT THE GATE','PATCHED THROUGH','BACK IN THE APP'][phase]}</span>
      </div>
    </div>
  );
}
