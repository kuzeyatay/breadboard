/** Preview-only layout repair for both current and already-published bundles. */
export function withInteractiveVisualizerInlineLayout(source: string): string {
  if (source.includes("data-breadboard-inline-layout")) return source;
  const style = `<style data-breadboard-inline-layout>
html[data-presentation="inline"],html[data-presentation="inline"] body,html[data-presentation="inline"] #app{
  height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important
}
html[data-presentation="inline"] body{display:flow-root;background:transparent!important}
html[data-presentation="inline"] #app{max-width:100%!important}
html[data-presentation="inline"] [data-breadboard-inline-expand]{
  height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important
}
</style>`;
  const script = `<script data-breadboard-inline-layout>(()=>{
  const root=document.documentElement;
  root.dataset.presentation='inline';
  const protocol='breadboard:interactive-visualizer:v1';
  const channel=new URLSearchParams(location.search).get('channel')||'standalone';
  let pending=0,lastHeight=0,disposed=false;
  const measure=()=>{
    pending=0;if(disposed)return;
    const app=document.getElementById('app')||document.body;
    // Preserve clipped scene viewports, but never trap controls in a scrolling
    // panel. Older generated packages sometimes constrain an ancestor as well.
    for(const node of app.querySelectorAll('*')){
      if(!(node instanceof HTMLElement)||node.matches('input,select,textarea,canvas')||!node.getClientRects().length)continue;
      const css=getComputedStyle(node);
      const scrolls=/^(auto|scroll)$/.test(css.overflowY);
      const clipsControls=/^(hidden|clip)$/.test(css.overflowY)&&node.scrollHeight>node.clientHeight+1&&node.querySelector('input,select,button,textarea');
      if((scrolls||clipsControls)&&!node.hasAttribute('data-breadboard-inline-expand'))node.setAttribute('data-breadboard-inline-expand','');
    }
    // Measure natural content, not documentElement.scrollHeight, whose minimum
    // is the previous iframe viewport and prevents the frame from shrinking.
    const body=document.body,box=body.getBoundingClientRect(),appBox=app.getBoundingClientRect();
    const padding=parseFloat(getComputedStyle(body).paddingBottom)||0;
    const height=Math.ceil(Math.max(box.bottom,appBox.top+app.scrollHeight+padding)+scrollY);
    if(height>0&&height!==lastHeight){lastHeight=height;parent.postMessage({protocol,channel,type:'inline-resize',height},'*')}
  };
  const schedule=()=>{if(!disposed&&!pending)pending=requestAnimationFrame(measure)};
  const observer=new ResizeObserver(schedule);observer.observe(document.body);
  const app=document.getElementById('app');if(app)observer.observe(app);
  const mutations=new MutationObserver(schedule);
  mutations.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open']});
  const dispose=()=>{disposed=true;cancelAnimationFrame(pending);observer.disconnect();mutations.disconnect();removeEventListener('resize',schedule);removeEventListener('message',onMessage);document.removeEventListener('load',schedule,true)};
  const onMessage=event=>{
    const data=event.data;
    if(event.source!==parent||!data||data.protocol!==protocol||data.channel!==channel)return;
    if(data.type==='host-dispose')dispose();
    else if(data.type==='host-presentation'||data.type==='host-theme'){lastHeight=0;schedule()}
  };
  addEventListener('message',onMessage);addEventListener('resize',schedule);
  document.addEventListener('load',schedule,true);addEventListener('pagehide',dispose,{once:true});
  document.fonts?.ready.then(schedule);
  schedule();
})();</script>`;
  source = /<\/head\s*>/i.test(source)
    ? source.replace(/<\/head\s*>/i, () => `${style}</head>`)
    : style + source;
  return /<\/body\s*>/i.test(source)
    ? source.replace(/<\/body\s*>/i, () => `${script}</body>`)
    : source + script;
}
