'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, FolderOpen, AudioLines } from 'lucide-react';

export function SwitchboardScene({screen,model,tools}:{screen:string;model:'claude'|'codex';tools:string[]}) {
 const host=useRef<HTMLDivElement>(null);const screenRef=useRef(screen);const [paused,setPaused]=useState(false);const [fallback,setFallback]=useState(false);
 screenRef.current=screen;
 useEffect(()=>{
  let dispose=()=>{};let cancelled=false;
  (async()=>{
   const T=await import('three');if(cancelled||!host.current)return;
   const el=host.current;
   let renderer:InstanceType<typeof T.WebGLRenderer>;
   try{renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});}catch{setFallback(true);return;}
   renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setClearColor(0x000000,0);renderer.outputColorSpace=T.SRGBColorSpace;el.appendChild(renderer.domElement);
   const scene=new T.Scene();const camera=new T.PerspectiveCamera(33,1,.1,100);camera.position.set(0,6.7,9.5);camera.lookAt(0,.2,-.4);
   scene.add(new T.AmbientLight(0xbac8aa,2));const key=new T.DirectionalLight(0xddecc3,4);key.position.set(-3,7,5);scene.add(key);const rim=new T.PointLight(0xc8f250,30,10);rim.position.set(0,1,1);
   scene.add(rim);const board=new T.Group();scene.add(board);
   const shell=new T.Mesh(new T.BoxGeometry(2.9,.18,1.6),new T.MeshStandardMaterial({color:0x182017,metalness:.7,roughness:.35}));board.add(shell);
   const face=new T.Mesh(new T.BoxGeometry(2.74,.04,1.46),new T.MeshStandardMaterial({color:0x080d08,metalness:.15,roughness:.8}));face.position.y=.12;board.add(face);
   const dotGeometry=new T.SphereGeometry(.036,8,6);const dotMaterial=new T.MeshStandardMaterial({color:0xc8f250,emissive:0x91b52c,emissiveIntensity:1.2,roughness:.6});
   const dots=new T.InstancedMesh(dotGeometry,dotMaterial,135);const dummy=new T.Object3D();const colors:InstanceType<typeof T.Color>[]=[];
   for(let i=0;i<135;i++){dummy.position.set((i%15-7)*.165,.17,(Math.floor(i/15)-4)*.137);dummy.updateMatrix();dots.setMatrixAt(i,dummy.matrix);const color=new T.Color(0xc8f250).multiplyScalar(.15+((i*7)%13)/16);dots.setColorAt(i,color);colors.push(color);}board.add(dots);
   const grid=new T.GridHelper(18,60,0x465c27,0x1c2919);grid.position.y=-.15;const gm=grid.material as InstanceType<typeof T.Material>;gm.transparent=true;gm.opacity=.2;scene.add(grid);
   const routes=[new T.Vector3(-3.3,0,1.5),new T.Vector3(0,0,2.5),new T.Vector3(3.3,0,1.5)];
   const paths=routes.map(end=>new T.CatmullRomCurve3([new T.Vector3(0,.08,.7),new T.Vector3(end.x*.45,.04,1.15),end]));
   const traces=paths.map(path=>{const mesh=new T.Mesh(new T.TubeGeometry(path,40,.009,5,false),new T.MeshBasicMaterial({color:0x708d44,transparent:true,opacity:.6}));scene.add(mesh);return mesh;});
   const pulses=paths.map(()=>{const mesh=new T.Mesh(new T.SphereGeometry(.035,8,6),new T.MeshBasicMaterial({color:0xdeff9b}));scene.add(mesh);return mesh;});
   routes.forEach(p=>{const ring=new T.Mesh(new T.TorusGeometry(.09,.012,6,24),new T.MeshBasicMaterial({color:0x9dbe63}));ring.rotation.x=Math.PI/2;ring.position.copy(p);scene.add(ring);});
   const appPath=new T.CatmullRomCurve3([new T.Vector3(0,.1,-.75),new T.Vector3(0,.14,-1.6),new T.Vector3(0,.55,-2.2)]);
   scene.add(new T.Mesh(new T.TubeGeometry(appPath,30,.009,5,false),new T.MeshBasicMaterial({color:0x91b452})));
   const appSignal=new T.Mesh(new T.SphereGeometry(.045,10,6),new T.MeshBasicMaterial({color:0xdfff98}));scene.add(appSignal);
   const screenMaterial=new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide});const display=new T.Mesh(new T.PlaneGeometry(3.8,2.35),screenMaterial);display.position.set(0,1.05,-2.35);display.quaternion.copy(camera.quaternion);scene.add(display);
   const frame=new T.Mesh(new T.PlaneGeometry(3.87,2.42),new T.MeshBasicMaterial({color:0x566546,side:T.DoubleSide}));frame.position.copy(display.position).add(new T.Vector3(0,-.012,-.01));frame.quaternion.copy(display.quaternion);scene.add(frame);
   let texture:InstanceType<typeof T.Texture>|undefined;let requested='';const loader=new T.TextureLoader();
   const resize=()=>{const {width,height}=el.getBoundingClientRect();renderer.setSize(width,height);camera.aspect=width/height;camera.position.z=width<600?13:9.5;camera.updateProjectionMatrix();renderer.render(scene,camera);};
   const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;let raf=0,visible=true,time=0,last=0;
   const render=(now:number)=>{if(cancelled)return;if(last&&!paused&&!reduced)time+=Math.max(0,Math.min(now-last,50))/1000;last=now;
    if(requested!==screenRef.current){requested=screenRef.current;loader.load(requested,loaded=>{if(cancelled){loaded.dispose();return;}texture?.dispose();texture=loaded;loaded.colorSpace=T.SRGBColorSpace;screenMaterial.map=loaded;screenMaterial.needsUpdate=true;renderer.render(scene,camera);});}
    board.rotation.y=Math.sin(time*.28)*.025;for(let i=0;i<paths.length;i++){pulses[i].position.copy(paths[i].getPoint((time*.24+i*.32)%1));pulses[i].visible=!reduced;}
    appSignal.position.copy(appPath.getPoint(1-(time*.25)%1));appSignal.visible=!reduced;
    for(let i=0;i<135;i++){const wave=Math.max(0,Math.sin(i%15*.33-time*2.3));dots.setColorAt(i,colors[i].clone().multiplyScalar(.55+wave*.8));}if(dots.instanceColor)dots.instanceColor.needsUpdate=true;
    renderer.render(scene,camera);if(visible&&!paused&&!reduced)raf=requestAnimationFrame(render);
   };
   const observer=new ResizeObserver(resize);observer.observe(el);const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;cancelAnimationFrame(raf);last=0;if(visible)render(performance.now());});intersection.observe(el);resize();render(performance.now());
   dispose=()=>{cancelAnimationFrame(raf);observer.disconnect();intersection.disconnect();scene.traverse(object=>{if(object instanceof T.Mesh||object instanceof T.LineSegments){object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];materials.forEach(m=>m.dispose());}});texture?.dispose();renderer.dispose();renderer.domElement.remove();};
  })().catch(()=>setFallback(true));
  return()=>{cancelled=true;dispose();};
 },[paused,screen]);
 return <div className="v2-machine" ref={host} aria-label="Switchboard routes an app to your AI, project context and connected tools">
  {fallback&&<img className="machine-fallback" src={screen} alt="Actual app interface"/>}
  <button className="v2-motion" onClick={()=>setPaused(x=>!x)} aria-label={paused?'Play diagram animation':'Pause diagram animation'}>{paused?<Play size={13}/>:<Pause size={13}/>}</button>
  <div className="machine-signature">SWITCHBOARD</div>
  <div className="machine-resources"><div><span>YOUR AI + CONNECTORS</span><img className="resource-provider" src={model==='claude'?'/brands/claude-code-wordmark.svg':'/brands/codex-wordmark.svg'} alt={model==='claude'?'Claude Code':'Codex'}/><div className="v2-tool-icons">{tools.map(name=><img key={name} src={'/connectors/'+name+'.svg'} alt={name}/>)}</div></div><div><span>YOUR PROJECT</span><strong><FolderOpen size={17}/>Brand context</strong></div><div><span>LOCAL MODELS</span><strong><AudioLines size={18}/>Voice + text</strong><small>Whisper · Ollama</small></div></div>
 </div>;
}
