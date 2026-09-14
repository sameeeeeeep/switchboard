const comparisons=[
 {label:'Setup',separate:'Open source can mean a fresh install, API keys and connectors for every tool.',shared:'Connect once. Reuse your AI and tools across compatible harnesses.'},
 {label:'AI access',separate:'Paid apps often add another account and another subscription.',shared:'Bring your existing AI account or a supported local model. Switchboard is free.'},
 {label:'Context',separate:'Upload your files and explain your business again.',shared:'Share project context from your Mac, with access you control.'},
];

export default function SetupComparison(){
 return <div className="v2-comparison">
  <span className="v2-comparison-vs" aria-hidden="true">VS</span>
  <table>
   <caption className="v2-comparison-caption">Connecting each tool separately versus using Switchboard</caption>
   <thead><tr>
    <th scope="col"><span>START OVER</span><strong>Tool by tool.</strong></th>
    <th scope="col"><span>CONNECT ONCE</span><strong>With Switchboard.</strong></th>
   </tr></thead>
   <tbody>{comparisons.map(row=><tr key={row.label}>
    <td><span className="v2-comparison-label">{row.label}</span><p>{row.separate}</p></td>
    <td><span className="v2-comparison-label">{row.label}</span><p>{row.shared}</p></td>
   </tr>)}</tbody>
  </table>
  <p className="v2-comparison-takeaway">Your setup stays. The harness changes.</p>
 </div>;
}
