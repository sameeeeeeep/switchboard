'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Check, Cpu, FileText, FolderOpen, KeyRound, LockKeyhole, Minus, ShieldCheck, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { AppPreview } from './app-preview';
import { WrappIcon } from './wrapp-icon';
import { scenarios } from './scenarios';

export function WhatChanges() {
  const rows = [
    ['Configure AI for each app', 'Reuse your connected AI'],
    ['Copy project files into each app', 'Give apps access to the same project'],
    ['Reconnect tools for each app', 'Use tools attached to your AI'],
  ];
  return <section className="difference-section shell" id="why-switchboard" aria-labelledby="difference-title">
    <div className="section-copy"><span className="section-eyebrow">THE DIFFERENCE</span><h2 id="difference-title">Stop setting up AI<br /><span>for every app.</span></h2><p>Connect your setup to Switchboard. Compatible apps can use it with your permission.</p></div>
    <div className="difference-table-wrap"><table className="difference-table"><caption className="sr-only">How opening another app changes with Switchboard</caption><thead><tr><th scope="col">SEPARATE APP SETUPS</th><th scope="col">ON SWITCHBOARD</th></tr></thead><tbody>{rows.map(([before, after]) => <tr key={before}><td><span><Minus size={14} />{before}</span></td><td><span><Check size={14} />{after}</span></td></tr>)}</tbody></table></div>
  </section>;
}

export function AppShelf() {
  return <section className="apps-section shell" id="apps" aria-labelledby="apps-title">
    <Carousel className="app-carousel" opts={{ align: 'start', containScroll: 'trimSnaps' }} aria-label="Explore Switchboard apps">
      <div className="apps-heading"><div className="apps-heading-copy"><span className="section-eyebrow">APPS YOU CAN USE</span><h2 id="apps-title">Build a brand.<br /><span>Make ads. Review results.</span></h2><p>Choose an app for the task. Run it with your own AI.</p></div><div className="shelf-navigation"><a className="inline-link" href="https://thelastprompt.ai/apps/">Browse all apps <ArrowUpRight size={15} /></a><div className="shelf-arrows"><CarouselPrevious className="shelf-arrow" aria-label="Previous apps" /><CarouselNext className="shelf-arrow" aria-label="More apps" /></div></div></div>
      <CarouselContent className="app-carousel-track">{scenarios.map(app => <CarouselItem className="app-carousel-item" key={app.id}>
        <a href={app.href} className="app-card" aria-label={'Open ' + app.app + ' — ' + app.job}>
          <div className="app-card-head"><WrappIcon name={app.appIcon} /><strong>{app.app}</strong><span>{app.surface === 'NATIVE APP' ? 'NATIVE' : 'WEB'}</span></div>
          <div className="app-card-preview" aria-hidden="true"><AppPreview storyId={app.id} /></div>
          <div className="app-card-caption"><span>{app.job}</span><ArrowUpRight size={16} /></div>
        </a>
      </CarouselItem>)}</CarouselContent>
    </Carousel>
  </section>;
}

export function NativeWrapps({ releases }: { releases: string }) {
  const apps = [
    { id: 'god', name: 'God', href: releases, description: 'Ask by voice and let AI act on your screen.' },
    { id: 'flow', name: 'Flow', href: releases, description: 'Dictate text into the app you’re using.' },
    { id: 'take', name: 'Take', href: 'https://take.thelastprompt.ai', description: 'Draft a script, then record your screen or camera.' },
  ];
  return <section className="native-section shell" aria-labelledby="native-title">
    <div className="native-heading"><span className="section-eyebrow">VOICE &amp; SCREEN TOOLS</span><h2 id="native-title">Dictate, act and record.</h2></div>
    <div className="native-apps">{apps.map(app => <a className="native-app" href={app.href} key={app.id}><WrappIcon name={app.id} /><div><strong>{app.name}</strong><span>{app.description}</span></div><ArrowUpRight size={15} /></a>)}</div>
  </section>;
}

export function SharedProject() {
  const apps = scenarios.filter(app => ['brand', 'ads', 'website'].includes(app.id));
  return <section className="shared-section shell" aria-labelledby="shared-title">
    <div className="section-copy shared-copy"><span className="section-eyebrow">SHARED PROJECT CONTEXT</span><h2 id="shared-title">Switch apps.<br /><span>Keep your project context.</span></h2><p>Let your brand builder, ad creator and website reviewer use the same brief and product notes.</p><div className="context-proof"><FileText size={15} /><span>Example: three apps, one Verra project.</span></div></div>
    <div className="shared-workspace">
      <div className="shared-project-header"><FolderOpen size={18} /><strong>Verra</strong><span><LockKeyhole size={11} />PRIVATE PROJECT</span></div>
      <div className="shared-files">{['Brand brief', 'Brand voice', 'Product notes'].map(file => <span key={file}><FileText size={12} />{file}</span>)}</div>
      <Tabs defaultValue="brand" className="context-apps">
        <TabsList className="context-app-list" aria-label="Switch apps using the same example project">{apps.map(app => <TabsTrigger className="context-app-tab" value={app.id} key={app.id}><WrappIcon name={app.appIcon} />{app.app}</TabsTrigger>)}</TabsList>
        {apps.map(app => <TabsContent className="context-app-content" value={app.id} key={app.id}><AppPreview storyId={app.id} /></TabsContent>)}
      </Tabs>
      <div className="shared-access"><Check size={13} /><span>Each app uses the project files you allow.</span></div>
    </div>
  </section>;
}

export function Privacy() {
  const [approved, setApproved] = useState(false);
  return <section className="privacy-section shell" id="privacy" aria-labelledby="privacy-title">
    <div className="section-copy"><span className="section-eyebrow">ACCESS & PRIVACY</span><h2 id="privacy-title">Choose what<br /><span>each app can access.</span></h2><p>Approve access to your AI, tools and projects. Revoke it when you choose.</p>
      <ul className="privacy-points"><li><ShieldCheck size={17} /><div><strong>Access is per app</strong><span>Connecting one app does not grant access to every app.</span></div></li><li><KeyRound size={17} /><div><strong>Apps don’t need your AI keys</strong><span>Switchboard sends requests through your connected AI.</span></div></li><li><Cpu size={17} /><div><strong>Choose local or cloud processing</strong><span>Local models process on your device. Cloud requests go to the provider you use.</span></div></li></ul>
    </div>
    <div className={'consent-preview ' + (approved ? 'consent-approved' : '')}>
      <div className="consent-caption"><span>EXAMPLE PERMISSION REQUEST</span><ShieldCheck size={15} /></div>
      <div className="consent-app"><WrappIcon name="brandbrain" /><div><strong>Brandbrain</strong><span>{approved ? 'Example access approved' : 'Requests access to'}</span></div></div>
      <div className="consent-scope"><div><Cpu size={16} /><span><small>YOUR AI</small><strong>Claude Code</strong></span><span className="scope-state">{approved ? <Check size={14} /> : 'ASKS'}</span></div><div><FolderOpen size={16} /><span><small>YOUR CONTEXT</small><strong>Verra brand project</strong></span><span className="scope-state">{approved ? <Check size={14} /> : 'ASKS'}</span></div><div><Wrench size={16} /><span><small>YOUR TOOLS</small><strong>Project files</strong></span><span className="scope-state">{approved ? <Check size={14} /> : 'ASKS'}</span></div></div>
      <div className="consent-action"><span role="status">{approved ? 'Demo only. No real access granted.' : 'Try the example. No real access changes.'}</span><Button onClick={() => setApproved(value => !value)} className="consent-button">{approved ? 'Revoke demo access' : 'Approve demo access'}<ArrowRight size={14} /></Button></div>
    </div>
  </section>;
}

const questions = [
  { question: 'What does a harness do?', answer: 'A harness gives AI the instructions, tools and sequence of steps for a task. A brand-building harness might read your brief, research competitors and produce a market summary. Switchboard connects that harness to your AI and permitted resources.' },
  { question: 'What is a wrapp?', answer: 'A wrapp is a lightweight app built to use Switchboard. It provides an interface for a task—such as creating ads—and runs with your AI and the tools and project files you allow.' },
  { question: 'Which AI can I use?', answer: 'Use Claude Code or Codex with your existing account. Apps that support local processing can use Ollama or local voice models. Available features depend on the app and model.' },
  { question: 'Do I need the browser extension?', answer: 'For web apps in Chrome, install the extension and pair it with Switchboard. Native Mac apps connect directly and do not need the extension.' },
  { question: 'Can it work offline?', answer: 'Apps using local models can work offline when the task needs no online services. Cloud AI, online tools and web research require internet access.' },
  { question: 'Where does my data go?', answer: 'Local models process on your device. When you choose cloud AI or online tools, requests and the relevant data go to those providers. Apps can access only what you grant through Switchboard.' },
  { question: 'What does it cost?', answer: 'Switchboard is free and open source. Your AI provider and connected services may charge for usage under your existing plans.' },
];

export function Questions() {
  return <section className="faq-section shell" id="faq" aria-labelledby="faq-title">
    <div className="section-copy"><span className="section-eyebrow">QUESTIONS</span><h2 id="faq-title">What you need<br /><span>to know.</span></h2></div>
    <Accordion className="faq-list">{questions.map(item => <AccordionItem className="faq-item" value={item.question} key={item.question}><AccordionTrigger className="faq-question">{item.question}</AccordionTrigger><AccordionContent className="faq-answer">{item.answer}</AccordionContent></AccordionItem>)}</Accordion>
  </section>;
}
