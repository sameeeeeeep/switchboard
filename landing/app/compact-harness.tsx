import { Check, FileText, ChartNoAxesCombined, Sparkles, Globe, Mic, Repeat2, FolderOpen, Wrench } from 'lucide-react';
import { type JourneyId } from './journey';
import { WrappIcon } from './wrapp-icon';
const results = {
  brand: [ ['Market summary', 'Everyday skincare', 'A simpler routine with fewer products.'], ['Competition', 'Clinical ↔ lifestyle', 'Compare ingredient-led brands with daily rituals.'], ['Market opening', 'A daily essential', 'A direction for routine minimalists.'] ],
  performance: [ ['Wins', 'Retargeting converts', 'Protect the strongest creative.'], ['Leaks', 'Founder video is tiring', 'Refresh the opening before adding spend.'], ['Next actions', 'Refresh → test → review', 'Prioritise creative before increasing budget.'] ],
  ads: [ ['Concept 01', 'A little less guesswork.', 'Routine · daily essentials'], ['Concept 02', 'Your daily vitamin C.', 'Product · serum spotlight'], ['Concept 03', 'Why we made Verra.', 'Story · founder campaign'] ],
  listing: [ ['Product story', 'Your daily vitamin C.', 'Verra · Amazon A+ content'], ['Benefits', 'A simpler daily routine.', 'Product details, in your brand’s voice.'], ['Listing ready', 'Story · benefits · compare', 'A+ modules ready to review.'] ],
  website: [ ['Reviewing copy', 'Skincare for every day.', 'Compared with the Verra brand brief.'], ['Suggested headline', 'Build your vitamin C routine.', 'Lead with the product. Keep the voice.'], ['Review ready', 'Clearer promise. Same brand.', 'Review the suggested edits in Redline.'] ],
  voice: [ ['Transcribed', 'The Verra launch moves to Friday.', 'Local voice → text'], ['Cleaned up', 'The product photos are ready.', 'Names kept. Filler removed.'], ['Ready to paste', 'Your launch update is ready.', 'Use it in the app you’re working in.'] ],
} as const;
const agents = {
 brand: ['Research agent', 'Market research', 'Search competitors', 'Market sources received', 'Compare positioning'],
 performance: ['Ads analyst', 'Campaign diagnosis', 'Read Meta Ads', 'Campaign metrics received', 'Compare creative performance'],
 ads: ['Creative agent', 'Ad creation', 'Generate image', 'Visual direction received', 'Refine the concept'],
 listing: ['Product agent', 'Product listings', 'Read product page', 'Product details received', 'Draft A+ modules'],
 website: ['Website agent', 'Copy review', 'Read website files', 'Page content received', 'Compare with brand voice'],
 voice: ['Local dictation', 'Voice cleanup', 'Transcribe audio', 'Transcript received', 'Apply your vocabulary'],
} as const;
export function CompactHarness({id,beat,appIcon}:{id:JourneyId;beat:number;appIcon:string}) {
 const index=Math.max(0,Math.min(2,beat-5));const result=results[id][index];const agent=agents[id];
 const Icon={brand:Globe,performance:ChartNoAxesCombined,ads:Sparkles,listing:FileText,website:Globe,voice:Mic}[id];
 const working=beat>0&&beat<8;
 return <div className="wrapp-internals" data-result={beat>=5}>
   <svg className="wrapp-links" viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true"><path d="M300 0V9H150V24"/><path className={working?'internal-signal':''} d="M300 0V9H150V24"/></svg>
   <span className="harness-output-link" aria-hidden="true"/>
   <div className="agent-harness" data-working={working}>
     <header><WrappIcon name={appIcon}/><strong>{agent[0]}</strong><Repeat2 size={16}/></header>
     <div className="harness-capabilities"><span><FileText size={11}/>{agent[1]}</span><span><FolderOpen size={11}/>{id==='voice'?'Your dictionary':'Verra'}</span></div>
     <div className="harness-tool-call"><Wrench size={13}/><span>{beat===0?'Ready':beat<=3?'Project context attached':beat===4?agent[2]:beat===5?agent[3]:beat===6?agent[4]:beat===7?'Draft ready': 'Saved to your project'}</span>{beat>=8?<Check size={12}/>:working?<i/>:null}</div>
     <span className="harness-port"/>
   </div>
   <div className="wrapp-artifact" data-ready={beat>=5}>
     <header><Icon size={14}/><span>{beat>=5?result[0]:'Output'}</span><small>PREVIEW</small></header>
     {beat<5?<div className="artifact-placeholder"><span/><span/><span/></div>:<div className="artifact-copy" key={index}><strong>{result[1]}</strong><p>{result[2]}</p></div>}
     {beat>=8&&<div className="artifact-saved"><FileText size={10}/>{id==='voice'?'Ready to paste':'Saved in Verra'}<Check size={10}/></div>}
   </div>
 </div>;
}
