'use client';
/* oxlint-disable next/no-html-link-for-pages -- Static Vite export uses document navigation between published routes. */
import { ArrowUpRight } from 'lucide-react';
import HeroRouting from '../route-scene';
import {Questions,OpenSource} from './questions';
import {SharedBrand,TrustMarks,SetupReuse} from './product-scenes';
import SwitchboardBoard from './switchboard-board';
import ExampleShowcase from './example-showcase';
import './v2.css';
import './refinements.css';
import './product-proof.css';
const releases='https://github.com/sameeeeeeep/switchboard/releases/latest/download/Switchboard.dmg';

function Mark(){return <svg viewBox="0 0 32 32" aria-hidden="true">{Array.from({length:35},(_,i)=><circle key={i} cx={4+i%7*4} cy={8+Math.floor(i/7)*4} r="1.3" fill="currentColor" opacity={.3+(i%5)*.17}/>)}</svg>;}
export default function FreehandLanding(){
 return <div className="v2" id="v2-top">
  <a className="v2-skip" href="#v2-main">Skip to content</a>
  <header className="v2-header"><a href="#v2-top" className="v2-logo"><Mark/>SWITCHBOARD</a><nav><a href="#v2-apps">What you can run</a><a href="/workshops/">Workshops</a><a href="/switchboard/blog/">Blog</a><a href="/developers">Build a harness</a><a href={releases} className="v2-nav-download">Get Switchboard <ArrowUpRight size={14}/></a></nav></header>
  <main id="v2-main">
   <section className="v2-hero">
    <div className="v2-intro"><span className="v2-kicker"><i/> HELLO OPERATOR. YOUR AI, CONNECTED.</span><h1>Give your AI<br/><em>a job.</em></h1><p className="v2-harness-promise">Bring your own compute.<br/>Build your own harness.</p></div><section className="v2-download-card" aria-label="Download Switchboard for Mac"><div className="v2-download-copy"><span className="v2-kicker">SWITCHBOARD POWERS THE HARNESS.</span><p>Combine AI, tools, context and your decisions around a job. Open a focused app called a Wrapp, or build your own harness with Switchboard.</p><div className="v2-entry-links"><a href="#v2-apps">Find a Wrapp <ArrowUpRight size={14}/></a><a href="/developers">Build your own <ArrowUpRight size={14}/></a></div></div><div className="v2-download-action"><a href={releases} className="v2-primary"><svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor" aria-hidden="true"><path d="M17.05 12.54c.03 3.11 2.73 4.15 2.76 4.16-.02.07-.43 1.48-1.43 2.94-.87 1.26-1.77 2.52-3.19 2.55-1.39.03-1.84-.83-3.43-.83-1.59 0-2.09.8-3.41.86-1.37.05-2.42-1.37-3.29-2.63-1.79-2.58-3.15-7.3-1.31-10.48.91-1.58 2.55-2.58 4.33-2.6 1.35-.03 2.63.91 3.46.91.83 0 2.39-1.13 4.03-.97.68.03 2.58.27 3.8 2.05-.1.06-2.27 1.32-2.25 4.04ZM14.43 4.72c.73-.88 1.22-2.1 1.09-3.32-1.05.04-2.32.7-3.07 1.58-.67.77-1.25 2-1.09 3.18 1.17.09 2.35-.59 3.07-1.44Z"/></svg>Download Switchboard<ArrowUpRight size={16}/></a><small>Free · Open source · macOS 13+ · Apple Silicon</small></div></section>
    <div className="v2-original-diagram"><HeroRouting releases={releases} diagramOnly /></div>
   </section>
   <ExampleShowcase/>
   <section className="v2-board" id="v2-board"><div className="v2-board-head"><div><span className="v2-kicker"><i/> COMBINE THE CAPABILITIES</span><h2>The job sets the shape.<br/><em>You choose the parts.</em></h2></div><p>A harness brings together instructions, tools, context and the moments you decide. Switchboard connects it to the AI and capabilities you allow: from research and files to voice and guidance at the notch.</p></div><SwitchboardBoard/><p className="v2-board-disclosure">Illustrated capability combinations. Available tools depend on the Wrapp and your connected setup.</p></section>
   <section className="v2-thesis"><div><span className="v2-kicker">BRING YOUR OWN COMPUTE</span><h2>Your AI connection.<br/><em>Many ways to work.</em></h2><p>Connect Claude Code, Codex or supported local models. Compatible Wrapps use that setup, with access you control. Your provider’s pricing and usage limits still apply.</p></div><SetupReuse/></section>
   <section id="brand-assets" className="v2-context brand-continuity"><div><span className="v2-kicker">BUILD ON THE WORK YOU’VE DONE</span><h2>Your colours.<br/>Your assets.<br/><em>Ready to reuse.</em></h2><p>Context is one of the capabilities your harness can use. Give a compatible app access to your brand kit, so the next task can start with your logo, colours and product images.</p></div><SharedBrand/></section>
   <section id="v2-build" className="v2-builder"><span className="v2-kicker">BUILD YOUR OWN HARNESS</span><h2>Your way of working.<br/><em>Made into software.</em></h2><div><p>Start with one job. Use the SDK to combine supported AI, tools and context with your interface, checks and decisions. Build a Wrapp for yourself, your team or the people you serve.</p><a href="/developers" className="v2-primary">Build your first Wrapp <ArrowUpRight size={16}/></a></div></section>
   <TrustMarks/>

   <Questions/><OpenSource/>
   <section className="v2-get"><Mark/><h2>What will you give<br/><em>your AI to do?</em></h2><p>Install Switchboard, connect your AI and start with a Wrapp.<br/>Build your own when you have a job in mind.</p><a href={releases} className="v2-primary">Download Switchboard <ArrowUpRight size={18}/></a><small>Free · Open source · macOS 13+ · Apple Silicon</small><a className="v2-extension" href="https://chromewebstore.google.com/detail/injmjolmnekmahlnackakiamjepegagb">Add the Chrome extension for web apps <ArrowUpRight size={12}/></a></section>
  </main>
  <footer className="v2-footer"><a className="v2-logo" href="#v2-top"><Mark/>SWITCHBOARD</a><nav aria-label="Footer"><a href="#v2-faq">FAQ</a><a href="/workshops/">Workshops</a><a href="/switchboard/blog/">Blog</a><a href="/developers">Developers</a><a href="https://github.com/sameeeeeeep/switchboard/releases/latest">Releases</a></nav><a href="https://github.com/sameeeeeeep/switchboard">GitHub <ArrowUpRight size={12}/></a></footer>
 </div>;
}
