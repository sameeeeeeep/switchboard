'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';

const words=['apps','harnesses','wrappers','Wrapps'];
function subscribeToMotion(change:()=>void){
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 motion.addEventListener('change',change);
 document.addEventListener('visibilitychange',change);
 return ()=>{motion.removeEventListener('change',change);document.removeEventListener('visibilitychange',change);};
}
const motionAllowed=()=>!document.hidden&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const serverMotion=()=>false;

export function useWordCycle(){
 const [index,setIndex]=useState(0);
 const [paused,setPaused]=useState(false);
 const allowed=useSyncExternalStore(subscribeToMotion,motionAllowed,serverMotion);
 useEffect(()=>{
  if(!allowed||paused)return;
  const timer=window.setInterval(()=>setIndex(i=>(i+1)%words.length),4000);
  return ()=>window.clearInterval(timer);
 },[allowed,paused]);
 return {index,paused,allowed,toggle:()=>setPaused(value=>!value)};
}

export function CyclingWord({cycle,punctuation=''}: {cycle:ReturnType<typeof useWordCycle>;punctuation?:string}){
 return <button type="button" className="v2-cycling-word" onClick={cycle.toggle} disabled={!cycle.allowed}
  aria-label={`${words[cycle.index]}. ${cycle.paused?'Resume':'Pause'} word cycling`}
  title={cycle.paused?'Resume word cycling':'Pause word cycling'}>
  {words.map((word,i)=><span key={word} aria-hidden="true" data-active={cycle.index===i}>{word}{punctuation}</span>)}
 </button>;
}
