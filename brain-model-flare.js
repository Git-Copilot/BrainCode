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
    setVisibility(false);
    let timeout = null;
    let generation = 0;

    function setVisibility(visible) {
      const updated = viewer.setMeshProperty(mesh.id, "visible", visible);
      if (updated === -1) throw Error("The brain model surface is no longer available.");
      viewer.drawScene();
    }

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
      setVisibility(false);
    }

    async function flare() {
      const activeGeneration = ++generation;
      if (timeout !== null) globalThis.clearTimeout(timeout);
      timeout = null;
      setVisibility(true);
      await setOpacity(1);
      if (activeGeneration !== generation) return;

      timeout = globalThis.setTimeout(() => {
        timeout = null;
        if (activeGeneration === generation) {
          setOpacity(baseOpacity)
            .then(() => {
              if (activeGeneration === generation) setVisibility(false);
            })
            .catch(onError);
        }
      }, duration);
    }

    return { flare, clear };
  }

  const api = { createBrainModelFlare };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BrainModelFlare = api;
})();
