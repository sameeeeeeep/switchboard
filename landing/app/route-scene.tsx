'use client';

import { useEffect, useReducer, useState } from 'react';
import { ArrowRight, ArrowUp, ArrowUpRight, Check, Cpu, FileText, FolderOpen, Mic, Pause, Play, Plus, SkipForward, Globe, Laptop } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { OperatorField } from './operator-field';
import { journey, journeyOrder } from './journey';
import { JourneyResources } from './journey-resources';
import { CompactHarness } from './compact-harness';
import { WrappIcon } from './wrapp-icon';
import { scenarios } from './scenarios';
import { advance, beatDurations, finalBeat } from './scene-timeline';
import './hero-routing.css';
import './operator-stage.css';
import './diagram-fit.css';
import './wrapp-internals.css';

export function SwitchMark({ className = '' }: { className?: string }) {
  return <svg className={'matrix-mark ' + className} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">{Array.from({ length: 35 }, (_, i) => <circle key={i} cx={4 + (i % 7) * 4} cy={8 + Math.floor(i / 7) * 4} r="1.25" opacity={0.24 + ((i % 7 + Math.floor(i / 7) * 2) % 5) * 0.18} />)}</svg>;
}

function NotchMatrix() {
  return <svg className="notch-matrix" viewBox="0 0 92 56" fill="currentColor" aria-hidden="true">{Array.from({ length: 135 }, (_, i) => <circle className="matrix-lamp" key={i} cx={4 + (i % 15) * 6} cy={4 + Math.floor(i / 15) * 6} r="1.5" style={{ animationDelay: -(i % 15 + Math.floor(i / 15)) * 0.18 + 's' }} />)}</svg>;
}

const providers = [
  { name: 'Claude Code', icon: '/brands/claude-code.png', wordmark: '/brands/claude-code-wordmark.svg', id: 'claude' },
  { name: 'Codex', icon: '/brands/codex.png', wordmark: '/brands/codex-wordmark.svg', id: 'codex' },
];

function ProviderIdentity({ index, compact = false, local = false }: { index: number; compact?: boolean; local?: boolean }) {
  if (local) return <span className={'provider-identity identity-local ' + (compact ? 'identity-compact' : '')}><Cpu aria-hidden="true" /><span>{compact ? 'Ollama' : 'LOCAL MODELS'}</span></span>;
  return <span className={'provider-identity ' + (compact ? 'identity-compact' : '')} role="img" aria-label={providers[index].name}>
    {providers.map((provider, i) => <span className={['identity-frame', 'identity-' + provider.id, i === index ? 'identity-visible' : ''].join(' ')} aria-hidden="true" key={provider.id}>
      <img className="identity-icon" src={provider.icon} width="56" height="56" alt="" />
      <img className="identity-wordmark" src={provider.wordmark} alt="" />
    </span>)}
  </span>;
}

function useTypedText(text: string, paused: boolean, complete: boolean, headline = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (complete) { setCount(text.length); return; }
    if (paused) return;
    const timer = window.setInterval(() => setCount(value => Math.min(text.length, value + (headline ? 1 : Math.ceil(text.length / 60)))), headline ? 48 : 32);
    return () => window.clearInterval(timer);
  }, [text, paused, complete, headline]);
  return complete ? text : text.slice(0, count);
}

function TypedPurpose({ text, paused, complete }: { text: string; paused: boolean; complete: boolean }) {
  const typed = useTypedText(text, paused, complete, true);
  return <span className="purpose-line" aria-hidden="true"><span className="purpose-measure">{text}</span><span className={'purpose-typed ' + (typed.length < text.length ? 'purpose-typing' : '')}>{typed}<i className="type-cursor" /></span></span>;
}

function Prompt({ text, paused, complete }: { text: string; paused: boolean; complete: boolean }) {
  const typed = useTypedText(text, paused, complete);
  return <Textarea className="demo-prompt" value={typed} readOnly tabIndex={-1} aria-label="Illustrated example prompt" placeholder="Describe what you want to make…" />;
}

export default function HeroRouting({ releases, diagramOnly = false }: { releases: string; diagramOnly?: boolean }) {
  const [state, dispatch] = useReducer(advance, { story: 0, provider: 0, beat: 0, run: 0 });
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const story = scenarios[state.story];
  const active = playing && !reduced && visible;
  const dictation = story.input === 'voice';
  const done = state.beat === finalBeat;
  const chapter = journeyOrder.indexOf(state.story);
  const narrative = journey[story.id];


  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncMotion = () => { setReduced(media.matches); if (media.matches) { setPlaying(false); dispatch('still'); } };
    const syncVisibility = () => setVisible(document.visibilityState === 'visible');
    syncMotion(); syncVisibility();
    media.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncVisibility);
    return () => { media.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncVisibility); };
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => dispatch('tick'), beatDurations[state.beat]);
    return () => window.clearTimeout(timer);
  }, [active, state.beat, state.run]);

  const replay = () => { dispatch('replay'); if (reduced) dispatch('still'); else setPlaying(true); };

  const composer = (<div className="mini-composer">
          {dictation && state.beat < 2 ? <div className="voice-input"><Mic size={18} /><span className="voice-wave" aria-hidden="true">{[8,16,26,13,33,20,11,28,17,34,14,24,9,19,30,12].map((height, i) => <i key={i} style={{ height, animationDelay: i * -.13 + 's' }} />)}</span><span>Listening…</span></div> : <Prompt key={state.run} text={story.prompt} paused={!active} complete={state.beat > (dictation ? 2 : 0) || reduced} />}
          <div className="composer-tools"><span>{state.beat === 0 ? (dictation ? <Mic size={14} /> : <Plus size={14} />) : <Check size={13} />}{state.beat === 0 ? (dictation ? 'Your voice. On your device.' : 'Verra project') : dictation ? (state.beat > 2 ? 'Transcribed locally' : 'Voice captured') : 'Prompt sent'}</span><Button className={'prompt-send ' + (state.beat === 1 ? 'send-active' : '')} size="icon" onClick={replay} aria-label={'Replay the ' + story.app + ' example'}><ArrowUp size={17} /></Button></div>
        </div>);

  return <section className={'scene-hero shell ' + (active ? 'scene-playing' : 'scene-paused')} aria-labelledby={diagramOnly ? undefined : "hero-title"} data-beat={state.beat}>
    {!diagramOnly && <div className="scene-intro">
      <h1 id="hero-title">“Hello operator, <br className="operator-break" />connect me to <span>Superintelligence”</span></h1>
      <p>Run apps with your own AI, connected tools and project files. <span>Without repeating the setup.</span></p>
    </div>}

    <div className="scene-headline">
      <h2 className="purpose-group" aria-label={story.format + ' ' + story.purpose}>
        <span className="format-line" aria-hidden="true">{story.format}</span>
        <TypedPurpose key={state.run} text={story.purpose} paused={!active} complete={state.beat > 0 || reduced} />
      </h2>
      <div className="runtime-line"><span>Running on your</span> <ProviderIdentity index={state.provider} local={story.local} /></div>
    </div>

    <div className="prompt-scene operator-stage" data-phase={state.beat === 0 ? 'prompt' : state.beat < 4 ? 'connect' : state.beat < 8 ? 'work' : 'deliver'} id="how-it-works" aria-label="Illustration: a native or web app uses cloud AI, provider tools, project context and local voice through Switchboard">

      <Button variant="ghost" size="icon" className="diagram-pause" disabled={reduced} onClick={() => setPlaying(value => !value)} aria-label={active ? 'Pause animation' : 'Play animation'}>{active ? <Pause size={12}/> : <Play size={12}/>}</Button>
      <div className="mini-app" data-app={story.id} key={state.run} onFocusCapture={() => setPlaying(false)}>
        <div className="mini-app-chrome"><WrappIcon name={story.appIcon} eager /><strong>{story.app}</strong><span className="mini-project">{story.local?<Laptop size={12}/>:<Globe size={12}/>} {story.surface}</span><a href={story.href} aria-label={'Open ' + story.app}><ArrowUpRight size={15} /></a></div>
        <div className="wrapp-input">{composer}</div>
      </div>

      <CompactHarness id={story.id} beat={state.beat} appIcon={story.appIcon} />
      <div className="routing-plane">
        <OperatorField beat={state.beat} active={active} local={story.local} resource={story.resource} output={narrative.output} />
        <div className={'scene-gateway ' + (state.beat > 0 && !done ? 'gateway-active' : '')}><div className="gateway-surface"><span className="gateway-edge" /><NotchMatrix /><span className="gateway-port port-left" /><span className="gateway-port port-right" /></div><strong>switchboard</strong><span className="gateway-state">{state.beat === 0 ? 'OPERATOR READY' : done ? 'CALL COMPLETE' : state.beat >= 8 ? 'DELIVERING' : 'CONNECTED'}</span></div>
        <JourneyResources id={story.id} beat={state.beat} chapter={chapter} provider={<ProviderIdentity index={state.provider} local={story.local} compact />} local={story.local} />
      </div>
    </div>

    {!diagramOnly && <div className="scene-footer"><div className="scene-cta"><a className="primary-button" href={releases}>Get Switchboard <ArrowUpRight size={16} /></a><a className="quiet-button" href="#apps">Explore the apps <ArrowRight size={15} /></a></div></div>}

  </section>;
}
