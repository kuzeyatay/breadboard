import { mapPointSize, mapThreadOpacity } from './topologyPaint.mjs';
import * as THREE from './vendor/three/three.module.js';
import { FS_PTS, FS_LN } from './topologyInk';

const project = `
  uniform vec4 framing;
  uniform vec2 screenSize;
  uniform vec4 rotation;
  uniform vec3 tones[8];
  attribute float tone;
  attribute float indexInView;
  attribute float weight;
  uniform float picked;
  vec4 positionOnMap() {
    float depth = -rotation.y * position.x + rotation.x * position.z;
    vec2 p = vec2(rotation.x * position.x + rotation.y * position.z, rotation.z * position.y - rotation.w * depth);
    vec2 css = (p - framing.xy) * framing.z + viewOffset;
    return vec4(css * vec2(2., -2.) / screenSize, 0., 1.);
  }`;
const common = 'uniform vec2 viewOffset;\n' + project;
const points =
  common +
  `
  uniform float pixelRatio;
  attribute float emphasis;
  varying vec3 vC; varying float vA,vS,vG,vK,vH,vX;
  void main() {
    gl_Position = positionOnMap(); float lit = 1.-step(.25, abs(picked-indexInView));
    vC = tones[int(tone)] * emphasis; vA = .87 + .13*lit; vK=1.; vG=lit; vH=0.; vX=1.;
    vS = (weight + 4.*lit) * pixelRatio * framing.w; gl_PointSize = vS;
  }`;
const lines = (light) =>
  common +
  (light ? 'uniform float paperLineGain; attribute float bridge;\n' : '') +
  `
  attribute float along; attribute float sourceIndex; attribute float targetIndex;
  uniform float pickedNode;
  varying vec3 vC; varying float vA,vT,vS,vF,vD,vL;
  void main() {
    gl_Position=positionOnMap();
    float related = min(abs(sourceIndex-pickedNode),abs(targetIndex-pickedNode));
    vL=max(1.-step(.25, abs(picked-indexInView)), 1.-step(.25,related));
    vC=tones[int(tone)]; vA=${light ? 'weight*max(paperLineGain,bridge*.8)' : 'weight'}; vT=along; vS=indexInView*.618034; vF=0.; vD=1.;
  }`;

// The host owns the canvas and WebGL context. Its overlay draws labels and
// activity rings after the map has painted the points and line segments.
export function createMapShaders(canvas, context, light = false) {
  const renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
  renderer.setClearColor(0, 0);
  const scene = new THREE.Scene(),
    sceneCamera = new THREE.Camera();
  const parameter = (value) => ({ value });
  const shared = {
    framing: parameter(new THREE.Vector4()),
    viewOffset: parameter(new THREE.Vector2()),
    rotation: parameter(new THREE.Vector4()),
    screenSize: parameter(new THREE.Vector2()),
    tones: parameter(Array.from({ length: 8 }, () => new THREE.Vector3(1, 1, 1))),
  };
  function material(vertexShader, fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...shared, ...uniforms },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      premultipliedAlpha: true,
    });
  }
  const pointMaterial = material(points, FS_PTS, {
    picked: parameter(-2),
    pixelRatio: parameter(1),
    uHalo: parameter(1),
    uTint: parameter(new THREE.Vector3(1, 1, 1)),
  });
  const lineMaterial = material(lines(light), FS_LN, {
    ...(light ? { paperLineGain: parameter(1) } : {}),
    picked: parameter(-2),
    pickedNode: parameter(-2),
    uTime: parameter(0),
    uMotion: parameter(0),
    uLite: parameter(new THREE.Vector3(1, 1, 1)),
  });
  const dots = new THREE.Points(new THREE.BufferGeometry(), pointMaterial);
  const threads = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
  dots.frustumCulled = threads.frustumCulled = false;
  dots.renderOrder = 1;
  scene.add(threads, dots);
  let nodeIndex = new Map(),
    edgeIndex = new Map();
  function geometry(object, attrs) {
    object.geometry.dispose();
    const geometry = new THREE.BufferGeometry();
    for (const [name, values] of Object.entries(attrs))
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, name === 'position' ? 3 : 1));
    object.geometry = geometry;
  }
  function setNodes(nodes, toneOf) {
    nodeIndex = new Map(nodes.map((n, i) => [n.id, i]));
    const pts = { position: [], tone: [], indexInView: [], weight: [], emphasis: [] };
    for (const n of nodes) {
      pts.position.push(n.x, n.y, n.z);
      pts.tone.push(toneOf(n));
      pts.indexInView.push(nodeIndex.get(n.id));
      pts.weight.push(mapPointSize(n.kind !== 'page', false));
      pts.emphasis.push(1);
    }
    geometry(dots, pts);
  }
  function setLines(nodes, edges, toneOf, focus) {
    const emphasis = dots.geometry.getAttribute('emphasis');
    for (let i = 0; i < nodes.length; i++) emphasis.setX(i, !focus || focus.has(nodes[i].id) ? 1 : 0.18);
    emphasis.needsUpdate = true;
    edgeIndex = new Map(edges.map((e, i) => [e.id, i]));
    const seg = {
      ...(light ? { bridge: [] } : {}),
      position: [],
      tone: [],
      indexInView: [],
      weight: [],
      along: [],
      sourceIndex: [],
      targetIndex: [],
    };
    for (const edge of edges) {
      const s = nodeIndex.get(edge.source),
        t = nodeIndex.get(edge.target);
      for (const index of [s, t]) {
        const n = nodes[index];
        seg.position.push(n.x, n.y, n.z);
        seg.tone.push(toneOf(n));
        seg.indexInView.push(edgeIndex.get(edge.id));
        seg.along.push(index === s ? 0 : 1);
        seg.weight.push(edge.opacity ?? mapThreadOpacity(edge.structural, edge.strength));
        if (light) seg.bridge.push(edge.crossFolder && !edge.structural ? 1 : 0);
        seg.sourceIndex.push(s);
        seg.targetIndex.push(t);
      }
    }
    geometry(threads, seg);
  }
  function updatePositions(nodes, edges) {
    const pts = dots.geometry.getAttribute('position'), seg = threads.geometry.getAttribute('position');
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      pts.setXYZ(i, n.x, n.y, n.z);
    }
    for (let i = 0; i < edges.length; i++) {
      const s = nodes[nodeIndex.get(edges[i].source)], t = nodes[nodeIndex.get(edges[i].target)];
      seg.setXYZ(i * 2, s.x, s.y, s.z);
      seg.setXYZ(i * 2 + 1, t.x, t.y, t.z);
    }
    pts.needsUpdate = seg.needsUpdate = true;
  }
  function resize(w, h) {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    shared.screenSize.value.set(w, h);
    pointMaterial.uniforms.pixelRatio.value = dpr;
  }
  function draw(camera, center, pan, scale, zoom, item, colors, ink) {
    if (light) {
      // Keep every line pickable. When many lines share a small paper
      // surface, use less ink per stroke and restore it as the view zooms in.
      const {x, y} = shared.screenSize.value;
      const areaPerLine = x * y / Math.max(1, edgeIndex.size);
      lineMaterial.uniforms.paperLineGain.value = Math.min(1, Math.max(.16, areaPerLine * zoom * zoom / 160));
    }
    shared.framing.value.set(
      center.x,
      center.y,
      scale * zoom,
      Math.min(2.2, Math.max(0.85, Math.sqrt(zoom))),
    );
    shared.viewOffset.value.set(pan.x, pan.y);
    shared.rotation.value.set(
      Math.cos(camera.yaw),
      Math.sin(camera.yaw),
      Math.cos(camera.pitch),
      Math.sin(camera.pitch),
    );
    for (let i = 0; i < colors.length; i++) shared.tones.value[i].fromArray(colors[i]);
    lineMaterial.uniforms.uLite.value.fromArray(ink);
    const node = nodeIndex.get(item?.id) ?? -2;
    pointMaterial.uniforms.picked.value = lineMaterial.uniforms.pickedNode.value = node;
    lineMaterial.uniforms.picked.value = edgeIndex.get(item?.id) ?? -2;
    lineMaterial.uniforms.uTime.value = performance.now() / 1000;
    renderer.resetState();
    renderer.render(scene, sceneCamera);
  }
  return {
    setNodes,
    setLines,
    updatePositions,
    resize,
    draw,
    available: () => !renderer.getContext().isContextLost(),
    dispose() {
      dots.geometry.dispose();
      threads.geometry.dispose();
      pointMaterial.dispose();
      lineMaterial.dispose();
      renderer.dispose();

    },
  };
}
