# thelastprompt.ai — new homepage

Everything needed to build it is in this doc. The complete, verified file is embedded at the
bottom.

## Goal
Replace the current (too-descriptive) homepage at the site root with a minimal, **scroll-driven**
hero. No marketing copy walls — the animation makes the point.

## What it does (scroll-scrubbed, not autoplay)
A full-screen sticky stage over a ~6-screen scroll region. Scroll position drives everything;
scrubbing back reverses it.

| scroll | beat |
|--------|------|
| 0% | two hands (Creation-of-Adam pose) apart, forearms from the screen edges + "scroll ↓" hint |
| ~20% | hands draw together, index fingertips nearly touching (the gap = "one prompt away") |
| ~26% | fingertips meet → spark bloom |
| ~30% | burst into particles + shockwave ring |
| 5–28% | line over the hands: **"you're one prompt away from superintelligence"** |
| 42–66% | **"the last prompt helps you close that gap"** |
| 72–100% | rests on: `thelastprompt.ai` · **an AI lab building science fiction** · vision line **PROMPTS → FEWER → PROMPTLESS** · a **Switchboard** card with an **Enter →** CTA |

## Hard constraints (keep these)
- **Single self-contained file, zero dependencies.** All animation is vanilla canvas 2D; no libs.
- Fonts: **IBM Plex Mono** via Google Fonts `<link>` only (already in the file).
- Palette: ground `#07080A`, ink `#EDEEEA`, one accent `#9FCB6E` (the Switchboard lime), dims `#8A8D94/#4A4D54`.
- **Reduced-motion**: falls back to the final resting state (handled in the file).
- Enter CTA links to `https://thelastprompt.ai/switchboard/`.

## Drop-in
The complete file is embedded at the bottom of this doc. 
- **Static site** → use it as the homepage directly.
- **Next/React/other framework** → port the markup into the home route and move the `<script>`
  into a `useEffect`/client component; keep the canvas logic and the CSS verbatim. The Google
  Fonts `<link>` goes in `<head>`.

## Tunables the founder may ask for
- Scroll length: `.scroll{height:600vh}` — lower = faster sequence.
- Burst shape: currently scatters horizontally (hands are side-by-side); bias `ex/ey` in `build()` for a rounder burst.
- Pacing of each beat: the `ramp()/pulse()` progress ranges in `render()`.

---

## Complete file (index.html)

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>thelastprompt.ai</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600&display=swap">
<style>
:root{--bg:#07080A;--ink:#EDEEEA;--dim:#8A8D94;--faint:#4A4D54;--pop:#9FCB6E;--line:#202226;--card:#0E0F12;}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--ink);
  font-family:"IBM Plex Mono",ui-monospace,"SF Mono",Menlo,monospace;-webkit-font-smoothing:antialiased}
.scroll{height:600vh;position:relative}
.sticky{position:sticky;top:0;height:100vh;overflow:hidden}
canvas{position:absolute;inset:0;display:block}
.layer{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;text-align:center;pointer-events:none;padding:24px;will-change:opacity,transform}
.big{font-size:clamp(27px,4.8vw,54px);font-weight:300;line-height:1.14;letter-spacing:-.015em;
  max-width:20ch;text-wrap:balance}
.big .g{color:var(--pop);font-weight:400}
.final{gap:20px}
.mark{font-size:12.5px;letter-spacing:.42em;color:var(--dim);text-transform:lowercase;padding-left:.42em}
.mark b{color:var(--ink);font-weight:500}
.tag{font-size:clamp(26px,4.4vw,46px);font-weight:300;letter-spacing:-.01em;line-height:1.12;max-width:16ch;text-wrap:balance}
.tag .g{color:var(--pop);font-weight:400}
.vision{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;display:flex;align-items:center;gap:12px}
.vision .now{color:var(--dim)} .vision .step{color:var(--faint)} .vision .end{color:var(--pop)} .vision .arr{color:var(--line)}
.card{pointer-events:auto;margin-top:8px;display:flex;align-items:center;gap:16px;text-align:left;
  background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;
  min-width:340px;max-width:min(92vw,440px);box-shadow:0 24px 60px rgba(0,0,0,.5)}
.ctile{width:42px;height:42px;border-radius:11px;flex:none;display:grid;place-items:center;
  background:rgba(159,203,110,.12);border:1px solid rgba(159,203,110,.28)}
.ctile i{width:15px;height:15px;border-radius:4px;background:var(--pop);display:block}
.cmeta{flex:1;min-width:0}
.ctitle{font-size:15px;font-weight:600;color:var(--ink);letter-spacing:-.01em}
.cdesc{font-size:11px;line-height:1.5;color:var(--dim);margin-top:3px}
.enter{flex:none;background:var(--pop);color:#07080A;font-family:inherit;font-weight:600;font-size:13px;
  letter-spacing:.02em;border:none;border-radius:999px;padding:11px 18px;cursor:pointer;text-decoration:none;
  white-space:nowrap;transition:transform .15s ease,filter .15s ease}
.enter:hover{filter:brightness(1.08);transform:translateY(-1px)}
.hint{position:fixed;left:0;right:0;bottom:26px;text-align:center;font-size:11px;letter-spacing:.22em;
  text-transform:uppercase;color:var(--faint);pointer-events:none}
.hint .a{display:block;margin-top:8px;animation:bob 1.8s ease-in-out infinite}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(5px)}}
@media (prefers-reduced-motion:reduce){.hint .a{animation:none}}
</style></head>
<body>
<div class="scroll">
  <div class="sticky">
    <canvas id="c"></canvas>
    <div class="layer" id="line1" style="opacity:0"><div class="big">you're one prompt away from <span class="g">superintelligence</span></div></div>
    <div class="layer" id="line2" style="opacity:0"><div class="big">the last prompt helps you <span class="g">close that gap</span></div></div>
    <div class="layer final" id="final" style="opacity:0">
      <div class="mark"><b>thelastprompt</b>.ai</div>
      <div class="tag">an AI lab building <span class="g">science fiction</span></div>
      <div class="vision"><span class="now">prompts</span><span class="arr">→</span><span class="step">fewer</span><span class="arr">→</span><span class="end">promptless</span></div>
      <div class="card">
        <div class="ctile"><i></i></div>
        <div class="cmeta"><div class="ctitle">Switchboard</div>
          <div class="cdesc">route your AI — subscription · context · models · users · agents</div></div>
        <a class="enter" href="https://thelastprompt.ai/switchboard/">Enter →</a>
      </div>
    </div>
    <div class="hint" id="hint">scroll<span class="a">↓</span></div>
  </div>
</div>
<script>
(function(){
  const c=document.getElementById('c'), ctx=c.getContext('2d');
  const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  const L1=document.getElementById('line1'),L2=document.getElementById('line2'),FIN=document.getElementById('final'),HINT=document.getElementById('hint');
  let W,H,cx,cy,DPR;
  function size(){DPR=Math.min(devicePixelRatio||1,2);W=innerWidth;H=innerHeight;cx=W/2;cy=H/2;
    c.width=W*DPR;c.height=H*DPR;c.style.width=W+'px';c.style.height=H+'px';ctx.setTransform(DPR,0,0,DPR,0,0);}
  size();
  const clamp=(v,a,b)=>v<a?a:v>b?b:v, ramp=(t,a,b)=>clamp((t-a)/(b-a),0,1),
        pulse=(t,ia,ib,oa,ob)=>ramp(t,ia,ib)*(1-ramp(t,oa,ob)), eo=x=>1-Math.pow(1-x,3);

  // ---- a recognisable hand (index finger extended right, forearm to the left) ----
  function handImg(S){
    const w=Math.round(370*S), h=Math.round(250*S);
    const o=document.createElement('canvas'); o.width=w; o.height=h; const g=o.getContext('2d');
    g.fillStyle='#fff'; g.strokeStyle='#fff'; g.lineCap='round'; g.lineJoin='round';
    const M=(a)=>a*S;
    // forearm
    g.lineWidth=M(58); g.beginPath(); g.moveTo(M(8),M(148)); g.lineTo(M(150),M(140)); g.stroke();
    // back of hand / palm
    g.beginPath(); g.moveTo(M(150),M(108));
    g.quadraticCurveTo(M(150),M(172),M(205),M(176));
    g.quadraticCurveTo(M(250),M(178),M(258),M(150));
    g.quadraticCurveTo(M(262),M(128),M(238),M(116));
    g.quadraticCurveTo(M(205),M(100),M(150),M(108)); g.closePath(); g.fill();
    // thumb (up)
    g.lineWidth=M(26); g.beginPath(); g.moveTo(M(196),M(120)); g.quadraticCurveTo(M(196),M(86),M(224),M(74)); g.stroke();
    g.beginPath(); g.arc(M(224),M(74),M(13),0,7); g.fill();
    // index finger extended right, slight droop, two segments
    g.lineWidth=M(27); g.beginPath(); g.moveTo(M(238),M(132)); g.quadraticCurveTo(M(300),M(126),M(348),M(140)); g.stroke();
    g.beginPath(); g.arc(M(348),M(140),M(14),0,7); g.fill();
    // curled fingers (middle/ring/pinky) folded below index
    g.lineWidth=M(21);
    for(let i=0;i<3;i++){ const bx=246+i*4, by=150+i*10;
      g.beginPath(); g.moveTo(M(230),M(by)); g.quadraticCurveTo(M(bx+26),M(by+2),M(bx+18),M(by+24)); g.stroke(); }
    const d=g.getImageData(0,0,w,h).data, pts=[], step=Math.max(3,Math.round(3.6*S));
    for(let y=0;y<h;y+=step) for(let x=0;x<w;x+=step){ if(d[(y*w+x)*4+3]>128) pts.push({x:x+(Math.random()-.5)*step,y:y+(Math.random()-.5)*step}); }
    return {pts,tipx:M(348),tipy:M(140)};
  }

  let P=[], hand, handScale;
  const OPEN=()=>Math.max(230,Math.min(W,H)*0.44), NEAR=()=>Math.max(48,Math.min(W,H)*0.08), REST=()=>Math.min(W,H)*0.012;
  function build(){
    handScale=Math.max(.7,Math.min(1.5,Math.min(W,H)/540)); hand=handImg(handScale); P=[];
    for(const side of [-1,1]) for(const p of hand.pts){
      let lx=p.x-hand.tipx, ly=p.y-hand.tipy; if(side>0) lx=-lx;
      const ang=Math.atan2(ly,(side<0?-1:1)*(lx))+(Math.random()-.5)*1.1, dist=(0.8+Math.random()*1.6);
      P.push({side,lx,ly, ex:Math.cos(ang)*dist*(side<0?-1:1)*0.7+(Math.random()-.5)*0.6, ey:Math.sin(ang)*dist+(Math.random()-.5)*0.6,
        exd:(80+Math.random()*Math.max(W,H)*0.5), size:1+Math.random()*1.3, seed:Math.random()*6.28});
    }
  }
  function tipHalf(p){ const o=OPEN()/2,n=NEAR()/2,r=REST()/2;
    if(p<0.20) return o+(n-o)*eo(ramp(p,0,0.20));
    if(p<0.26) return n+(r-n)*eo(ramp(p,0.20,0.26));
    return r; }

  let progress=0, forced=null;
  function render(now){
    const p=forced!=null?forced:progress;
    ctx.clearRect(0,0,W,H); ctx.globalCompositeOperation='lighter';
    const ex=eo(ramp(p,0.28,0.48)), touched=p>=0.26;
    // spark near contact
    if(p>0.16 && p<0.34){ const gg=Math.max(0,1-Math.abs(p-0.27)/0.09), r=14+gg*175;
      const gr=ctx.createRadialGradient(cx,cy,0,cx,cy,r);
      gr.addColorStop(0,'rgba(226,255,198,'+(0.95*gg)+')'); gr.addColorStop(.35,'rgba(159,203,110,'+(0.5*gg)+')'); gr.addColorStop(1,'rgba(159,203,110,0)');
      ctx.fillStyle=gr; ctx.beginPath(); ctx.arc(cx,cy,r,0,7); ctx.fill(); }
    // shockwave
    if(p>0.28 && p<0.5){ const rt=ramp(p,0.28,0.5), rr=rt*Math.max(W,H)*0.6;
      ctx.strokeStyle='rgba(159,203,110,'+(0.5*(1-rt))+')'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(cx,cy,rr,0,7); ctx.stroke(); }
    const half=tipHalf(p);
    for(const pt of P){
      const baseX=cx+(pt.side<0?-1:1)*half+pt.lx, baseY=cy+pt.ly;
      let x=baseX, y=baseY, a=1;
      if(ex>0){ x=baseX+pt.ex*pt.exd*ex; y=baseY+pt.ey*pt.exd*ex - ex*40*Math.random()*0; a=1-ramp(p,0.30,0.52)*0.86; }
      if(now&&p>0.5){ x+=Math.sin(now/1400+pt.seed)*0.5; y+=Math.cos(now/1600+pt.seed)*0.5; }
      let col; if(!touched){ col=(pt.lx>-40*handScale)?'rgba(196,236,150,'+(0.86)+')':'rgba(214,226,200,0.6)'; }
      else col='rgba(176,214,140,'+(0.72*a)+')';
      ctx.fillStyle=col; const s=pt.size; ctx.fillRect(x,y,s,s);
    }
    ctx.globalCompositeOperation='source-over';
    const o1=pulse(p,0.05,0.11,0.23,0.28), o2=pulse(p,0.42,0.49,0.60,0.66), of=ramp(p,0.72,0.83);
    L1.style.opacity=o1; L1.style.transform='translateY('+((1-o1)*8)+'px)';
    L2.style.opacity=o2; L2.style.transform='translateY('+((1-o2)*8)+'px)';
    FIN.style.opacity=of; FIN.style.transform='translateY('+((1-of)*10)+'px)'; FIN.style.pointerEvents=of>0.5?'auto':'none';
    HINT.style.opacity=1-ramp(p,0.0,0.05);
  }
  let raf; function loop(now){ render(now); raf=requestAnimationFrame(loop); }
  function onScroll(){ const max=document.documentElement.scrollHeight-innerHeight; progress=clamp((window.scrollY||window.pageYOffset)/max,0,1); }
  addEventListener('scroll',onScroll,{passive:true});
  addEventListener('resize',()=>{size();build();});
  build(); onScroll();
  if(reduce){ forced=1; render(0); }
  else { raf=requestAnimationFrame(loop); }
})();
</script>
</body></html>
```
