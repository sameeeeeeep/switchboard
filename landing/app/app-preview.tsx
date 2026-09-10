import { ArrowUpRight, Check, CornerDownLeft, Mic } from 'lucide-react';
import './app-previews.css';

export function AppPreview({ storyId, stage = 4 }: { storyId: string; stage?: number }) {
  const part = (step: number, className = '') => ({ className: 'preview-part ' + className, 'data-visible': stage >= step, 'aria-hidden': stage < step });

  if (storyId === 'brand') return <div className="wrapp-output work-brand">
    <div {...part(1, 'output-topline')}><span>VERRA / IDENTITY</span><span>01</span></div>
    <div className="brand-sheet">
      <div {...part(2, 'brand-signature')}><strong>verra.</strong><span>A little less. A little better.</span></div>
      <div {...part(3, 'brand-direction')}><span>MADE FOR</span><strong>Routine minimalists.</strong><span>VOICE</span><strong>Calm. Clear. Human.</strong></div>
    </div>
    <div {...part(4, 'brand-palette')} aria-label="Brand palette: chalk, mist, olive, and forest"><span>CHALK</span><span>MIST</span><span>OLIVE</span><span>FOREST</span></div>
  </div>;

  if (storyId === 'ads') return <div className="wrapp-output work-ads">
    <div {...part(1, 'output-topline')}><span>VERRA / NEXT CAMPAIGN</span><span>3 CONCEPTS</span></div>
    <div className="ad-directions">
      <div {...part(2, 'ad-concept ad-paper')}><span>01 / ROUTINE</span><strong>A little less<br />guesswork.</strong><small>Daily essentials</small><b>verra.</b></div>
      <div {...part(3, 'ad-concept ad-olive')}><span>02 / PRODUCT</span><strong>Your daily<br />vitamin C.</strong><small>Product spotlight</small><b>verra.</b></div>
      <div {...part(4, 'ad-concept ad-ink')}><span>03 / STORY</span><strong>Why we<br />made Verra.</strong><small>Founder story</small><b>verra.</b></div>
    </div>
  </div>;

  if (storyId === 'performance') return <div className="wrapp-output work-performance">
    <div {...part(1, 'output-topline')}><span>CAMPAIGN PERFORMANCE</span><span>SAMPLE / ROAS</span></div>
    <div className="campaign-table">
      <div {...part(2, 'campaign-row')}><span><strong>Retargeting</strong><small className="campaign-scale">SCALE</small></span><div className="campaign-bar"><i style={{ width: '94%' }} /></div><strong>8.46×</strong></div>
      <div {...part(3, 'campaign-row')}><span><strong>Serum UGC</strong><small>KEEP TESTING</small></span><div className="campaign-bar"><i style={{ width: '49%' }} /></div><strong>4.41×</strong></div>
      <div {...part(4, 'campaign-row campaign-low')}><span><strong>Founder video</strong><small>REWORK</small></span><div className="campaign-bar"><i style={{ width: '12.4%' }} /></div><strong>1.12×</strong></div>
    </div>
    <div {...part(4, 'analysis-foot')}><ArrowUpRight size={14} />Move budget to retargeting.</div>
  </div>;

  if (storyId === 'listing') return <div className="wrapp-output work-listing">
    <div {...part(1, 'output-topline')}><span>VERRA / A+ CONTENT</span><span>DRAFT</span></div>
    <div {...part(2, 'listing-banner')}><span>VITAMIN C SERUM</span><strong>Your daily dose<br />of less is more.</strong><span className="listing-brand">verra.</span></div>
    <div className="listing-modules"><span {...part(2)}><Check size={12} />Story</span><span {...part(3)}><Check size={12} />Benefits</span><span {...part(4)}><Check size={12} />Compare</span></div>
  </div>;

  if (storyId === 'website') return <div className="wrapp-output work-review">
    <div {...part(1, 'output-topline')}><span>VERRA / HOMEPAGE</span><span>1 SUGGESTION</span></div>
    <div className="review-page"><span {...part(1, 'review-brand')}>verra.</span><del {...part(2)}>Skincare for every day.</del><strong {...part(3)}>Build your vitamin C routine.</strong><span {...part(3, 'review-pin')}>01</span></div>
    <div {...part(4, 'review-comment')}><span className="review-comment-dot" /><div><strong>Lead with the product.</strong><span>Keep the voice. Make the promise clearer.</span></div></div>
  </div>;

  return <div className="wrapp-output work-voice">
    <div {...part(1, 'output-topline')}><span><Mic size={13} />LOCAL DICTATION</span><span>ON-DEVICE</span></div>
    <div className="dictation-document"><span {...part(2)}>The Verra launch moves to Friday.</span><span {...part(3)}>The product photos are ready.</span><i {...part(3, 'dictation-cursor')} /></div>
    <div {...part(4, 'dictation-footer')}><span><Check size={13} />Names kept. Filler removed.</span><span>Ready to paste <CornerDownLeft size={13} /></span></div>
  </div>;
}
