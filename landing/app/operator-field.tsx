'use client';

import { useEffect, useRef } from 'react';

type Point = { x: number; y: number };
type Route = { points: Point[]; label: string };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function onRoute(points: Point[], t: number): Point {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  let distance = Math.max(0, Math.min(1, t)) * lengths.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (distance <= lengths[i] || i === lengths.length - 1) {
      const fraction = lengths[i] ? distance / lengths[i] : 0;
      return { x: mix(points[i].x, points[i + 1].x, fraction), y: mix(points[i].y, points[i + 1].y, fraction) };
    }
    distance -= lengths[i];
  }
  return points[0];
}

// A depth-projected dot field and signal paths anchored to the actual interface ports.
// No video loop: direction, destinations, packets and lighting follow the current call.
export function OperatorField({ beat, active, local, resource, output }: { beat: number; active: boolean; local: boolean; resource: string; output: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(0);
  const call = useRef('');
  useEffect(() => {
    const key = `${beat}:${resource}:${output}`;
    if(call.current !== key){ elapsed.current = 0; call.current = key; }
    const element = canvas.current;
    const plane = element?.parentElement;
    if (!element || !plane) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    let width = 0, height = 0, raf = 0, last = 0, inView = true;
    let nodes: Record<string, Point> = {};
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const measure = () => {
      const box = plane.getBoundingClientRect();
      width = box.width; height = box.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const position = (selector: string, edge: 'top' | 'bottom' | 'center' = 'top') => {
        const rect = plane.querySelector(selector)?.getBoundingClientRect();
        return rect ? { x: rect.left + rect.width / 2 - box.left, y: rect.top - box.top + (edge === 'center' ? rect.height / 2 : edge === 'bottom' ? rect.height : 0) } : { x: width / 2, y: 140 };
      };
      const harness = plane.parentElement?.querySelector('.agent-harness')?.getBoundingClientRect();
      nodes = { app: {x: harness ? harness.left + harness.width/2 - box.left : width/2, y: 0}, gateway: position('.gateway-surface','center'), ai: position('.resource-compute'), context: position('.project-bank'), voice: position('.local-bank'), tools: position('.connector-bank'), aiOut: position('.resource-compute','bottom') };
    };
    const connect = (a: Point, b: Point) => [a, {x:a.x, y: a.y + (b.y - a.y) * .6}, {x:b.x,y:a.y + (b.y-a.y)*.6}, b];
    const draw = (now: number) => {
      if (last && active && inView && !reduced) elapsed.current += Math.min(now - last, 50);
      last = now;
      const t = elapsed.current / 1000;
      ctx.clearRect(0,0,width,height);
      const g = nodes.gateway;
      if (!g) return;
      // Perspective expands toward the resource ports, keeping the product the focal point.
      for(let row=0;row<32;row++) {
        const depth=row/31, y=30+depth*depth*Math.min(height,420), spacing=9+depth*8;
        for(let col=-34;col<=34;col++) {
          const x=width/2+col*spacing;
          if(x<0 || x>width)continue;
          const distance=Math.hypot((x-g.x)*.6,y-g.y);
          const wave=active && !reduced ? Math.max(0,1-Math.abs((distance-t*85+900)%230-115)/18)*.28 : 0;
          const fade=Math.max(0,1-Math.abs(col)/35)*(1-depth*.7);
          ctx.fillStyle=`rgba(177,203,131,${(.085+wave)*fade})`;
          ctx.beginPath();ctx.arc(x,y,.7+depth*.3,0,Math.PI*2);ctx.fill();
        }
      }
      const edges = [connect(nodes.app,g),connect(g,nodes.ai),connect(g,nodes.context),connect(g,nodes.voice),connect(nodes.aiOut,nodes.tools)];
      const stroke = (points: Point[]) => {ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.stroke();};
      ctx.strokeStyle='#71865a99';ctx.lineWidth=1;ctx.lineJoin='round';ctx.setLineDash([2,5]);edges.forEach(stroke);ctx.setLineDash([]);
      let route: Route | undefined;
      const through = (from: Point, to: Point) => [...connect(from,g),...connect(g,to).slice(1)];
      if(beat===1)route={points:connect(nodes.app,g),label:'START HARNESS'};
      if(beat===2)route={points:through(nodes.voice,nodes.app),label:'TRANSCRIBED'};
      if(beat===3)route={points:through(nodes.context,nodes.app),label:local?'DICTIONARY':'VERRA CONTEXT'};
      if(beat===4)route={points:through(nodes.app,nodes.ai),label:resource || 'TOOL CALL'};
      if(beat>=5 && beat<=7)route={points:through(local?nodes.voice:nodes.ai,nodes.app),label:local?'LOCAL RESULT':'STREAMING RESULT'};
      if(beat===8)route={points:through(nodes.app,nodes.context),label:output};
      if(beat===9)route={points:through(nodes.app,nodes.voice),label:'READ BACK'};
      if(route && !reduced) {
        ctx.lineWidth=1.5;ctx.strokeStyle='rgba(192,242,112,.25)';stroke(route.points);
        const progress=(t*.9)%1;
        for(let i=16;i>=0;i--){
          const p=onRoute(route.points,Math.max(0,progress-i*.006));
          ctx.fillStyle=`rgba(208,255,144,${(1-i/17)*.8})`;ctx.beginPath();ctx.arc(p.x,p.y,i===0?2.5:1.4,0,Math.PI*2);ctx.fill();
        }
        const p=onRoute(route.points,progress);
        const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,15);glow.addColorStop(0,'#c8f25055');glow.addColorStop(1,'#c8f25000');ctx.fillStyle=glow;ctx.fillRect(p.x-15,p.y-15,30,30);

      }
      if(active && inView && !reduced)raf=requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(()=>{measure();if(!active || !inView || reduced)draw(performance.now());});
    const visibility = new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;cancelAnimationFrame(raf);last=0;if(inView)draw(performance.now());});
    measure();observer.observe(plane);visibility.observe(plane);draw(performance.now());
    return ()=>{cancelAnimationFrame(raf);observer.disconnect();visibility.disconnect();};
  },[beat,active,local,resource,output]);
  return <canvas ref={canvas} className="operator-field" aria-hidden="true" />;
}
