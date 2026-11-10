/**
 * Self-contained three.js page rendered in a WebView. It loads the GLB that the
 * backend reconstructed from the scan and talks to React Native via postMessage:
 *   -> RN:  {type:'progress', loaded, total} | {type:'loaded', stats} | {type:'error', message}
 *   <- RN:  window.weldViewer.resetView() / fitToScreen() / toggleWireframe()
 *
 * three.js comes from the jsDelivr CDN (pinned version), so the device needs
 * internet access the first time the viewer opens.
 */
const THREE_VERSION = '0.169.0';

export function buildViewerHtml(modelUrl: string, modelType: string | null): string {
  const cdn = `https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html, body { margin: 0; height: 100%; background: #F4F9FC; overflow: hidden; touch-action: none; }
  canvas { display: block; width: 100%; height: 100%; }
</style>
</head>
<body>
<script type="module">
  const post = (msg) => window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(msg));
  window.addEventListener('error', (e) => post({ type: 'error', message: 'Viewer error: ' + (e.message || 'unknown') }));

  let THREE, OrbitControls, GLTFLoader;
  try {
    THREE = await import('${cdn}/+esm');
    ({ OrbitControls } = await import('${cdn}/examples/jsm/controls/OrbitControls.js/+esm'));
    ({ GLTFLoader } = await import('${cdn}/examples/jsm/loaders/GLTFLoader.js/+esm'));
  } catch (err) {
    post({ type: 'error', message: 'Could not load the 3D viewer library (needs internet access): ' + err });
    throw err;
  }

  const MODEL_URL = ${JSON.stringify(modelUrl)};
  const MODEL_TYPE = ${JSON.stringify(modelType)};

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f7fa);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa3ad, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 2, 1.5);
  scene.add(sun);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.001, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  // One finger rotates; two fingers pinch-zoom and pan.
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  let model = null;
  let homeDirection = new THREE.Vector3(0.6, 0.45, 1).normalize();
  let wireframe = false;
  const grid = new THREE.GridHelper(1, 20, 0xe9a23b, 0xd5dbe3);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  function bounds() {
    const box = new THREE.Box3().setFromObject(model);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { box, sphere };
  }

  function frame(direction) {
    if (!model) return;
    const { sphere } = bounds();
    const radius = Math.max(sphere.radius, 1e-4);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const fitFov = camera.aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * camera.aspect) : fov;
    const dist = (radius / Math.sin(fitFov / 2)) * 1.08;
    camera.near = dist / 100;
    camera.far = dist * 100;
    camera.updateProjectionMatrix();
    camera.position.copy(sphere.center).addScaledVector(direction, dist);
    controls.target.copy(sphere.center);
    controls.minDistance = radius * 0.05;
    controls.maxDistance = dist * 10;
    controls.update();
  }

  window.weldViewer = {
    resetView() { frame(homeDirection); },
    fitToScreen() {
      const dir = camera.position.clone().sub(controls.target).normalize();
      frame(dir.lengthSq() > 0 ? dir : homeDirection);
    },
    toggleWireframe() {
      wireframe = !wireframe;
      model && model.traverse((o) => {
        if (o.isMesh) [].concat(o.material).forEach((m) => { m.wireframe = wireframe; });
      });
      return wireframe;
    },
  };

  function onModel(root) {
      model = root;
      let vertices = 0, triangles = 0, points = 0;
      model.traverse((o) => {
        const g = o.geometry;
        if (!g) return;
        const count = g.attributes.position ? g.attributes.position.count : 0;
        if (o.isPoints) {
          points += count;
          o.material.size = 2;
          o.material.sizeAttenuation = false;
        } else if (o.isMesh) {
          vertices += count;
          triangles += g.index ? g.index.count / 3 : count / 3;
          [].concat(o.material).forEach((m) => { m.side = THREE.DoubleSide; });
        }
      });
      scene.add(model);

      // Sit the grid under the model and scale it to the model's footprint.
      const { box, sphere } = bounds();
      grid.position.set(sphere.center.x, box.min.y, sphere.center.z);
      grid.scale.setScalar(sphere.radius * 3);

      frame(homeDirection);
      const size = box.getSize(new THREE.Vector3());
      post({ type: 'loaded', stats: { vertices, triangles: Math.round(triangles), points, size: [size.x, size.y, size.z], modelType: MODEL_TYPE } });
  }

  // Demo mode only: a T-joint fillet weld built in code, clearly labelled in the app.
  function buildDemoWeld() {
    const group = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a939d, metalness: 0.7, roughness: 0.45 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.2), steel);
    base.position.y = -0.006;
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.012), steel);
    upright.position.y = 0.06;
    group.add(base, upright);
    const beadMat = new THREE.MeshStandardMaterial({ color: 0x8a6f55, metalness: 0.5, roughness: 0.6 });
    for (const z of [0.012, -0.012]) {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const x = -0.15 + (0.3 * i) / 60;
        pts.push(new THREE.Vector3(x, 0.006 + 0.0008 * Math.sin(i * 1.7), z));
      }
      const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.0075, 12, false);
      const bead = new THREE.Mesh(tube, beadMat);
      group.add(bead);
      // Ripples typical of a weld bead.
      for (let i = 0; i < 40; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0068, 0.0012, 6, 16), beadMat);
        ring.position.set(-0.145 + (0.29 * i) / 39, 0.006, z);
        ring.rotation.y = Math.PI / 2;
        group.add(ring);
      }
    }
    return group;
  }

  if (MODEL_URL === 'demo:') {
    onModel(buildDemoWeld());
    controls.autoRotate = true;
    controls.autoRotateSpeed = 2.5;
    renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; });
  } else {
    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => onModel(gltf.scene),
      (e) => post({ type: 'progress', loaded: e.loaded, total: e.total || 0 }),
      (err) => post({ type: 'error', message: 'Could not load model: ' + (err && err.message ? err.message : err) }),
    );
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
</script>
</body>
</html>`;
}
