'use client';
/* oxlint-disable next/no-img-element -- Static Vite export serves these local image assets directly. */
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- Pause carousel rotation when pointer or focus enters its region. */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, LayoutGrid, ListTodo, Mic, MousePointer2, Pause, PenTool, Play, Search } from 'lucide-react';
import HarnessRun from './harness-run';
import ExampleScene from './example-scene';
import './example-showcase.css';

const releases = 'https://github.com/sameeeeeeep/switchboard/releases/latest/download/Switchboard.dmg';
const examples = [
  { id: 'flow', name: 'Flow', title: 'Say it. Put it into words.', detail: 'Speak into the app you’re using. Flow transcribes on your Mac and puts your words at the cursor.', icon: Mic, image: '/wrapps/flow.png' },
  { id: 'brandbrain', name: 'Brandbrain', title: 'Give your idea a brand.', detail: 'Start with a brief. Work through the market, audience and positioning in a workspace built for the job.', icon: LayoutGrid, image: '/wrapps/brandbrain.png', href: 'https://brandbrain.thelastprompt.ai/build' },
  { id: 'guru', name: 'Guided notch', title: 'Your next step, right there.', detail: 'Get a guided step, answer a question or approve an action at the notch. Keep the app you’re working in in view.', icon: LayoutGrid },
  { id: 'adforge', name: 'AdForge', title: 'Turn your brand into ads.', detail: 'Create campaign concepts from a website or a brand you share through Switchboard. Keep the voice and product context.', icon: LayoutGrid, image: '/wrapps/adforge.png', href: 'https://adforge.thelastprompt.ai' },
  { id: 'whiteboard', name: 'Whiteboard', title: 'Sketch it with your AI.', detail: 'Draw an idea, mark up a screenshot or work through an editable diagram with your AI.', icon: PenTool },
  { id: 'god', name: 'Screen help', title: 'Ask about what’s in front of you.', detail: 'Get an explanation or help with the next action in the app on your screen, using your connected AI.', icon: MousePointer2, image: '/wrapps/god.png' },
  { id: 'crest', name: 'Crest', title: 'Explore your brand’s logo.', detail: 'Brief the brand, explore directions and refine a logo with the AI and image tools connected to your setup.', icon: LayoutGrid, image: '/wrapps/crest.png' },
  { id: 'launcher', name: 'Launcher', title: 'Your work, a shortcut away.', detail: 'Find a project, jump into an app or find the right tool for a file from the launcher.', icon: Search },
  { id: 'workspace', name: 'Workspace', title: 'Keep the work together.', detail: 'Keep tasks, project notes and run history together. Follow work from your backlog through to done.', icon: ListTodo },
];

export default function ExampleShowcase() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const root = useRef<HTMLElement>(null);
  const example = examples[index];
  const Icon = example.icon;
  const isHarness = ['brandbrain', 'adforge', 'crest'].includes(example.id);

  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const respectMotion = () => { if (motion.matches) setPlaying(false); };
    respectMotion();
    motion.addEventListener('change', respectMotion);
    const visibility = () => setPageVisible(!document.hidden);
    visibility();
    document.addEventListener('visibilitychange', visibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.15 });
    if (root.current) observer.observe(root.current);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', respectMotion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    if (!playing || !inView || hovered || !pageVisible) return;
    const timer = window.setTimeout(() => setIndex(current => (current + 1) % examples.length), isHarness ? 24000 : 10000);
    return () => window.clearTimeout(timer);
  }, [index, playing, inView, hovered, pageVisible, isHarness]);

  const select = (next: number) => {
    setPlaying(false);
    setIndex((next + examples.length) % examples.length);
  };

  return (
    <section id="v2-apps" ref={root} className="v2-showcase example-showcase" aria-labelledby="showcase-title" aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={event => { if (!(event.target instanceof HTMLElement && event.target.closest('[data-rotation-control]'))) setPlaying(false); }}>
      <div className="v2-showcase-head">
        <div><span className="v2-kicker">FOR THE WORK YOU DO</span><h2 id="showcase-title" className="showcase-title">What you can run<br /><em>with Switchboard.</em></h2></div>
      </div>
      <p className="example-intro">Dictate a thought. Build a brand. Get guided through the next step.</p>
      <div className="example-controls">
        <span className="example-position" aria-live={playing ? 'off' : 'polite'}>{String(index + 1).padStart(2, '0')} <span>/ {String(examples.length).padStart(2, '0')}</span><strong>{example.name}</strong></span>
        <div className="example-transport">
          <button type="button" aria-label="Previous example" onClick={() => select(index - 1)}><ArrowLeft size={18} /></button>
          <button type="button" data-rotation-control aria-label={playing ? 'Pause example cycling' : 'Resume example cycling'} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
          <button type="button" aria-label="Next example" onClick={() => select(index + 1)}><ArrowRight size={18} /></button>
        </div>
      </div>
      <article id="example-current-slide" className="example-slide" aria-roledescription="slide" aria-label={`${index + 1} of ${examples.length}: ${example.name}`}>
        <div className="example-story">
          <span className="example-icon">{example.image ? <img src={example.image} alt="" /> : <Icon size={30} />}</span>
          <h3>{example.title}</h3>
          <p>{example.detail}</p>
          <a href={example.href ?? releases}>{example.href ? `Open ${example.name}` : 'Get Switchboard'}<ArrowUpRight size={16} /></a>
        </div>
        <figure className="example-figure">
          <div className="example-visual" key={example.id}>
            {isHarness ? <HarnessRun id={example.id} name={example.name} icon={example.image!} /> : <ExampleScene id={example.id} />}
          </div>
          <figcaption>{isHarness ? 'Illustrated app walkthrough · timing dramatised · sample Verra project' : `Illustrated ${example.name.toLowerCase()} example`}</figcaption>
        </figure>
      </article>
      <fieldset className="example-picker"><legend className="example-sr-only">Choose an example</legend>
        {examples.map((item, i) => <button type="button" key={item.id} aria-label={`Show ${item.name}`} aria-pressed={index === i} onClick={() => select(i)}><span aria-hidden="true" />{item.name}</button>)}
      </fieldset>
      <a className="v2-community-count" href="https://thelastprompt.ai/apps/"><span className="community-numbers"><span><strong>93</strong> OTHER HARNESSES</span><span><strong>12</strong> DEVELOPERS</span></span><span>Explore the directory <ArrowUpRight size={16} /></span></a>
    </section>
  );
}
