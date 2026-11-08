(() => {
  function createBrainModelFlare(viewer, { duration = 3300, onError = error => console.error(error) } = {}) {
    const mesh = viewer.meshes[0];
    const layer = mesh?.layers[0];
    if (!mesh || !layer || !Number.isFinite(layer.opacity)) {
      throw Error("The brain model needs a loaded surface and motor layer before it can flare.");
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      throw Error("The brain model flare duration must be greater than zero.");
    }

    const baseOpacity = layer.opacity;
    let timeout = null;
    let generation = 0;

    async function setOpacity(opacity) {
      const updated = await viewer.setMeshLayerProperty(mesh.id, 0, "opacity", opacity);
      if (updated === false) throw Error("The brain model motor layer is no longer available.");
      viewer.updateGLVolume();
      viewer.drawScene();
    }

    async function clear() {
      generation++;
      if (timeout !== null) globalThis.clearTimeout(timeout);
      timeout = null;
      await setOpacity(baseOpacity);
    }

    async function flare() {
      const activeGeneration = ++generation;
      if (timeout !== null) globalThis.clearTimeout(timeout);
      timeout = null;
      await setOpacity(1);
      if (activeGeneration !== generation) return;

      timeout = globalThis.setTimeout(() => {
        timeout = null;
        if (activeGeneration === generation) {
          setOpacity(baseOpacity).catch(onError);
        }
      }, duration);
    }

    return { flare, clear };
  }

  const api = { createBrainModelFlare };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BrainModelFlare = api;
})();
