import crypto from "node:crypto";
import { build } from "esbuild";
import type {
  InteractiveVisualizerDefinition,
  InteractiveVisualizerManifest,
  InteractiveVisualizerMode,
} from "./interactive-visualizer-types.ts";
import { interactiveVisualizerConfig } from "./interactive-visualizer-config.ts";

const runtimeCache = new Map<InteractiveVisualizerMode, string>();

const BASE_STYLE = `
:root{color-scheme:light dark;--iv-bg:#fbfaf7;--iv-stage:#f1f2f4;--iv-surface:#efefed;--iv-surface-hover:#e6e6e3;--iv-ink:#171717;--iv-muted:#6f706f;--iv-accent:#3157c8;--iv-accent-ink:#fff;--iv-line:rgba(20,24,22,.14);--iv-grid:rgba(35,42,39,.12);--iv-chip:#f0efec;--iv-focus:#3157c8}
html[data-theme="dark"]{--iv-bg:#0f0f10;--iv-stage:#17181d;--iv-surface:#202022;--iv-surface-hover:#2a2a2c;--iv-ink:#f4f4f2;--iv-muted:#aaa9a6;--iv-accent:#4568d8;--iv-accent-ink:#fff;--iv-line:rgba(255,255,255,.14);--iv-grid:rgba(255,255,255,.1);--iv-chip:#181819;--iv-focus:#87a0ff}
html[data-accent="green"]{--iv-accent:#2f7350;--iv-focus:#54a97c}html[data-accent="amber"]{--iv-accent:#a85f18;--iv-focus:#e6a04a}html[data-accent="violet"]{--iv-accent:#7651c7;--iv-focus:#a98bf0}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--iv-bg);color:var(--iv-ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{padding:clamp(12px,2.7vw,30px)}button,input,select{font:inherit;color:inherit}button,input,select{outline:none}button:focus-visible,input:focus-visible,select:focus-visible{box-shadow:0 0 0 2px var(--iv-bg),0 0 0 4px var(--iv-focus)}[hidden]{display:none!important}#app{margin:0 auto;max-width:920px}.iv-shell{display:grid;gap:18px}.iv-header{display:flex;min-height:48px;align-items:flex-start;justify-content:space-between;gap:18px}.iv-heading{min-width:0}.iv-title{margin:0;font-size:clamp(1.55rem,4vw,2.15rem);font-weight:450;letter-spacing:-.035em;line-height:1.08}.iv-description{max-width:68ch;margin:.55rem 0 0;color:var(--iv-muted);font-size:.92rem;line-height:1.5}.iv-toolbar{display:flex;flex:none;gap:10px}.iv-icon-button{display:grid;width:50px;height:50px;place-items:center;border:0;border-radius:999px;background:var(--iv-surface);color:var(--iv-ink);cursor:pointer;font-size:1.1rem;font-weight:750;line-height:1;transition:background .16s ease,transform .16s ease}.iv-icon-button:hover{background:var(--iv-surface-hover)}.iv-icon-button:active{transform:scale(.96)}.iv-icon-button[data-kind="primary"]{background:var(--iv-accent);color:var(--iv-accent-ink)}.iv-icon-button[data-kind="primary"]:hover{filter:brightness(1.08)}
html[data-presentation="inline"],html[data-presentation="inline"] body{background:transparent}html[data-presentation="inline"] body{padding:4px 0 8px}html[data-presentation="inline"] #app{max-width:none}html[data-presentation="inline"] .iv-description{display:none}
.iv-grid{display:flex;min-width:0;flex-direction:column;gap:18px}.iv-stage{order:1;display:grid;min-width:0;gap:18px}.iv-panel{order:2}.iv-scene{min-width:0;overflow:hidden}.iv-scene-title{margin:0 0 10px;color:var(--iv-muted);font-size:.8rem;font-weight:600;letter-spacing:.02em}.iv-canvas-wrap{position:relative;min-height:390px;overflow:hidden;background:var(--iv-stage)}canvas,.iv-plot{display:block;width:100%;height:100%;min-height:390px}.iv-plot text{fill:var(--iv-muted);font:12px ui-sans-serif,system-ui}.iv-plot .axis{stroke:var(--iv-line);stroke-width:1.2}.iv-plot .grid{stroke:var(--iv-grid);stroke-width:1}.iv-plot .series{fill:none;stroke-width:3;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}.iv-plot .axis-label{font-size:12px;fill:var(--iv-muted)}.iv-legend{position:absolute;left:12px;bottom:10px;display:flex;flex-wrap:wrap;gap:10px;border:1px solid var(--iv-line);border-radius:999px;background:color-mix(in srgb,var(--iv-bg) 88%,transparent);padding:7px 11px;color:var(--iv-muted);font-size:.76rem;backdrop-filter:blur(10px)}.iv-legend-item{display:inline-flex;align-items:center;gap:6px}.iv-legend-dot{width:9px;height:9px;border-radius:999px}
.iv-outputs{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));border-top:1px solid var(--iv-line);border-bottom:1px solid var(--iv-line)}.iv-output{padding:18px 15px;text-align:center}.iv-output+.iv-output{border-left:1px solid var(--iv-line)}.iv-output-label{display:block;color:var(--iv-muted);font-size:.8rem}.iv-output-value{display:block;margin-top:8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:1rem;font-weight:500;font-variant-numeric:tabular-nums}
.iv-panel{display:grid;gap:0}.iv-panel-title{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.iv-control{display:grid;grid-template-columns:minmax(145px,.8fr) minmax(150px,1.4fr) minmax(68px,auto);align-items:center;gap:18px;min-height:74px;border-bottom:1px solid var(--iv-line);padding:11px 0}.iv-control:first-of-type{border-top:1px solid var(--iv-line)}.iv-control-line{display:contents}.iv-control label{grid-column:1;grid-row:1;font-size:.9rem;font-weight:500}.iv-control-value{grid-column:3;grid-row:1;min-width:68px;border-radius:18px;background:var(--iv-chip);padding:11px 12px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;font-variant-numeric:tabular-nums}.iv-control-value:empty{display:none}.iv-control small{grid-column:2/-1;margin-top:-12px;color:var(--iv-muted);font-size:.74rem;line-height:1.35}.iv-control input[type="range"]{grid-column:2;grid-row:1;width:100%;height:24px;margin:0;accent-color:var(--iv-accent);cursor:pointer}.iv-control input[type="number"],.iv-control select{grid-column:2;grid-row:1;width:100%;border:1px solid var(--iv-line);border-radius:18px;background:var(--iv-chip);padding:11px 13px}.iv-toggle{grid-column:1/4;display:flex;align-items:center;justify-content:space-between;gap:18px;font-size:.9rem}.iv-toggle input{width:46px;height:26px;accent-color:var(--iv-accent);cursor:pointer}.iv-toggle+.iv-control-value{display:none}.iv-button{grid-column:2/-1;border:0;border-radius:999px;background:var(--iv-surface);padding:14px 18px;cursor:pointer;transition:background .16s ease}.iv-button:hover{background:var(--iv-surface-hover)}
.iv-error{padding:16px;border:1px solid rgba(190,65,47,.32);background:rgba(190,65,47,.1);color:#d76b5a}.iv-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:640px){body{padding:10px}.iv-shell{gap:14px}.iv-title{font-size:1.45rem}.iv-icon-button{width:44px;height:44px}.iv-canvas-wrap,canvas,.iv-plot{min-height:300px}.iv-control{grid-template-columns:minmax(112px,.85fr) minmax(90px,1.15fr) minmax(62px,auto);gap:10px}.iv-control small{grid-column:1/-1;margin-top:-6px}.iv-output{padding:15px 8px}.iv-output+.iv-output:nth-child(odd){border-left:0}.iv-legend{max-width:calc(100% - 24px)}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

function runtimeEntry(mode: InteractiveVisualizerMode): string {
  const threeImport = mode !== "2d" ? `import * as THREE from "three";` : "";
  const orbitRenderer = mode !== "2d" ? `
function renderOrbit(sceneDef, mount, state, testState) {
  const wrap = element("div", "iv-canvas-wrap");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-label", sceneDef.title + " interactive 3D orbital model");
  canvas.tabIndex = 0;
  wrap.append(canvas); mount.append(wrap);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true, powerPreference:"high-performance"});
  } catch (error) {
    const fallback = element("p", "iv-error", "3D rendering is unavailable on this device.");
    wrap.replaceChildren(fallback); testState.fail("three renderer", error instanceof Error ? error.message : "WebGL unavailable");
    return {update(){}, destroy(){}};
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 2000);
  let yaw=.65, pitch=.42, distance=Math.max(16, ...sceneDef.bodies.map(body=>body.distance))*2.35;
  scene.add(new THREE.AmbientLight(0xffffff,1.1));
  const key = new THREE.PointLight(0xffffff,4,0,0); key.position.set(10,12,10); scene.add(key);
  const grid = new THREE.GridHelper(distance*1.35,20,0x7b9184,0x5e7168); grid.material.opacity=.18; grid.material.transparent=true; scene.add(grid);
  const central = new THREE.Mesh(
    new THREE.SphereGeometry(sceneDef.centralBody.radius,40,28),
    new THREE.MeshStandardMaterial({color:sceneDef.centralBody.color,roughness:.55,metalness:.04,emissive:sceneDef.centralBody.color,emissiveIntensity:.13})
  );
  central.name=sceneDef.centralBody.label; scene.add(central);
  const historyLimit=Number.isInteger(sceneDef.trailSamples)?sceneDef.trailSamples:0;
  const bodyObjects = sceneDef.bodies.map((body,index)=>{
    const pivot=new THREE.Group(); pivot.rotation.x=Number(body.inclination||0); scene.add(pivot);
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(body.radius,30,20),new THREE.MeshStandardMaterial({color:body.color,roughness:.62}));
    mesh.position.x=body.distance; mesh.name=body.label; pivot.add(mesh);
    const points=[]; for(let i=0;i<=128;i++){const angle=i/128*Math.PI*2;points.push(new THREE.Vector3(Math.cos(angle)*body.distance,0,Math.sin(angle)*body.distance))}
    const trail=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:body.color,transparent:true,opacity:.42}));
    trail.rotation.x=Number(body.inclination||0); scene.add(trail);
    const historyTrail=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:body.color,transparent:true,opacity:.82}));
    historyTrail.visible=historyLimit>1;scene.add(historyTrail);
    const velocityArrow=new THREE.ArrowHelper(new THREE.Vector3(0,0,1),new THREE.Vector3(),Math.max(.8,body.radius*3),body.color,.28,.16);
    velocityArrow.visible=Boolean(sceneDef.showVelocityVectorsInput);scene.add(velocityArrow);
    return {body,pivot,mesh,trail,historyTrail,velocityArrow,history:[],phase:index*.73};
  });
  let dragging=false,lastX=0,lastY=0;
  const down=e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)};
  const move=e=>{if(!dragging)return;yaw+=(e.clientX-lastX)*.008;pitch=clamp(pitch+(e.clientY-lastY)*.006,-1.15,1.15);lastX=e.clientX;lastY=e.clientY};
  const up=()=>{dragging=false};
  const wheel=e=>{e.preventDefault();distance=clamp(distance*(1+Math.sign(e.deltaY)*.08),6,180)};
  const keyMove=e=>{if(e.key==="ArrowLeft")yaw-=.12;if(e.key==="ArrowRight")yaw+=.12;if(e.key==="ArrowUp")pitch=clamp(pitch-.1,-1.15,1.15);if(e.key==="ArrowDown")pitch=clamp(pitch+.1,-1.15,1.15);if(e.key==="+"||e.key==="=")distance=clamp(distance*.9,6,180);if(e.key==="-")distance=clamp(distance*1.1,6,180)};
  canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",up);canvas.addEventListener("pointercancel",up);canvas.addEventListener("wheel",wheel,{passive:false});canvas.addEventListener("keydown",keyMove);
  const resize=()=>{const rect=wrap.getBoundingClientRect();const width=Math.max(260,Math.floor(rect.width));const height=Math.max(300,Math.floor(rect.height));renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix()};
  const observer=new ResizeObserver(resize);observer.observe(wrap);resize();
  let stopped=false,start=performance.now(),hidden=document.hidden;
  const visibility=()=>{hidden=document.hidden};document.addEventListener("visibilitychange",visibility);
  const frame=now=>{
    if(stopped)return;if(hidden||state.__animationPaused){requestAnimationFrame(frame);return}const elapsed=(now-start)/1000;const scale=Number(state[sceneDef.timeScaleInput]??1);const gravity=Math.max(.0001,Number(state[sceneDef.gravityInput]??1));const velocity=Math.max(.0001,Number(state[sceneDef.initialVelocityInput]??1));const dynamics=Math.sqrt(gravity)*velocity;
    central.rotation.y=elapsed*.08;
    bodyObjects.forEach(item=>{const {body,pivot,mesh,trail,historyTrail,velocityArrow,history,phase}=item;pivot.rotation.y=phase+elapsed*body.orbitSpeed*scale*dynamics;mesh.rotation.y=elapsed*Number(body.rotationSpeed||.2);trail.visible=sceneDef.showTrailsInput?Boolean(state[sceneDef.showTrailsInput]):true;const current=new THREE.Vector3();mesh.getWorldPosition(current);const previous=history[history.length-1];if(historyLimit>1){history.push(current.clone());while(history.length>historyLimit)history.shift();historyTrail.geometry.setFromPoints(history);historyTrail.visible=trail.visible}if(previous){const direction=current.clone().sub(previous);if(direction.lengthSq()>1e-10)velocityArrow.setDirection(direction.normalize())}velocityArrow.position.copy(current);velocityArrow.visible=sceneDef.showVelocityVectorsInput?Boolean(state[sceneDef.showVelocityVectorsInput]):false});
    camera.position.set(Math.cos(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.sin(yaw)*Math.cos(pitch)*distance);camera.lookAt(0,0,0);
    renderer.render(scene,camera);requestAnimationFrame(frame)
  }; requestAnimationFrame(frame);
  testState.pass("three renderer");testState.pass("3d controls");canvas.dataset.breadboardWebgl="ready";
  return {update(reset){if(reset){yaw=.65;pitch=.42;distance=Math.max(16,...sceneDef.bodies.map(body=>body.distance))*2.35;start=performance.now();for(const item of bodyObjects){item.history.length=0;item.historyTrail.geometry.setFromPoints([])}}renderer.render(scene,camera)},destroy(){stopped=true;observer.disconnect();document.removeEventListener("visibilitychange",visibility);scene.traverse(object=>{if(object.geometry)object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials){if(material&&typeof material.dispose==="function")material.dispose()}});renderer.dispose();canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerup",up);canvas.removeEventListener("pointercancel",up);canvas.removeEventListener("wheel",wheel);canvas.removeEventListener("keydown",keyMove)}};
}
function renderSpatial(sceneDef,mount,state,testState){
  const wrap=element("div","iv-canvas-wrap"),canvas=document.createElement("canvas");canvas.setAttribute("aria-label",sceneDef.title+" interactive 3D scene");canvas.tabIndex=0;wrap.append(canvas);mount.append(wrap,element("p","iv-description",sceneDef.objects.map(item=>item.label).join(", ")));
  let renderer;try{renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,powerPreference:"high-performance"})}catch(error){wrap.replaceChildren(element("p","iv-error","3D rendering is unavailable on this device."));testState.fail("three renderer",error instanceof Error?error.message:"WebGL unavailable");return{update(){},destroy(){}}}
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=THREE.SRGBColorSpace;const scene=new THREE.Scene(),perspective=sceneDef.camera==="perspective";const camera=perspective?new THREE.PerspectiveCamera(42,1,.1,2000):new THREE.OrthographicCamera(-8,8,8,-8,.1,2000);scene.add(new THREE.AmbientLight(0xffffff,1.4));const key=new THREE.DirectionalLight(0xffffff,2.3);key.position.set(8,12,10);scene.add(key);
  const geometry=shape=>shape==="box"?new THREE.BoxGeometry(1,1,1):shape==="cylinder"?new THREE.CylinderGeometry(.5,.5,1,24):shape==="torus"?new THREE.TorusGeometry(.7,.22,16,36):new THREE.SphereGeometry(.5,28,20);
  const objects=new Map(sceneDef.objects.map(def=>{const mesh=new THREE.Mesh(geometry(def.shape),new THREE.MeshStandardMaterial({color:def.color,roughness:.58,metalness:.06}));mesh.name=def.label;mesh.scale.set(...def.scale);scene.add(mesh);return[def.id,{def,mesh}]}));
  const connections=sceneDef.connections.map(def=>{const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineBasicMaterial({color:def.color}));scene.add(line);return{def,line}});
  let yaw=.7,pitch=.42,distance=18,dragging=false,lastX=0,lastY=0,stopped=false,hidden=document.hidden;const down=e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)},move=e=>{if(!dragging)return;yaw+=(e.clientX-lastX)*.008;pitch=clamp(pitch+(e.clientY-lastY)*.006,-1.15,1.15);lastX=e.clientX;lastY=e.clientY},up=()=>{dragging=false},wheel=e=>{e.preventDefault();distance=clamp(distance*(1+Math.sign(e.deltaY)*.08),4,120)},keyMove=e=>{if(e.key==="ArrowLeft")yaw-=.12;if(e.key==="ArrowRight")yaw+=.12;if(e.key==="ArrowUp")pitch=clamp(pitch-.1,-1.15,1.15);if(e.key==="ArrowDown")pitch=clamp(pitch+.1,-1.15,1.15);if(e.key==="+"||e.key==="=")distance=clamp(distance*.9,4,120);if(e.key==="-")distance=clamp(distance*1.1,4,120)},visibility=()=>{hidden=document.hidden};
  canvas.addEventListener("pointerdown",down);canvas.addEventListener("pointermove",move);canvas.addEventListener("pointerup",up);canvas.addEventListener("pointercancel",up);canvas.addEventListener("wheel",wheel,{passive:false});canvas.addEventListener("keydown",keyMove);document.addEventListener("visibilitychange",visibility);
  const resize=()=>{const rect=wrap.getBoundingClientRect(),width=Math.max(260,Math.floor(rect.width)),height=Math.max(300,Math.floor(rect.height));renderer.setSize(width,height,false);if(perspective)camera.aspect=width/height;else{const size=8;camera.left=-size*width/height;camera.right=size*width/height;camera.top=size;camera.bottom=-size}camera.updateProjectionMatrix()},observer=new ResizeObserver(resize);observer.observe(wrap);resize();
  const update=()=>{for(const {def,mesh} of objects.values())mesh.position.set(...def.position.map(expression=>valueOf(expression,state)));for(const {def,line} of connections){const from=objects.get(def.from)?.mesh.position,to=objects.get(def.to)?.mesh.position;if(from&&to)line.geometry.setFromPoints([from,to])}};
  const frame=()=>{if(stopped)return;if(!hidden&&!state.__animationPaused){update();const speed=Number(state[sceneDef.rotationSpeedInput]??0);scene.rotation.y+=Number.isFinite(speed)?speed*.002:0;camera.position.set(Math.cos(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.sin(yaw)*Math.cos(pitch)*distance);camera.lookAt(0,0,0);renderer.render(scene,camera)}requestAnimationFrame(frame)};update();requestAnimationFrame(frame);testState.pass("three renderer");testState.pass("3d controls");canvas.dataset.breadboardWebgl="ready";
  return{update,destroy(){stopped=true;observer.disconnect();document.removeEventListener("visibilitychange",visibility);scene.traverse(object=>{if(object.geometry)object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials){if(material&&typeof material.dispose==="function")material.dispose()}});renderer.dispose();canvas.removeEventListener("pointerdown",down);canvas.removeEventListener("pointermove",move);canvas.removeEventListener("pointerup",up);canvas.removeEventListener("pointercancel",up);canvas.removeEventListener("wheel",wheel);canvas.removeEventListener("keydown",keyMove)}}
}` : `
function renderOrbit(_sceneDef, mount, _state, testState) {
  mount.append(element("p","iv-error","A 3D scene was supplied to the 2D runtime."));
  testState.fail("runtime mode","3D scene in 2D runtime");
  return {update(){},destroy(){}};
}`;

  return `${threeImport}
const definition=globalThis.__BREADBOARD_INTERACTIVE_VISUALIZER__;
const protocol="breadboard:interactive-visualizer:v1";
const params=new URLSearchParams(location.search);
const channel=params.get("channel")||"standalone";
const testing=params.get("test")==="1";
const root=document.getElementById("app");
const cleanups=[];
const testChecks=[];
const testState={pass(name){testChecks.push({name,passed:true})},fail(name,detail){testChecks.push({name,passed:false,detail:String(detail||"failed")})}};
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=String(text);return node}
function transportIcon(kind){const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("width","20");svg.setAttribute("height","20");svg.setAttribute("aria-hidden","true");svg.setAttribute("fill",kind==="reset"?"none":"currentColor");if(kind==="pause"){for(const x of [7,13]){const rect=document.createElementNS(svg.namespaceURI,"rect");rect.setAttribute("x",String(x));rect.setAttribute("y","5");rect.setAttribute("width","4");rect.setAttribute("height","14");rect.setAttribute("rx","1");svg.append(rect)}}else{const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",kind==="play"?"M8 5v14l11-7z":"M20 11a8 8 0 1 0-2.34 5.66M20 11V5m0 6h-6");if(kind==="reset"){path.setAttribute("stroke","currentColor");path.setAttribute("stroke-width","1.8");path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round")}svg.append(path)}return svg}
function clamp(value,min,max){return Math.max(min,Math.min(max,value))}
function valueOf(expression,state){
  if(!expression)return NaN;
  if(expression.kind==="constant")return expression.value;
  if(expression.kind==="input")return Number(state[expression.id]??0);
  if(expression.kind==="binary"){const l=valueOf(expression.left,state),r=valueOf(expression.right,state);if(expression.op==="add")return l+r;if(expression.op==="subtract")return l-r;if(expression.op==="multiply")return l*r;if(expression.op==="divide")return r===0?NaN:l/r;if(expression.op==="power")return Math.pow(l,r);if(expression.op==="min")return Math.min(l,r);return Math.max(l,r)}
  if(expression.kind==="unary"){const v=valueOf(expression.argument,state);if(expression.op==="negate")return-v;if(expression.op==="abs")return Math.abs(v);if(expression.op==="sqrt")return Math.sqrt(v);if(expression.op==="sin")return Math.sin(v);if(expression.op==="cos")return Math.cos(v);if(expression.op==="tan")return Math.tan(v);if(expression.op==="exp")return Math.exp(v);return Math.log(v)}
  if(expression.kind==="clamp")return clamp(valueOf(expression.value,state),valueOf(expression.min,state),valueOf(expression.max,state));
  if(expression.kind==="conditional"){const l=valueOf(expression.left,state),r=valueOf(expression.right,state);const ok=expression.comparison==="lt"?l<r:expression.comparison==="lte"?l<=r:expression.comparison==="gt"?l>r:expression.comparison==="gte"?l>=r:l===r;return valueOf(ok?expression.whenTrue:expression.whenFalse,state)}
  return NaN
}
function initialState(){const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;const state={x:0,t:0,__animationPaused:definition.animation?.autoplay===false||reduced};for(const control of definition.controls)state[control.id]=control.defaultValue;return state}
function renderControls(controls,mount,state,onChange){
  for(const control of controls){const field=element("div","iv-control");const line=element("div","iv-control-line");const label=element("label","",control.label);const output=element("span","iv-control-value");line.append(label,output);field.append(line);let input;
    if(control.type==="slider"||control.type==="number"){input=document.createElement("input");input.type=control.type==="slider"?"range":"number";input.min=String(control.min);input.max=String(control.max);input.step=String(control.step);input.value=String(control.defaultValue);output.textContent=String(control.defaultValue)+(control.unit?" "+control.unit:"");input.addEventListener("input",()=>{state[control.id]=Number(input.value);output.textContent=input.value+(control.unit?" "+control.unit:"");onChange()});field.append(input)}
    else if(control.type==="select"){input=document.createElement("select");for(const option of control.options||[]){const node=document.createElement("option");node.value=option;node.textContent=option;input.append(node)}input.value=String(control.defaultValue);output.textContent=String(control.defaultValue);input.addEventListener("change",()=>{state[control.id]=input.value;output.textContent=input.value;onChange()});field.append(input)}
    else if(control.type==="toggle"){const holder=element("label","iv-toggle");input=document.createElement("input");input.type="checkbox";input.checked=Boolean(control.defaultValue);const caption=element("span","",control.label);holder.append(input,caption);line.replaceWith(holder);output.textContent=input.checked?"On":"Off";input.addEventListener("change",()=>{state[control.id]=input.checked;output.textContent=input.checked?"On":"Off";onChange()});field.append(output)}
    else{input=element("button","iv-button","Reset");input.type="button";output.textContent="";input.addEventListener("click",()=>{Object.assign(state,initialState());onChange(true)});field.append(input)}
    if(control.description)field.append(element("small","",control.description));mount.append(field)
  }
}
function renderOutputs(outputs,mount,state){const nodes=outputs.map(output=>{const card=element("div","iv-output");card.append(element("span","iv-output-label",output.label));const value=element("strong","iv-output-value");card.append(value);mount.append(card);return{output,value}});return()=>{for(const item of nodes){const raw=valueOf(item.output.expression,state);item.value.textContent=Number.isFinite(raw)?raw.toFixed(Number.isInteger(item.output.precision)?item.output.precision:2)+(item.output.unit?" "+item.output.unit:""):"—"}}}
function renderPlot(sceneDef,mount,state,testState){
  const wrap=element("div","iv-canvas-wrap");const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 800 420");svg.setAttribute("role","img");svg.setAttribute("aria-label",sceneDef.title);svg.classList.add("iv-plot");wrap.append(svg);mount.append(wrap);
  const margin={l:58,r:18,t:20,b:48},width=800-margin.l-margin.r,height=420-margin.t-margin.b;
  const axis=(x1,y1,x2,y2)=>{const line=document.createElementNS(svg.namespaceURI,"line");line.setAttribute("x1",String(x1));line.setAttribute("y1",String(y1));line.setAttribute("x2",String(x2));line.setAttribute("y2",String(y2));line.setAttribute("class","axis");svg.append(line)};axis(margin.l,margin.t,margin.l,margin.t+height);axis(margin.l,margin.t+height,margin.l+width,margin.t+height);
  const paths=sceneDef.series.map((series,index)=>{const path=document.createElementNS(svg.namespaceURI,"path");path.setAttribute("class","series");path.setAttribute("stroke",series.color||["#5c7c63","#5779a8","#b17a42","#876ca8"][index%4]);svg.append(path);return{series,path}});
  const update=()=>{let yMin=Number(sceneDef.yMin),yMax=Number(sceneDef.yMax);const values=paths.map(({series})=>Array.from({length:sceneDef.samples},(_,index)=>{const x=sceneDef.xMin+(sceneDef.xMax-sceneDef.xMin)*index/(sceneDef.samples-1);return{x,y:valueOf(series.expression,{...state,x})}}));const finite=values.flat().filter(point=>Number.isFinite(point.y));if(!Number.isFinite(yMin))yMin=Math.min(...finite.map(point=>point.y));if(!Number.isFinite(yMax))yMax=Math.max(...finite.map(point=>point.y));if(!Number.isFinite(yMin)||!Number.isFinite(yMax)){testState.fail("finite plot","plot produced non-finite values");return}if(yMin===yMax){yMin-=1;yMax+=1}values.forEach((series,index)=>{const d=series.filter(point=>Number.isFinite(point.y)).map((point,i)=>{const x=margin.l+(point.x-sceneDef.xMin)/(sceneDef.xMax-sceneDef.xMin)*width;const y=margin.t+height-(point.y-yMin)/(yMax-yMin)*height;return(i?"L":"M")+x.toFixed(2)+" "+y.toFixed(2)}).join(" ");paths[index].path.setAttribute("d",d)});testState.pass("finite plot")};
  update();return{update,destroy(){}}
}
function renderDiagram(sceneDef,mount,state,testState){
  const wrap=element("div","iv-canvas-wrap"),svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 "+sceneDef.width+" "+sceneDef.height);svg.setAttribute("role","img");svg.setAttribute("aria-label",sceneDef.title);svg.classList.add("iv-plot");wrap.append(svg);mount.append(wrap);
  const nodes=sceneDef.elements.map(def=>{const tag=def.kind==="circle"?"circle":def.kind==="rect"?"rect":def.kind==="line"?"line":"text",node=document.createElementNS(svg.namespaceURI,tag);node.setAttribute("aria-label",def.label);if(def.kind==="text")node.textContent=def.text;node.setAttribute(def.kind==="line"?"stroke":"fill",def.color);svg.append(node);return{def,node}});
  const update=()=>{let finite=true;const set=(node,key,value)=>{finite=finite&&Number.isFinite(value);node.setAttribute(key,String(Number.isFinite(value)?value:0))};for(const {def,node} of nodes){if(def.kind==="circle"){set(node,"cx",valueOf(def.cx,state));set(node,"cy",valueOf(def.cy,state));node.setAttribute("r",String(def.radius))}else if(def.kind==="rect"){set(node,"x",valueOf(def.x,state));set(node,"y",valueOf(def.y,state));node.setAttribute("width",String(def.width));node.setAttribute("height",String(def.height))}else if(def.kind==="line"){for(const key of ["x1","y1","x2","y2"])set(node,key,valueOf(def[key],state));node.setAttribute("stroke-width","2")}else{set(node,"x",valueOf(def.x,state));set(node,"y",valueOf(def.y,state))}}finite?testState.pass("finite diagram"):testState.fail("finite diagram","diagram produced non-finite coordinates")};update();return{update,destroy(){}}
}
function renderPendulum(sceneDef,mount,state,testState){
  const wrap=element("div","iv-canvas-wrap");const canvas=document.createElement("canvas");canvas.setAttribute("role","img");canvas.setAttribute("aria-label",sceneDef.title+" animated double pendulum");wrap.append(canvas);mount.append(wrap);const context=canvas.getContext("2d");let width=0,height=0,last=performance.now(),a1=Number(state[sceneDef.angle1Input]),a2=Number(state[sceneDef.angle2Input]),v1=0,v2=0,trail=[];
  const resize=()=>{const rect=wrap.getBoundingClientRect();const ratio=Math.min(devicePixelRatio||1,2);width=Math.max(260,Math.floor(rect.width));height=Math.max(300,Math.floor(rect.height));canvas.width=width*ratio;canvas.height=height*ratio;context.setTransform(ratio,0,0,ratio,0,0)};const observer=new ResizeObserver(resize);observer.observe(wrap);resize();
  const reset=()=>{a1=Number(state[sceneDef.angle1Input]);a2=Number(state[sceneDef.angle2Input]);v1=v2=0;trail=[]};
  let stopped=false,hidden=document.hidden;const visibility=()=>{hidden=document.hidden};document.addEventListener("visibilitychange",visibility);const frame=now=>{if(stopped)return;if(hidden||state.__animationPaused){last=now;requestAnimationFrame(frame);return}const speed=Math.max(.05,Number(state[sceneDef.speedInput]??1));const dt=Math.min(.018,Math.max(.001,(now-last)/1000))*speed;last=now;const g=Number(state[sceneDef.gravityInput]),l1=Number(state[sceneDef.length1Input]),l2=Number(state[sceneDef.length2Input]),m1=Number(state[sceneDef.mass1Input]),m2=Number(state[sceneDef.mass2Input]);const c=Math.cos(a1-a2),s=Math.sin(a1-a2),den1=(m1+m2)*l1-m2*l1*c*c,den2=(l2/l1)*den1;const acc1=(m2*l1*v1*v1*s*c+m2*g*Math.sin(a2)*c+m2*l2*v2*v2*s-(m1+m2)*g*Math.sin(a1))/den1;const acc2=(-m2*l2*v2*v2*s*c+(m1+m2)*(g*Math.sin(a1)*c-l1*v1*v1*s-g*Math.sin(a2)))/den2;v1+=acc1*dt;v2+=acc2*dt;a1+=v1*dt;a2+=v2*dt;const scale=Math.min(width,height)*.19,ox=width/2,oy=height*.23,x1=ox+Math.sin(a1)*l1*scale,y1=oy+Math.cos(a1)*l1*scale,x2=x1+Math.sin(a2)*l2*scale,y2=y1+Math.cos(a2)*l2*scale;trail.push([x2,y2]);if(trail.length>240)trail.shift();context.clearRect(0,0,width,height);if(sceneDef.trail&&trail.length>1){context.beginPath();trail.forEach((point,index)=>index?context.lineTo(point[0],point[1]):context.moveTo(point[0],point[1]));context.strokeStyle="rgba(86,115,91,.38)";context.lineWidth=1.5;context.stroke()}context.beginPath();context.moveTo(ox,oy);context.lineTo(x1,y1);context.lineTo(x2,y2);context.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue("--iv-ink");context.lineWidth=3;context.stroke();for(const [x,y,r] of [[x1,y1,9],[x2,y2,11]]){context.beginPath();context.arc(x,y,r,0,Math.PI*2);context.fillStyle=getComputedStyle(document.documentElement).getPropertyValue("--iv-accent");context.fill()}requestAnimationFrame(frame)};requestAnimationFrame(frame);testState.pass("double pendulum physics");
  return{update:reset,destroy(){stopped=true;observer.disconnect();document.removeEventListener("visibilitychange",visibility)}}
}
${orbitRenderer}
function render(){
  if(!root||!definition){document.body.textContent="Interactive visualization definition is unavailable.";return}
  document.documentElement.dataset.accent=definition.theme?.accent||"blue";const state=initialState();const shell=element("article","iv-shell");const header=element("header","iv-header"),heading=element("div","iv-heading");heading.append(element("h1","iv-title",definition.title),element("p","iv-description",definition.description));header.append(heading);shell.append(header);
  const grid=element("div","iv-grid");const panel=element("aside","iv-panel");panel.append(element("h2","iv-panel-title","Controls"));const stage=element("section","iv-stage");grid.append(panel,stage);shell.append(grid);const outputMount=element("section","iv-outputs");stage.append(outputMount);const updateOutputs=renderOutputs(definition.outputs,outputMount,state);const renderers=[];
  const update=(reset=false)=>{updateOutputs();renderers.forEach(renderer=>renderer.update(reset));};
  if(definition.animation){const toolbar=element("div","iv-toolbar"),toggle=element("button","iv-icon-button"),reset=element("button","iv-icon-button");toggle.type=reset.type="button";toggle.dataset.action="play-pause";toggle.dataset.kind="primary";reset.dataset.action="reset";reset.append(transportIcon("reset"));const sync=()=>{toggle.replaceChildren(transportIcon(state.__animationPaused?"play":"pause"));toggle.setAttribute("aria-label",state.__animationPaused?"Play animation":"Pause animation");toggle.setAttribute("aria-pressed",String(!state.__animationPaused))};sync();toggle.addEventListener("click",()=>{state.__animationPaused=!state.__animationPaused;sync()});reset.addEventListener("click",()=>{const paused=state.__animationPaused;Object.assign(state,initialState());state.__animationPaused=paused;update(true);sync()});reset.setAttribute("aria-label","Reset animation");toolbar.append(toggle,reset);header.append(toolbar)}
  renderControls(definition.controls,panel,state,update);
  for(const sceneDef of definition.scenes){const card=element("section","iv-scene");card.append(element("h2","iv-scene-title",sceneDef.title));stage.insertBefore(card,outputMount);const renderer=sceneDef.kind==="plot2d"?renderPlot(sceneDef,card,state,testState):sceneDef.kind==="diagram2d"?renderDiagram(sceneDef,card,state,testState):sceneDef.kind==="double-pendulum"?renderPendulum(sceneDef,card,state,testState):sceneDef.kind==="scene3d"?renderSpatial(sceneDef,card,state,testState):renderOrbit(sceneDef,card,state,testState);renderers.push(renderer)}
  root.replaceChildren(shell);update();cleanups.push(...renderers.map(renderer=>()=>renderer.destroy()));
  const values=definition.outputs.map(output=>valueOf(output.expression,state));if(values.every(value=>Number.isFinite(value)||Number.isNaN(value)))testState.pass("output evaluation");
  document.documentElement.dataset.breadboardRuntimeTests=testChecks.every(check=>check.passed)?"passed":"failed";
  let interactionPassed=definition.controls.length>0;
  if(testing){const focusable=root.querySelector("input,select,button");if(focusable){focusable.focus();interactionPassed=document.activeElement===focusable;if(focusable instanceof HTMLInputElement&&focusable.type==="range"){const previous=focusable.value;focusable.value=String(Math.min(Number(focusable.max),Number(previous)+Number(focusable.step||1)));focusable.dispatchEvent(new Event("input",{bubbles:true}));interactionPassed=interactionPassed&&focusable.value!==previous}}if(definition.animation){for(const action of ["play-pause","reset"]){const button=root.querySelector('[data-action="'+action+'"]');if(button)button.click();else interactionPassed=false}}}
  document.documentElement.dataset.breadboardInteractionTests=interactionPassed?"passed":"failed";
  document.documentElement.dataset.breadboardOverflow=document.documentElement.scrollWidth>document.documentElement.clientWidth+2?"true":"false";
}
function send(type,payload={}){parent.postMessage({protocol,type,channel,...payload},"*")}
addEventListener("message",event=>{const data=event.data;if(event.source!==parent||!data||data.protocol!==protocol||data.channel!==channel)return;if(data.type==="host-theme"&&(data.theme==="light"||data.theme==="dark")){document.documentElement.dataset.theme=data.theme;dispatchEvent(new CustomEvent("breadboard:themechange",{detail:{theme:data.theme}}))}if(data.type==="host-presentation"&&data.presentation==="inline")document.documentElement.dataset.presentation="inline"});
addEventListener("beforeunload",()=>cleanups.splice(0).forEach(cleanup=>cleanup()));
render();send("ready",{height:document.documentElement.scrollHeight});new ResizeObserver(()=>send("resize",{height:document.documentElement.scrollHeight})).observe(document.body);
`;
}

export async function buildInteractiveVisualizerRuntime(
  mode: InteractiveVisualizerMode,
): Promise<string> {
  const cached = runtimeCache.get(mode);
  if (cached) return cached;
  const result = await build({
    stdin: {
      contents: runtimeEntry(mode),
      resolveDir: process.cwd(),
      sourcefile: `breadboard-interactive-visualizer-${mode}.ts`,
      loader: "ts",
    },
    bundle: true,
    write: false,
    minify: true,
    legalComments: "none",
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    treeShaking: true,
    logLevel: "silent",
  });
  const runtime = result.outputFiles[0]?.text;
  if (!runtime) throw new Error("The trusted interactive visualizer runtime could not be bundled.");
  const maximum = interactiveVisualizerConfig().maxBundleBytes;
  if (Buffer.byteLength(runtime, "utf8") > maximum) {
    throw new Error(`The trusted visualizer runtime exceeds ${maximum} bytes.`);
  }
  runtimeCache.set(mode, runtime);
  return runtime;
}

function bodyShell(html: string): string {
  return html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]?.trim() ||
    html.match(/(<(?:main|div)\b[^>]*\bid\s*=\s*(?:"app"|'app'|app)(?=\s|\/?>)[\s\S]*<\/(?:main|div)>)/i)?.[1] ||
    '<main id="app"></main>';
}

function scriptSafe(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

export async function bundleInteractiveVisualizer(input: {
  definition: InteractiveVisualizerDefinition;
  manifest: InteractiveVisualizerManifest;
  html: string;
  css: string;
}): Promise<{ html: string; hash: string }> {
  const runtime = await buildInteractiveVisualizerRuntime(input.manifest.mode);
  const definition = JSON.stringify(input.definition).replace(/</g, "\\u003c");
  const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const html = [
    "<!doctype html>",
    `<html lang="en" data-theme="light">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<meta name="color-scheme" content="light dark">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    `<title>${escapeHtml(input.manifest.title)}</title>`,
    `<style>${scriptSafe(BASE_STYLE)}\n${scriptSafe(input.css)}</style>`,
    "</head>",
    `<body>${bodyShell(input.html)}`,
    `<script>globalThis.__BREADBOARD_INTERACTIVE_VISUALIZER__=Object.freeze(${definition});</script>`,
    `<script>${scriptSafe(runtime)}</script>`,
    "</body></html>",
  ].join("");
  const maximum = interactiveVisualizerConfig().maxArtifactBytes;
  if (Buffer.byteLength(html, "utf8") > maximum) {
    throw new Error(`The compiled visualizer exceeds ${maximum} bytes.`);
  }
  return {
    html,
    hash: crypto.createHash("sha256").update(html).digest("hex"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
