const assert = require("node:assert/strict");
const test = require("node:test");
const { createBrainModelFlare } = require("./brain-model-flare.js");

function createViewer() {
  const calls = [];
  const viewer = {
    meshes: [{ id: 7, layers: [{ opacity: 0.72 }] }],
    async setMeshLayerProperty(...args) {
      calls.push(args);
      this.meshes[0].layers[0].opacity = args[3];
      return true;
    },
    updateGLVolume() {},
    drawScene() {},
  };
  return { viewer, calls };
}

test("flare brightens the loaded motor layer and restores its original opacity", async () => {
  const { viewer, calls } = createViewer();
  const modelFlare = createBrainModelFlare(viewer, { duration: 10 });

  await modelFlare.flare();
  assert.equal(viewer.meshes[0].layers[0].opacity, 1);
  assert.deepEqual(calls[0], [7, 0, "opacity", 1]);

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(viewer.meshes[0].layers[0].opacity, 0.72);
  assert.deepEqual(calls[1], [7, 0, "opacity", 0.72]);
});

test("clearing a flare restores the layer and cancels its pending reset", async () => {
  const { viewer, calls } = createViewer();
  const modelFlare = createBrainModelFlare(viewer, { duration: 10 });

  await modelFlare.flare();
  await modelFlare.clear();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(viewer.meshes[0].layers[0].opacity, 0.72);
  assert.deepEqual(calls.map(call => call[3]), [1, 0.72]);
});
