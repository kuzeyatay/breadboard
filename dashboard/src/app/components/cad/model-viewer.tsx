"use client";

// The interactive 3D preview, for both a generated CAD revision and a 3D file
// the user attached to a chat.
//
// Three.js is bundled with the dashboard (`three@0.185.1`); nothing here is
// fetched from a CDN, and the only network request the viewer makes is to one
// of Breadboard's own authenticated download routes.
//
// The viewer is deliberately self-contained — orbit/pan/zoom are implemented
// against pointer events rather than pulled from an examples module — so the
// component has no dependency beyond the core library and behaves identically
// in the desktop shell and the browser.
//
// Two callers, one difference in kind. A CAD revision is a known part: its
// millimetre envelope is measured before the file is written, it is authored
// Z-up, and it is drawn in one colour because the shape is the subject. An
// attached file is unknown: nothing is known about its size until it loads,
// its up-axis is whatever its format says, and its own materials are the point.
// The props below name that difference rather than assuming either case.

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { ModelAttachmentFormat } from "@/lib/model-attachments";

export type StandardView = "isometric" | "front" | "rear" | "left" | "right" | "top" | "bottom";

const VIEW_DIRECTIONS: Record<StandardView, [number, number, number]> = {
  isometric: [1, -1, 0.8],
  front: [0, -1, 0],
  rear: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
};

export interface ModelViewerHandle {
  setView(view: StandardView): void;
  resetView(): void;
}

export interface ModelViewerProps {
  /** Authenticated URL for the model file. */
  source: string;
  /** Which loader to use. Defaults to glTF, which is what CAD exports. */
  format?: ModelAttachmentFormat;
  /** Body names to draw. Absent means "all of them". */
  visibleBodies?: string[];
  wireframe?: boolean;
  showGrid?: boolean;
  showBoundingBox?: boolean;
  projection?: "perspective" | "orthographic";
  /**
   * Millimetre envelope, used to size the grid and frame the camera. Omit for a
   * file of unknown size: the scene is then measured from the loaded geometry.
   */
  extent?: { x: number; y: number; z: number };
  /**
   * `cad` paints every body one colour, because the shape is the subject and a
   * generated part has no meaningful materials. `asset` keeps whatever the file
   * was authored with.
   */
  presentation?: "cad" | "asset";
  /**
   * Which axis the file treats as up. The world here is Z-up, so a Y-up file is
   * rotated a quarter turn to stand in it. Formats disagree — glTF and FBX are
   * Y-up, STL and 3MF are Z-up, OBJ says nothing at all — so this is a default
   * the viewer can be told to override rather than a fact about the file.
   */
  upAxis?: "y" | "z";
  /** Unit the grid spacing is labelled in. */
  gridUnit?: string;
  onLoaded?: (bodies: string[]) => void;
  onError?: (message: string) => void;
  handleRef?: React.RefObject<ModelViewerHandle | null>;
}

interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  perspective: THREE.PerspectiveCamera;
  orthographic: THREE.OrthographicCamera;
  target: THREE.Vector3;
  radius: number;
  model: THREE.Object3D | null;
  grid: THREE.Group;
  box: THREE.Box3Helper | null;
  axes: THREE.AxesHelper;
  frame: number;
}

/** Grid spacing that keeps the millimetre scale readable at any part size. */
function gridStep(extent: number): number {
  const target = extent / 12;
  for (const step of [0.5, 1, 2, 5, 10, 20, 25, 50, 100]) {
    if (step >= target) return step;
  }
  return 200;
}

/**
 * Grid spacing for a file in units nobody has named. A CAD part is millimetres
 * and the ladder above suits it; an attached model may be 0.4 across or 40,000,
 * so the step is chosen by decade instead of from a fixed list.
 */
function scaleFreeGridStep(span: number): number {
  const target = span / 12;
  if (!(target > 0) || !Number.isFinite(target)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const multiple of [1, 2, 5]) {
    if (magnitude * multiple >= target) return magnitude * multiple;
  }
  return magnitude * 10;
}

/** Trims float noise out of a step like 0.30000000000000004. */
function gridStepLabel(step: number): string {
  if (!Number.isFinite(step)) return "1";
  return Number(step.toPrecision(3)).toString();
}

/** A bare mesh — STL and PLY carry geometry with no material of its own. */
function meshFromGeometry(geometry: THREE.BufferGeometry): THREE.Object3D {
  const group = new THREE.Group();
  group.add(
    new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0xb9c6bd),
        metalness: 0.05,
        roughness: 0.7,
        side: THREE.DoubleSide,
        // Scanned PLY meshes often carry per-vertex colour and nothing else.
        vertexColors: Boolean(geometry.getAttribute("color")),
      }),
    ),
  );
  return group;
}

/** Points rather than a surface — a scan or a survey has no faces to shade. */
function pointsFromGeometry(geometry: THREE.BufferGeometry): THREE.Object3D {
  const group = new THREE.Group();
  const positions = geometry.getAttribute("position");
  if (!positions) return group;
  const box = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
  const span = box.getSize(new THREE.Vector3()).length();
  group.add(
    new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        // Sized against the cloud itself: a fixed size is invisible on a
        // survey in metres and a solid block on a part in millimetres.
        size: Math.max(span / 400, 1e-6),
        color: new THREE.Color(0x9ec3a6),
        vertexColors: Boolean(geometry.getAttribute("color")),
        sizeAttenuation: true,
      }),
    ),
  );
  return group;
}

/**
 * The loader for one format. Only glTF is imported eagerly — it is what the CAD
 * kernel exports and what most attachments are; the rest arrive with the file
 * that needs them, so a chat that never opens an FBX never pays for its parser.
 *
 * Only `preview: "three"` formats reach here. A STEP file has already been
 * tessellated to glTF by the CAD service and arrives as that.
 */
async function loadModelObject(
  source: string,
  format: ModelAttachmentFormat,
): Promise<THREE.Object3D> {
  switch (format) {
    case "glb":
    case "gltf": {
      const gltf = await new GLTFLoader().loadAsync(source);
      return gltf.scene;
    }
    case "obj": {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      return await new OBJLoader().loadAsync(source);
    }
    case "fbx": {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      return await new FBXLoader().loadAsync(source);
    }
    case "3mf": {
      const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
      return await new ThreeMFLoader().loadAsync(source);
    }
    case "dae": {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
      const collada = await new ColladaLoader().loadAsync(source);
      if (!collada) throw new Error("The Collada document contained no scene");
      return collada.scene;
    }
    case "kmz": {
      const { KMZLoader } = await import("three/examples/jsm/loaders/KMZLoader.js");
      return (await new KMZLoader().loadAsync(source)).scene;
    }
    case "3ds": {
      const { TDSLoader } = await import("three/examples/jsm/loaders/TDSLoader.js");
      return await new TDSLoader().loadAsync(source);
    }
    case "amf": {
      const { AMFLoader } = await import("three/examples/jsm/loaders/AMFLoader.js");
      return await new AMFLoader().loadAsync(source);
    }
    case "wrl": {
      const { VRMLLoader } = await import("three/examples/jsm/loaders/VRMLLoader.js");
      return await new VRMLLoader().loadAsync(source);
    }
    case "usdz": {
      const { USDZLoader } = await import("three/examples/jsm/loaders/USDZLoader.js");
      return await new USDZLoader().loadAsync(source);
    }
    case "lwo": {
      const { LWOLoader } = await import("three/examples/jsm/loaders/LWOLoader.js");
      return (await new LWOLoader().loadAsync(source)).meshes[0] ?? new THREE.Group();
    }
    case "vox": {
      const { VOXLoader } = await import("three/examples/jsm/loaders/VOXLoader.js");
      return (await new VOXLoader().loadAsync(source)).scene;
    }
    case "gcode": {
      const { GCodeLoader } = await import("three/examples/jsm/loaders/GCodeLoader.js");
      return await new GCodeLoader().loadAsync(source);
    }
    case "pdb": {
      const { PDBLoader } = await import("three/examples/jsm/loaders/PDBLoader.js");
      const pdb = await new PDBLoader().loadAsync(source);
      return pointsFromGeometry(pdb.geometryAtoms);
    }
    case "vtk": {
      const { VTKLoader } = await import("three/examples/jsm/loaders/VTKLoader.js");
      return meshFromGeometry(await new VTKLoader().loadAsync(source));
    }
    case "stl": {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      return meshFromGeometry(await new STLLoader().loadAsync(source));
    }
    case "ply": {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const geometry = await new PLYLoader().loadAsync(source);
      // A PLY with no faces is a scan, not a surface.
      return geometry.getIndex() || geometry.getAttribute("normal")
        ? meshFromGeometry(geometry)
        : pointsFromGeometry(geometry);
    }
    case "pcd": {
      const { PCDLoader } = await import("three/examples/jsm/loaders/PCDLoader.js");
      return await new PCDLoader().loadAsync(source);
    }
    case "xyz": {
      const { XYZLoader } = await import("three/examples/jsm/loaders/XYZLoader.js");
      return pointsFromGeometry(await new XYZLoader().loadAsync(source));
    }
    default:
      // A kernel or unrenderable format never reaches the viewer; the card
      // shows its own state instead.
      throw new Error(`No browser loader for .${format}`);
  }
}

/** Every mesh under `root`, with normals and a material it can be lit by. */
function prepareLoadedMeshes(
  root: THREE.Object3D,
  paint: boolean,
): string[] {
  const names: string[] = [];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    names.push(object.name || "body");
    // STL and PLY carry positions only; without normals they light as a
    // silhouette.
    if (!object.geometry.getAttribute("normal")) object.geometry.computeVertexNormals();
    if (paint) {
      object.material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x9ec3a6),
        metalness: 0.06,
        roughness: 0.62,
        side: THREE.DoubleSide,
      });
    }
  });
  return names;
}

/**
 * Re-sizes the scene around a model whose envelope was not known in advance —
 * grid spacing, axis indicator, camera clipping planes and orthographic
 * frustum all follow the part rather than a fixed guess.
 */
function applySceneScale(
  state: SceneRefs,
  extent: { x: number; y: number; z: number },
  aspect: number,
): number {
  // No 10 mm floor here: this path only ever runs for a file in unknown units,
  // where clamping the radius would frame a small model from far too far away.
  const radius = Math.max(1e-6, Math.hypot(extent.x, extent.y, extent.z) / 2);
  state.radius = radius;

  state.scene.remove(state.grid);
  disposeObject(state.grid);
  const grid = buildGrid(extent, { scaleFree: true });
  grid.visible = state.grid.visible;
  state.scene.add(grid);
  state.grid = grid;

  state.scene.remove(state.axes);
  state.axes.dispose();
  const axes = new THREE.AxesHelper(radius * 0.9);
  axes.visible = grid.visible;
  state.scene.add(axes);
  state.axes = axes;

  state.perspective.near = radius / 200;
  state.perspective.far = radius * 60;
  state.perspective.updateProjectionMatrix();
  state.orthographic.near = radius / 200;
  state.orthographic.far = radius * 60;
  state.orthographic.left = -radius * 1.6 * aspect;
  state.orthographic.right = radius * 1.6 * aspect;
  state.orthographic.top = radius * 1.6;
  state.orthographic.bottom = -radius * 1.6;
  state.orthographic.updateProjectionMatrix();

  return grid.userData.step as number;
}

function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const material = object.material;
      if (Array.isArray(material)) {
        material.forEach((item) => materials.add(item));
      } else {
        materials.add(material);
      }
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

function buildGrid(
  extent: { x: number; y: number; z: number },
  options?: { scaleFree?: boolean },
): THREE.Group {
  const group = new THREE.Group();
  const measured = Math.max(extent.x, extent.y) * 1.8;
  // A CAD part is never usefully smaller than a 20 mm grid; a file in unknown
  // units may well be, so its floor is only "not zero".
  const span = options?.scaleFree ? Math.max(measured, 1e-6) : Math.max(20, measured);
  const step = options?.scaleFree ? scaleFreeGridStep(span) : gridStep(span);
  const half = Math.ceil(span / 2 / step) * step;
  const minor: number[] = [];
  const major: number[] = [];
  for (let offset = -half; offset <= half + 1e-9; offset += step) {
    const target = Math.abs(offset) < 1e-9 ? major : minor;
    target.push(-half, offset, 0, half, offset, 0);
    target.push(offset, -half, 0, offset, half, 0);
  }
  const make = (points: number[], color: number, opacity: number) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
  };
  group.add(make(minor, 0x8aa08f, 0.28));
  group.add(make(major, 0x5d7a63, 0.55));
  group.userData.step = step;
  return group;
}

/**
 * The envelope a scene is built at before anything is loaded, for a file whose
 * size is not known in advance. Roughly a hand-sized part, so the first frame is
 * never absurdly zoomed; `applySceneScale` replaces it the moment the real
 * geometry arrives.
 */
const PROVISIONAL_EXTENT = { x: 100, y: 100, z: 100 } as const;

export default function ModelViewer({
  source,
  format = "glb",
  visibleBodies,
  wireframe = false,
  showGrid = true,
  showBoundingBox = false,
  projection = "perspective",
  extent,
  presentation = "cad",
  upAxis = "y",
  gridUnit = "mm",
  onLoaded,
  onError,
  handleRef,
}: ModelViewerProps) {
  // A CAD revision arrives measured; an attached file does not. The scene is
  // built at this provisional size and `applySceneScale` corrects it once the
  // geometry is loaded, so an unknown model is framed from what it turned out
  // to be rather than from a guess that stuck.
  const sceneExtent = extent ?? PROVISIONAL_EXTENT;
  const mountRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<SceneRefs | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [gridLabel, setGridLabel] = useState("");
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;
  }, [onLoaded, onError]);

  const applyView = useCallback((view: StandardView) => {
    const scene = refs.current;
    if (!scene) return;
    const [x, y, z] = VIEW_DIRECTIONS[view];
    const direction = new THREE.Vector3(x, y, z).normalize();
    const distance = scene.radius * (view === "isometric" ? 2.9 : 2.6);
    const up = view === "top" || view === "bottom" ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    for (const camera of [scene.perspective, scene.orthographic]) {
      camera.position.copy(scene.target).addScaledVector(direction, distance);
      camera.up.copy(up);
      camera.lookAt(scene.target);
      camera.updateProjectionMatrix();
    }
  }, []);

  useImperativeHandle(
    handleRef,
    () => ({
      setView: applyView,
      resetView: () => applyView("isometric"),
    }),
    [applyView],
  );

  // --- scene lifetime ---------------------------------------------------
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setStatus("error");
      setMessage("This browser could not open a WebGL context, so the 3D preview is unavailable.");
      onErrorRef.current?.("webgl_unavailable");
      return;
    }
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.setSize(mount.clientWidth || 640, mount.clientHeight || 420);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const radius = Math.max(10, Math.hypot(sceneExtent.x, sceneExtent.y, sceneExtent.z) / 2);
    const aspect = (mount.clientWidth || 640) / (mount.clientHeight || 420);

    const perspective = new THREE.PerspectiveCamera(38, aspect, radius / 200, radius * 60);
    const orthographic = new THREE.OrthographicCamera(
      -radius * 1.6 * aspect,
      radius * 1.6 * aspect,
      radius * 1.6,
      -radius * 1.6,
      radius / 200,
      radius * 60,
    );

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(radius * 2, -radius * 2.5, radius * 3);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.9);
    fill.position.set(-radius * 2, radius * 2, radius);
    scene.add(fill);

    const grid = buildGrid(sceneExtent);
    scene.add(grid);
    setGridLabel(`${gridStepLabel(grid.userData.step as number)} ${gridUnit} grid`);

    const axes = new THREE.AxesHelper(radius * 0.9);
    scene.add(axes);

    refs.current = {
      renderer,
      scene,
      perspective,
      orthographic,
      target: new THREE.Vector3(0, 0, 0),
      radius,
      model: null,
      grid,
      box: null,
      axes,
      frame: 0,
    };
    applyView("isometric");

    // --- orbit / pan / zoom ---------------------------------------------
    const pointers = new Map<number, { x: number; y: number }>();
    let mode: "orbit" | "pan" | null = null;
    let pinch = 0;

    const activeCamera = () =>
      projectionRef.current === "orthographic" ? orthographic : perspective;

    const orbit = (dx: number, dy: number) => {
      const state = refs.current;
      if (!state) return;
      const camera = activeCamera();
      const offset = camera.position.clone().sub(state.target);
      const spherical = new THREE.Spherical().setFromVector3(
        new THREE.Vector3(offset.x, offset.z, -offset.y),
      );
      spherical.theta -= dx * 0.008;
      spherical.phi = Math.max(0.02, Math.min(Math.PI - 0.02, spherical.phi - dy * 0.008));
      const rotated = new THREE.Vector3().setFromSpherical(spherical);
      const next = new THREE.Vector3(rotated.x, -rotated.z, rotated.y);
      for (const item of [perspective, orthographic]) {
        item.position.copy(state.target).add(next);
        item.up.set(0, 0, 1);
        item.lookAt(state.target);
      }
    };

    const pan = (dx: number, dy: number) => {
      const state = refs.current;
      if (!state) return;
      const camera = activeCamera();
      const distance = camera.position.distanceTo(state.target);
      const scale = (distance * 0.0016) / (projectionRef.current === "orthographic" ? 1.6 : 1);
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
      const shift = right.multiplyScalar(-dx * scale).add(up.multiplyScalar(dy * scale));
      state.target.add(shift);
      perspective.position.add(shift);
      orthographic.position.add(shift);
      perspective.lookAt(state.target);
      orthographic.lookAt(state.target);
    };

    const zoom = (delta: number) => {
      const state = refs.current;
      if (!state) return;
      const factor = Math.exp(delta * 0.0016);
      for (const camera of [perspective, orthographic]) {
        const offset = camera.position.clone().sub(state.target);
        const length = Math.max(state.radius * 0.35, Math.min(state.radius * 40, offset.length() * factor));
        camera.position.copy(state.target).addScaledVector(offset.normalize(), length);
      }
      orthographic.zoom = Math.max(
        0.1,
        Math.min(20, orthographic.zoom / factor),
      );
      orthographic.updateProjectionMatrix();
    };

    const onPointerDown = (event: PointerEvent) => {
      renderer.domElement.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) {
        mode = event.button === 2 || event.shiftKey || event.ctrlKey ? "pan" : "orbit";
      } else {
        mode = "pan";
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const previous = pointers.get(event.pointerId);
      if (!previous) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoom((pinch - distance) * 2);
        pinch = distance;
        return;
      }
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      if (mode === "pan") pan(dx, dy);
      else orbit(dx, dy);
    };

    const onPointerUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (!pointers.size) mode = null;
      try {
        renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may already be gone.
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(event.deltaY);
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    const resize = () => {
      const width = mount.clientWidth || 640;
      const height = mount.clientHeight || 420;
      renderer.setSize(width, height, false);
      const ratio = width / height;
      perspective.aspect = ratio;
      perspective.updateProjectionMatrix();
      // Read the live radius: a model of unknown size re-scales the scene once
      // it has loaded, and a resize after that must use the corrected value.
      const half = (refs.current?.radius ?? radius) * 1.6;
      orthographic.left = -half * ratio;
      orthographic.right = half * ratio;
      orthographic.top = half;
      orthographic.bottom = -half;
      orthographic.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    const animate = () => {
      const state = refs.current;
      if (!state) return;
      state.frame = requestAnimationFrame(animate);
      renderer.render(scene, activeCamera());
    };
    animate();

    return () => {
      const state = refs.current;
      if (state) cancelAnimationFrame(state.frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      disposeObject(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.width = 0;
      renderer.domElement.height = 0;
      renderer.domElement.remove();
      refs.current = null;
    };
    // The scene is built once per model; extent changes arrive with a new
    // source, which is what a rebuilt revision is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, sceneExtent.x, sceneExtent.y, sceneExtent.z, applyView]);

  // Keeping the active projection in a ref means the render loop reads the
  // current value without the scene being torn down when the user switches.
  const projectionRef = useRef(projection);
  useEffect(() => {
    projectionRef.current = projection;
  }, [projection]);

  // --- model loading ----------------------------------------------------
  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    let cancelled = false;
    setStatus("loading");
    setMessage("");

    void loadModelObject(source, format)
      .then((group) => {
        if (cancelled || !refs.current) return;
        const current = refs.current;
        if (current.model) {
          current.scene.remove(current.model);
          disposeObject(current.model);
        }
        const names = prepareLoadedMeshes(group, presentation === "cad");

        // The world here is Z-up: the grid lies on XY, the axis indicator says
        // so, and — for CAD — every dimension the user reads is quoted in that
        // frame. A file authored Y-up is turned a quarter turn to stand in it.
        group.rotation.x = upAxis === "y" ? Math.PI / 2 : 0;
        current.scene.add(group);
        current.model = group;

        // Sit the model on the grid, centred, so the first frame is the same
        // composition whatever the file's own origin happened to be.
        const box = new THREE.Box3().setFromObject(group);
        const centre = box.getCenter(new THREE.Vector3());
        group.position.sub(new THREE.Vector3(centre.x, centre.y, box.min.z));
        const size = box.getSize(new THREE.Vector3());
        current.target.set(0, 0, size.z / 2);

        // A file of unknown size was framed at a provisional scale; now that
        // its real envelope is known, the scene is rebuilt around it.
        if (!extent) {
          const mount = mountRef.current;
          const aspect = (mount?.clientWidth || 640) / (mount?.clientHeight || 420);
          const step = applySceneScale(current, { x: size.x, y: size.y, z: size.z }, aspect);
          setGridLabel(`${gridStepLabel(step)} ${gridUnit} grid`);
        }
        applyView("isometric");

        setStatus("ready");
        onLoadedRef.current?.([...new Set(names)]);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          presentation === "cad"
            ? "The 3D preview for this revision could not be loaded."
            : "This 3D file could not be opened. It may be malformed, or it may rely on companion files that were not attached with it.",
        );
        onErrorRef.current?.("preview_load_failed");
      });

    return () => {
      cancelled = true;
    };
    // `extent` is read only to decide whether the scene needs re-measuring; a
    // measured caller passes it alongside the source it belongs to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, format, presentation, upAxis, gridUnit, applyView]);

  // --- display toggles --------------------------------------------------
  useEffect(() => {
    const state = refs.current;
    if (!state?.model) return;
    state.model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      // An attached file brings its own materials, which are not all
      // wireframe-capable — a material without the property is left alone.
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if ("wireframe" in material) {
          (material as THREE.Material & { wireframe: boolean }).wireframe = wireframe;
        }
      }
      const name = object.name || "body";
      object.visible = !visibleBodies || visibleBodies.includes(name);
    });
  }, [wireframe, visibleBodies, status]);

  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    state.grid.visible = showGrid;
    state.axes.visible = showGrid;
  }, [showGrid, status]);

  useEffect(() => {
    const state = refs.current;
    if (!state) return;
    if (state.box) {
      state.scene.remove(state.box);
      state.box = null;
    }
    if (showBoundingBox && state.model) {
      const box = new THREE.Box3().setFromObject(state.model);
      const helper = new THREE.Box3Helper(box, new THREE.Color(0xd08a4a));
      state.scene.add(helper);
      state.box = helper;
    }
  }, [showBoundingBox, status, visibleBodies]);

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />
      {status === "loading" ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-[var(--ink-muted)]">
          Loading the 3D model…
        </p>
      ) : null}
      {status === "error" ? (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[var(--danger)]">
          {message}
        </p>
      ) : null}
      {status === "ready" && showGrid && gridLabel ? (
        <p className="pointer-events-none absolute bottom-2 left-3 text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
          {gridLabel}
        </p>
      ) : null}
    </div>
  );
}
