'use client';
/* oxlint-disable next/no-html-link-for-pages -- Static Vite export uses document navigation between published routes. */
import { ArrowUpRight } from 'lucide-react';
import HeroRouting from '../route-scene';
import {Questions,OpenSource} from './questions';
import {SharedBrand,TrustMarks,SetupReuse} from './product-scenes';
import SwitchboardBoard from './switchboard-board';
import ExampleShowcase from './example-showcase';
import {CyclingWord,useWordCycle} from './cycling-word';
import './v2.css';
import './refinements.css';
import './product-proof.css';
const releases='https://github.com/sameeeeeeep/switchboard/releases/latest/download/Switchboard.dmg';

function Mark(){return <svg viewBox="0 0 32 32" aria-hidden="true">{Array.from({length:35},(_,i)=><circle key={i} cx={4+i%7*4} cy={8+Math.floor(i/7)*4} r="1.3" fill="currentColor" opacity={.3+(i%5)*.17}/>)}</svg>;}
export default function FreehandLanding(){
 const wordCycle=useWordCycle();
 return <div className="v2" id="v2-top">
  <a className="v2-skip" href="#v2-main">Skip to content</a>
  <header className="v2-header"><a href="#v2-top" className="v2-logo"><Mark/>SWITCHBOARD</a><nav><a href="#v2-apps">The harnesses</a><a href="/workshops/">Workshops</a><a href="/switchboard/blog/">Blog</a><a href="/developers">For developers</a><a href={releases} className="v2-nav-download">Get Switchboard <ArrowUpRight size={14}/></a></nav></header>
  <main id="v2-main">
   <section className="v2-hero">
    <div className="v2-intro"><h1>“Hello operator,<br/>connect me to<br/><em>superintelligence.”</em></h1></div><section className="v2-download-card" aria-label="Download Switchboard for Mac"><div className="v2-download-copy"><span className="v2-kicker">BRING YOUR AI. PICK YOUR HARNESS.</span><p>Switchboard makes your AI compute, connectors and context routable so you can run lightweight harnesses without any additional subscription or context load.</p></div><div className="v2-download-action"><a href={releases} className="v2-primary"><svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M17.05 12.54c.03 3.11 2.73 4.15 2.76 4.16-.02.07-.43 1.48-1.43 2.94-.87 1.26-1.77 2.52-3.19 2.55-1.39.03-1.84-.83-3.43-.83-1.59 0-2.09.8-3.41.86-1.37.05-2.42-1.37-3.29-2.63-1.79-2.58-3.15-7.3-1.31-10.48.91-1.58 2.55-2.58 4.33-2.6 1.35-.03 2.63.91 3.46.91.83 0 2.39-1.13 4.03-.97.68.03 2.58.27 3.8 2.05-.1.06-2.27 1.32-2.25 4.04ZM14.43 4.72c.73-.88 1.22-2.1 1.09-3.32-1.05.04-2.32.7-3.07 1.58-.67.77-1.25 2-1.09 3.18 1.17.09 2.35-.59 3.07-1.44Z"/></svg>Download Switchboard<ArrowUpRight size={16}/></a><small>Free · Open source · macOS 13+ · Apple Silicon</small></div></section>
    <div className="v2-original-diagram"><HeroRouting releases={releases} diagramOnly /></div>
   </section>
   <section className="v2-board" id="v2-board"><div className="v2-board-head"><div><span className="v2-kicker"><i/> THE BOARD</span><h2>Your AI. Your tools. Your context.<br/><em>Available to the <span className="v2-board-allow"><CyclingWord cycle={wordCycle}/> you allow.</span></em></h2></div><p>Switchboard is the connection between them. Every app calls in on the top rail, waits at the consent gate, and is patched through to the setup you already have. Illustrated routing, not a live run.</p></div><SwitchboardBoard/></section>
   <section className="v2-thesis"><div><span className="v2-kicker">THE CONNECTION IS THE DIFFERENCE</span><h2>Set up once.<br/><em>Use it across<br/><CyclingWord cycle={wordCycle} punctuation="."/></em></h2><div className="v2-setup-friction"><p><strong>Open source can mean setting up all over again.</strong> Another install. More API keys, dependencies and connectors to configure. Doing that for every tool adds up.</p><p><strong>Paid apps often mean paying all over again.</strong> A new account. A new subscription. The same context to upload and explain, again.</p></div><p>With Switchboard, connect your AI, tools and context once. Give each compatible harness access to what it needs, and get straight to the work.</p></div><SetupReuse/></section>
   <ExampleShowcase/>
   <section id="v2-build" className="v2-builder"><span className="v2-kicker">FOR THE PEOPLE BUILDING</span><h2>Build the harness.<br/><em>Don’t worry about inference.</em></h2><div><p>Bring your own compute and combine the tools, context and capabilities your work needs. Register your interest in building with Switchboard.</p><a href="mailto:sameep@stayoften.com?subject=Switchboard%20builder%20registration" className="v2-primary">sameep@stayoften.com <ArrowUpRight size={16}/></a></div></section>
   <section id="brand-assets" className="v2-context brand-continuity"><div><span className="v2-kicker">YOUR BRAND KIT GOES WITH YOU.</span><h2>Your colours.<br/>Your assets.<br/><em>In every app.</em></h2><p>Give the next app access to your brand kit. Your logo, colours and product images are ready to use.</p></div><SharedBrand/></section><TrustMarks/>

   <Questions/><OpenSource/>
   <section className="v2-get"><Mark/><h2>Let’s connect.</h2><p>Install Switchboard on your Mac, connect your AI and open a harness.</p><a href={releases} className="v2-primary">Download Switchboard <ArrowUpRight size={18}/></a><small>Free · Open source · macOS 13+ · Apple Silicon</small><a className="v2-extension" href="https://chromewebstore.google.com/detail/injmjolmnekmahlnackakiamjepegagb">Add the Chrome extension for web apps <ArrowUpRight size={12}/></a></section>
  </main>
  <footer className="v2-footer"><a className="v2-logo" href="#v2-top"><Mark/>SWITCHBOARD</a><nav aria-label="Footer"><a href="#v2-faq">FAQ</a><a href="/workshops/">Workshops</a><a href="/switchboard/blog/">Blog</a><a href="/developers">Developers</a><a href="https://github.com/sameeeeeeep/switchboard/releases/latest">Releases</a></nav><a href="https://github.com/sameeeeeeep/switchboard">GitHub <ArrowUpRight size={12}/></a></footer>
 </div>;
}
