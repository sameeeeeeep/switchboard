import { ArrowUpRight } from 'lucide-react';
import HeroRouting, { SwitchMark } from './route-scene';
import { AppShelf, NativeWrapps, Privacy, Questions, SharedProject, WhatChanges } from './site-sections';

const repository = 'https://github.com/sameeeeeeep/switchboard';
const releases = repository + '/releases/latest';
const extension = 'https://chromewebstore.google.com/detail/injmjolmnekmahlnackakiamjepegagb';

export default function Home() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header shell">
      <a className="logo" href="#" aria-label="Switchboard home"><SwitchMark />switchboard</a>
      <nav aria-label="Main navigation"><a className="nav-text" href="#why-switchboard">Why Switchboard</a><a className="nav-text" href="#apps">Apps</a><a className="nav-text" href="#builders">Build</a><a className="nav-button" href={releases}>Get Switchboard <ArrowUpRight size={15} /></a></nav>
    </header>
    <main id="main">
      <HeroRouting releases={releases} />
      <WhatChanges />
      <AppShelf />
      <NativeWrapps releases={releases} />
      <SharedProject />
      <Privacy />
      <section className="setup-section shell" id="setup" aria-labelledby="setup-title">
        <div className="setup-heading"><div><span className="section-eyebrow">GET CONNECTED</span><h2 id="setup-title">Connect your AI.<br /><span>Choose an app.</span></h2></div><span className="setup-availability">FREE &amp; OPEN SOURCE<br />MACOS · APPLE SILICON</span></div>
        <div className="setup-row"><ol className="setup-steps"><li><span>01</span><div><strong>Install Switchboard</strong><small>Runs in your Mac’s menu bar.</small></div></li><li><span>02</span><div><strong>Connect your AI</strong><small>Claude Code, Codex or a local model.</small></div></li><li><span>03</span><div><strong>Open an app</strong><small>Choose its AI, tools and project access.</small></div></li></ol><a className="primary-button" href={releases}>Get Switchboard <ArrowUpRight size={16} /></a></div>
        <p><span>Use your existing AI account. Switchboard needs no separate login.</span><a href={extension}>Add the extension for web apps <ArrowUpRight size={13} /></a></p>
      </section>
      <section className="builder-section shell" id="builders" aria-labelledby="builder-title">
        <div className="section-copy"><span className="section-eyebrow">FOR BUILDERS</span><h2 id="builder-title">Build apps that run<br /><span>on your users’ AI.</span></h2><p>Build the interface and the steps for a task. Switchboard connects your app to each user’s AI, tools and permitted project files.</p><div className="builder-formats"><span>WEB APPS</span><span>NATIVE APPS</span><span>HARNESSES</span></div></div>
        <div className="builder-actions"><a className="builder-link" href={repository + '/blob/main/docs/BUILDING-A-WRAPP.md'}><span>Connect your app<small>Read the integration guide</small></span><ArrowUpRight size={20} /></a><a className="builder-link" href={repository + '/tree/main/examples/apps/wrapps'}><span>Explore example apps<small>See how they connect to Switchboard</small></span><ArrowUpRight size={20} /></a></div>
      </section>
      <Questions />
    </main>
    <footer className="site-footer shell"><div className="footer-main"><a className="logo" href="#"><SwitchMark />switchboard</a><div className="footer-links"><a href="#privacy">Privacy</a><a href="#faq">FAQ</a><a href={repository}>GitHub <ArrowUpRight size={13} /></a></div></div><p>Apple Silicon · macOS 13+ · Claude Code, Codex &amp; local models.</p></footer>
  </>;
}
