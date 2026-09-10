import type { ReactNode } from 'react';
import {AppleIcon} from './v2/product-scenes';
import { Check, FileText, FolderOpen, Globe, Image as ImageIcon, Mic, Volume2, Cpu, LockKeyhole, ArrowDown, Laptop, Database } from 'lucide-react';
import { journey, journeyOrder, type JourneyId } from './journey';
import { scenarios } from './scenarios';
import './journey.css';
const connectors = [
  { id: 'files', name: 'Files', Icon: FolderOpen },
  { id: 'web', name: 'Web', Icon: Globe },
  { id: 'image', name: 'Image tools', Icon: ImageIcon },
  { id: 'meta', name: 'Meta Ads', src: '/connectors/meta.svg' },
  { id: 'github', name: 'GitHub', src: '/connectors/github.svg' },
  { id: 'notion', name: 'Notion', src: '/connectors/notion.svg' },
];
export function JourneyResources({ id, beat, chapter, provider, local }: { id: JourneyId; beat: number; chapter: number; provider: ReactNode; local: boolean }) {
  const used = journey[id].tools as readonly string[];
  const computing = beat >= 4 && beat <= 7;
  return <div className="journey-resources">
    <div className="model-with-connectors">
      <div className={'routing-resource resource-compute ' + (computing ? 'resource-active' : '')}>
        <span className="resource-label">{local ? 'LOCAL COMPUTE' : 'YOUR AI'}</span>{provider}<span className="resource-detail">{local ? 'On your device' : 'Your existing account'}</span>
      </div>
      <div className={'connector-stem ' + (computing && !local ? 'stem-active' : '')}><ArrowDown size={12} /></div>
      <div className="connector-bank"><span className="resource-label">YOUR CONNECTORS</span><div className="connector-grid">{connectors.map(({ id: tool, name, Icon, src }) => <div className="connector-tile" data-active={computing && used.includes(tool)} key={tool} title={name}>
        {src ? <img src={src} alt="" width={23} height={23} /> : Icon ? <Icon size={22} /> : null}<span>{name}</span>{computing && used.includes(tool) && <i />}
      </div>)}</div></div>
    </div>
    <div className={'routing-resource project-bank ' + (beat === 3 || beat === 8 ? 'resource-active' : '')}>
      <span className="resource-label"><AppleIcon/> ON YOUR MAC <LockKeyhole size={12} /></span>
      <span className="mac-resource-category">CONTEXT</span><div className={'project-folder ' + (!local ? 'project-selected' : '')}><FolderOpen size={17} /><strong>Verra</strong><span>{!local ? 'IN USE' : 'CLOSED'}</span></div>
      <div className="project-files"><span><FileText size={12} />product-notes.md</span>{journeyOrder.slice(0,5).map((index, order) => { const step = journey[scenarios[index].id]; const saved = chapter > order || chapter === order && beat >= 8; return <span key={step.output} data-current-output={saved && order === Math.min(4, beat >= 8 ? chapter : chapter-1)} data-recent={order >= Math.max(0, chapter-2) && order <= chapter} data-saved={saved} data-writing={chapter === order && beat === 8}><FileText size={12} />{step.output}{saved && <Check size={10} />}</span>; })}</div>
      <div className="project-folder"><FolderOpen size={16} /><strong>Morrow</strong><LockKeyhole size={11} /></div>
      <div className={'project-folder ' + (local ? 'project-selected' : '')}><FolderOpen size={16} /><strong>Personal</strong>{local ? <span>IN USE</span> : <LockKeyhole size={11} />}</div>
      {local && <span className="dictionary-file"><FileText size={12} />Your dictionary</span>}
      <div className="mac-data-bank"><span className="mac-resource-category">DATA</span><span><Database size={12}/>campaigns.csv</span><span><FileText size={12}/>product-catalog.csv</span></div>
    </div>
    <div className="routing-resource local-bank"><span className="resource-label">LOCAL MODELS</span>
      {[{ Icon: Mic, title: 'Whisper', detail: 'Voice → text', on: beat === 2 }, { Icon: Cpu, title: 'Ollama', detail: 'Local text model', on: local && computing }, { Icon: Volume2, title: 'Speech', detail: 'Text → voice', on: beat === 9 }].map(({Icon,title,detail,on}) => <div className="local-service" data-active={on} key={title}><Icon size={21} /><span><strong>{title}</strong><small>{detail}</small></span>{on && <i />}</div>)}
      
    </div>
  </div>;
}
