import type { ReactNode } from 'react';
import { Check, Compass, Sparkles, Rocket, Home, ArrowUpRight } from 'lucide-react';
import './harness-app.css';
import { journey } from './journey';

// Condensed from Brandbrain's BrandStudio + Sidebar and AdPulse's signal desk.
// The Verra content is an illustrated example, not a live diagnosis or generated brand.
export function HarnessApp({ app, beat, composer, provider }: { app: 'brand' | 'performance'; beat: number; composer: ReactNode; provider: ReactNode }) {
  const reveal = (at: number) => ({ 'data-ready': beat >= at, 'aria-hidden': beat < at });
  const tasks = journey[app].steps;
  return <div className={'harness-app harness-' + app}>
    {app === 'brand' && <aside className="brand-navigation" aria-label="Brandbrain example navigation">
      <span><Home size={13} />Home</span><small>VERRA / LAUNCHPAD</small>
      <strong><Compass size={14} />Foundation</strong><span><Sparkles size={14} />Build</span><span><Rocket size={14} />Launch</span>
      <footer>Ask brandbrain ↗<br />Discover brands</footer>
    </aside>}
    <div className="harness-canvas">
      <div className="harness-page-heading"><span>{app === 'brand' ? 'BRAND STUDIO / FOUNDATION' : 'SIGNAL DESK / META ADS DIAGNOSTICS'}</span><small>EXAMPLE</small></div>
      <h3>{app === 'brand' ? 'Your next brand starts here.' : <>Ad<span>Pulse</span></>}</h3>
      {app === 'performance' && <div className="ad-account"><span><b>01</b> FEED — YOUR ACCOUNT</span><div><strong>{beat >= 4 ? '✓ Verra · last 30 days' : '⚡ Pull from Ads Manager'}</strong><small>{beat >= 4 ? 'Campaign feed connected' : 'Your Meta connector'}</small></div></div>}
      <div className="harness-prompt-label">{app === 'brand' ? 'THE IDEA' : '03 STEER — WHAT SHOULD THE DIAGNOSIS CHASE?'}</div>
      {composer}
      <div className="harness-execution" data-running={beat > 0 && beat < 10}>
        <span className="execution-heading"><i />{beat === 0 ? 'Ready to run your harness' : beat === 10 ? 'Harness run complete' : <>{app === 'brand' ? 'Brandbrain' : 'AdPulse'} harness <span className="execution-provider">{provider}</span></>}</span>
        <div>{tasks.map((task, i) => <span key={task} data-step={beat >= i + 6 ? 'done' : beat >= i + 4 ? 'active' : 'waiting'}>{beat >= i + 6 ? <Check size={11} /> : <i />}{task}</span>)}</div>
      </div>
      <div className="harness-results">
        {app === 'brand' ? <>
          <div className="harness-result-heading"><span>THE MARKET</span><strong>{beat < 5 ? 'From your idea to a foundation.' : beat < 8 ? 'Reading your market…' : 'Your market, mapped.'}</strong></div>
          <div className="foundation-grid">
            <article {...reveal(5)}><small>01 / CATEGORY</small><strong>Everyday skincare</strong><p>Simple routines. Fewer products.</p></article>
            <article {...reveal(6)}><small>02 / COMPETITION</small><strong>Clinical ↔ lifestyle</strong><p>Ingredients on one side. Ritual on the other.</p></article>
            <article {...reveal(7)}><small>03 / YOUR OPENING</small><strong>Less, done well.</strong><p>A daily essential for routine minimalists.</p></article>
          </div>
          <div className="harness-next" {...reveal(8)}>Choose your opening <ArrowUpRight size={12} /><span>THEN BUILD → LAUNCH</span></div>
        </> : <>
          <div className="harness-result-heading"><span>04 / READOUT — THE POST-MORTEM</span><strong>{beat < 5 ? 'Your question. An actionable readout.' : 'Protect the winners. Cut the leaks.'}</strong></div>
          <div className="diagnosis-grid"><article {...reveal(5)}><small>↗ WINS — PROTECT THESE</small><strong>Retargeting converts.</strong><p>Keep the strongest creative running.</p></article><article {...reveal(6)}><small>↘ LEAKS — MONEY ON FIRE</small><strong>Founder video is tiring.</strong><p>Refresh the opening before adding spend.</p></article></div>
          <div className="harness-next" {...reveal(7)}><b>05 / ORDERS</b>Refresh creative → test → review spend</div>
        </>}
      </div>
    </div>
  </div>;
}
