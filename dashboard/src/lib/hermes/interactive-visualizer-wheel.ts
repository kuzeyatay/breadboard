/** Shared by new bundles, stored chat previews, and the Quartz iframe host. */
export const INTERACTIVE_VISUALIZER_WHEEL_SCRIPT = String.raw`(()=>{
  const root=document.documentElement;
  if(root.dataset.breadboardWheelZoom==='1')return;
  root.dataset.breadboardWheelZoom='1';
  const label=node=>[node.id,node.name,node.getAttribute('aria-label'),node.getAttribute('title'),node.textContent,...Array.from(node.labels||[],n=>n.textContent)].filter(Boolean).join(' ').replace(/[_-]/g,' ');
  const usable=node=>!node.disabled&&!node.hidden&&node.getClientRects().length>0;
  let residue=0,lastAt=0,lastControl=null,lastValue='';
  const wheel=event=>{
    if(event.defaultPrevented||event.ctrlKey||event.metaKey||!Number.isFinite(event.deltaY)||!event.deltaY)return;
    const app=document.getElementById('app')||document.body;
    if(!(event.target instanceof Element)||!app.contains(event.target))return;
    const field=event.target.closest('input,select,textarea,[contenteditable="true"]');
    const control=Array.from(app.querySelectorAll('input[type="range"],input[type="number"]')).find(n=>usable(n)&&(n.matches('[data-visualizer-zoom]')||/\bzoom\b/i.test(label(n))));
    if(field&&field!==control)return;
    const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?innerHeight:1);
    const delta=Math.max(-240,Math.min(240,pixels));
    const now=performance.now();
    if(control){
      const value=Number(control.value),minimum=Number(control.min||0),maximum=Number(control.max||100);
      if(!Number.isFinite(value)||!Number.isFinite(minimum)||!Number.isFinite(maximum)||maximum<=minimum)return;
      const step=control.step==='any'?0:Number(control.step||1);
      if(control!==lastControl||now-lastAt>400||control.value!==lastValue)residue=0;
      let increment=-delta/100*(maximum-minimum)*.06*(control.dataset.zoomDirection==='inverse'?-1:1);
      // A mouse notch moves even a short, coarsely stepped zoom range.
      if(step>0&&Math.abs(delta)>=40&&Math.abs(increment)<step)increment=Math.sign(increment)*step;
      residue+=increment;
      const change=step>0?Math.trunc(residue/step)*step:residue;
      const next=Math.min(maximum,Math.max(minimum,value+change));
      residue-=change;
      if(next===minimum||next===maximum)residue=0;
      if(next!==value){control.value=String(Number(next.toFixed(10)));control.dispatchEvent(new Event('input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));}
      lastValue=control.value;lastControl=control;lastAt=now;event.preventDefault();return;
    }
    const action=delta<0?'in':'out';
    const button=Array.from(app.querySelectorAll('button,[role="button"]')).find(n=>usable(n)&&(n.getAttribute('data-action')==='zoom-'+action||new RegExp('\\bzoom\\s*'+action+'\\b','i').test(label(n))));
    if(!button)return;
    if(button!==lastControl||now-lastAt>400)residue=0;
    residue+=Math.abs(delta);lastControl=button;lastAt=now;
    const clicks=Math.min(3,Math.floor(residue/60));residue-=clicks*60;
    for(let i=0;i<clicks;i++)button.click();
    event.preventDefault();
  };
  // Bubble after scene handlers: an existing camera wheel handler wins.
  window.addEventListener('wheel',wheel,{passive:false});
  const dispose=()=>{window.removeEventListener('wheel',wheel);delete root.dataset.breadboardWheelZoom};
  globalThis.__BREADBOARD_VISUALIZER__?.addCleanup(dispose);
  window.addEventListener('pagehide',dispose,{once:true});
})();`;

export function withInteractiveVisualizerWheelZoom(html: string): string {
  const script = `<script data-breadboard-wheel-zoom>${INTERACTIVE_VISUALIZER_WHEEL_SCRIPT}</script>`;
  const existing =
    /<script\b[^>]*\bdata-breadboard-wheel-zoom(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?[^>]*>[\s\S]*?<\/script\s*>/i;
  if (existing.test(html)) return html.replace(existing, () => script);
  return /<\/body\s*>/i.test(html)
    ? html.replace(/<\/body\s*>/i, `${script}</body>`)
    : html + script;
}
