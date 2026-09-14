'use client';
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react';

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
 const button=useRef<HTMLButtonElement>(null);
 const text=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{
  const element=text.current;
  if(!element)return;
  const fit=()=>{
   if(button.current)button.current.style.width=`${element.getBoundingClientRect().width}px`;
  };
  fit();
  // Re-measure after a font loads or the responsive heading size changes.
  const observer=new ResizeObserver(fit);
  observer.observe(element);
  return ()=>observer.disconnect();
 },[cycle.index,punctuation]);
 return <button ref={button} type="button" className="v2-cycling-word" onClick={cycle.toggle} disabled={!cycle.allowed}
  aria-label={`${words[cycle.index]}. ${cycle.paused?'Resume':'Pause'} word cycling`}
  title={cycle.paused?'Resume word cycling':'Pause word cycling'}>
  <span ref={text} aria-hidden="true"><span key={words[cycle.index]} className="v2-cycling-word-text">{words[cycle.index]}{punctuation}</span></span>
 </button>;
}
