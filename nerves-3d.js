(() => {
  const canvas = document.querySelector("#nerve-model");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const vertices = [];
  const faces = [];
  const paths = [];
  const palette = {
    body: [83, 106, 143],
    central: [120, 225, 192],
    peripheral: [240, 185, 112],
    fine: [248, 207, 142],
  };
  const point = (x, y, z) => [x, y, z];

  function addEllipsoid(center, radii, material, latitudes = 12, longitudes = 20) {
    const first = vertices.length;
    for (let lat = 0; lat <= latitudes; lat++) {
      const phi = Math.PI * lat / latitudes;
      for (let lon = 0; lon <= longitudes; lon++) {
        const theta = Math.PI * 2 * lon / longitudes;
        vertices.push([
          center[0] + radii[0] * Math.sin(phi) * Math.cos(theta),
          center[1] + radii[1] * Math.cos(phi),
          center[2] + radii[2] * Math.sin(phi) * Math.sin(theta),
        ]);
      }
    }
    const row = longitudes + 1;
    for (let lat = 0; lat < latitudes; lat++) {
      for (let lon = 0; lon < longitudes; lon++) {
        const a = first + lat * row + lon;
        const b = a + row;
        faces.push({ a, b, c: a + 1, material }, { a: a + 1, b, c: b + 1, material });
      }
    }
  }

  function addTube(points, radius, material, sides = 7) {
    if (material !== "body") {
      paths.push({ points, radius, color: palette[material] });
    }
    for (let index = 0; index < points.length - 1; index++) {
      const start = points[index];
      const end = points[index + 1];
      const direction = [
        end[0] - start[0],
        end[1] - start[1],
        end[2] - start[2],
      ];
      const length = Math.hypot(...direction);
      if (length < 0.001) continue;
      const axis = direction.map(value => value / length);
      const reference = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const cross = [
        axis[1] * reference[2] - axis[2] * reference[1],
        axis[2] * reference[0] - axis[0] * reference[2],
        axis[0] * reference[1] - axis[1] * reference[0],
      ];
      const crossLength = Math.hypot(...cross);
      const u = cross.map(value => value / crossLength);
      const v = [
        axis[1] * u[2] - axis[2] * u[1],
        axis[2] * u[0] - axis[0] * u[2],
        axis[0] * u[1] - axis[1] * u[0],
      ];
      const first = vertices.length;
      for (const center of [start, end]) {
        for (let side = 0; side < sides; side++) {
          const angle = side * Math.PI * 2 / sides;
          vertices.push(center.map((value, dimension) =>
            value + radius * (u[dimension] * Math.cos(angle) + v[dimension] * Math.sin(angle))
          ));
        }
      }
      for (let side = 0; side < sides; side++) {
        const next = (side + 1) % sides;
        faces.push(
          { a: first + side, b: first + next, c: first + sides + side, material },
          { a: first + next, b: first + sides + next, c: first + sides + side, material },
        );
      }
    }
  }

  function addLimb(start, end, radius, material = "body") {
    addTube([start, end], radius, material, 12);
    addEllipsoid(start, [radius, radius, radius], material, 7, 12);
    addEllipsoid(end, [radius, radius, radius], material, 7, 12);
  }

  function mirroredPath(side, coords, material, radius) {
    addTube(coords.map(([x, y, z]) => point(side * x, y, z)), radius, material);
  }

  function createModel() {
    addEllipsoid(point(0, 1.28, 0), [0.83, 1.27, 0.44], "body", 18, 24);
    addEllipsoid(point(0, -0.34, 0), [0.64, 0.67, 0.39], "body", 14, 22);
    addLimb(point(0, 2.28, 0), point(0, 2.86, 0), 0.22);
    addEllipsoid(point(0, 3.36, 0), [0.39, 0.49, 0.34], "body", 16, 22);

    for (const side of [-1, 1]) {
      addLimb(point(side * 0.72, 1.94, 0), point(side * 1.04, 0.78, 0), 0.22);
      addLimb(point(side * 1.04, 0.78, 0), point(side * 1.22, -0.42, 0), 0.16);
      addEllipsoid(point(side * 1.25, -0.58, 0), [0.16, 0.32, 0.14], "body", 8, 12);
      addLimb(point(side * 0.39, -0.72, 0), point(side * 0.53, -2.12, 0), 0.29);
      addLimb(point(side * 0.53, -2.12, 0), point(side * 0.57, -3.72, 0), 0.20);
      addLimb(point(side * 0.57, -3.72, 0), point(side * 0.57, -4.05, 0.16), 0.19);
    }

    addEllipsoid(point(0, 3.37, 0.27), [0.26, 0.34, 0.22], "central", 12, 18);
    addTube([point(0, 3.08, 0.31), point(0, 2.73, 0.38), point(0, 2.38, 0.43),
      point(0, 1.9, 0.47), point(0, 1.42, 0.48), point(0, 0.86, 0.46),
      point(0, 0.3, 0.43), point(0, -0.28, 0.42), point(0, -0.78, 0.39)],
    0.075, "central", 10);

    for (const side of [-1, 1]) {
      mirroredPath(side, [[0.08, 3.53, 0.42], [0.24, 3.58, 0.37], [0.34, 3.69, 0.26]], "fine", 0.026);
      mirroredPath(side, [[0.08, 3.38, 0.48], [0.25, 3.35, 0.45], [0.35, 3.42, 0.32]], "fine", 0.022);
      mirroredPath(side, [[0.1, 3.23, 0.43], [0.22, 3.14, 0.4], [0.26, 3.04, 0.35]], "fine", 0.02);

      mirroredPath(side, [[0.03, 1.72, 0.48], [0.28, 1.76, 0.49], [0.56, 1.83, 0.46],
        [0.76, 1.9, 0.4], [0.93, 1.53, 0.37], [1.01, 1.1, 0.34],
        [1.1, 0.73, 0.31], [1.16, 0.22, 0.28], [1.21, -0.2, 0.23]], "peripheral", 0.042);
      mirroredPath(side, [[0.66, 1.85, 0.45], [0.83, 1.65, 0.43], [0.96, 1.36, 0.39]], "peripheral", 0.034);
      mirroredPath(side, [[0.98, 1.42, 0.4], [0.84, 1.2, 0.42], [0.8, 0.88, 0.4],
        [0.92, 0.57, 0.36], [1.02, 0.27, 0.33]], "fine", 0.026);
      mirroredPath(side, [[1.03, 1.31, 0.38], [1.18, 1.04, 0.35], [1.22, 0.72, 0.33],
        [1.25, 0.25, 0.28], [1.27, -0.3, 0.23]], "fine", 0.024);
      for (let rib = 0; rib < 6; rib++) {
        const y = 1.43 - rib * 0.19;
        mirroredPath(side, [[0.04, y + 0.08, 0.49], [0.3, y + 0.04, 0.49], [0.57, y, 0.46]], "fine", 0.018);
      }

      mirroredPath(side, [[0.05, -0.58, 0.42], [0.22, -0.78, 0.44], [0.34, -1.02, 0.42],
        [0.43, -1.36, 0.38], [0.49, -1.82, 0.34], [0.53, -2.2, 0.3],
        [0.55, -2.55, 0.27], [0.57, -2.98, 0.23], [0.58, -3.48, 0.19],
        [0.58, -3.87, 0.18]], "peripheral", 0.052);
      mirroredPath(side, [[0.3, -1.02, 0.42], [0.49, -1.25, 0.39], [0.56, -1.65, 0.35]], "peripheral", 0.034);
      mirroredPath(side, [[0.54, -2.45, 0.28], [0.42, -2.75, 0.27], [0.4, -3.18, 0.24], [0.4, -3.82, 0.19]], "fine", 0.025);
      mirroredPath(side, [[0.56, -2.43, 0.28], [0.68, -2.76, 0.25], [0.7, -3.2, 0.21], [0.71, -3.82, 0.17]], "fine", 0.024);
    }
  }

  let yaw = 0;
  let pitch = 0.04;
  let zoom = 1;
  let dragging = false;
  let lastPointer = null;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  const cameraDistance = 11;

  function transform(vertex) {
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const x = vertex[0] * cosYaw + vertex[2] * sinYaw;
    const yawZ = -vertex[0] * sinYaw + vertex[2] * cosYaw;
    const cosPitch = Math.cos(pitch);
    const sinPitch = Math.sin(pitch);
    const y = vertex[1] * cosPitch - yawZ * sinPitch;
    const z = vertex[1] * sinPitch + yawZ * cosPitch;
    return [x, y, z];
  }

  function project(vertex) {
    const [x, y, z] = transform(vertex);
    const depth = cameraDistance - z;
    const focalLength = Math.min(width, height) * 1.15 * zoom;
    const scale = focalLength / depth;
    return [width / 2 + x * scale, height * 0.51 - (y + 0.12) * scale, depth];
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = bounds.width;
    height = bounds.height;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    render();
  }

  function render() {
    if (!width || !height) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const background = context.createRadialGradient(width * 0.5, height * 0.36, 12, width * 0.5, height * 0.48, height * 0.75);
    background.addColorStop(0, "#202b3d");
    background.addColorStop(1, "#111724");
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);

    const drawnFaces = [];
    for (const face of faces) {
      const a = project(vertices[face.a]);
      const b = project(vertices[face.b]);
      const c = project(vertices[face.c]);
      const center = (a[2] + b[2] + c[2]) / 3;
      const color = palette[face.material];
      let alpha = face.material === "body" ? 0.12 : face.material === "central" ? 0.98 : face.material === "peripheral" ? 0.96 : 0.9;
      if (face.material === "body") {
        const abx = b[0] - a[0], aby = b[1] - a[1];
        const acx = c[0] - a[0], acy = c[1] - a[1];
        const facing = Math.abs(abx * acy - aby * acx) / Math.max(1, Math.hypot(abx, aby) * Math.hypot(acx, acy));
        alpha *= 0.55 + facing * 0.9;
      }
      drawnFaces.push({ a, b, c, center, color, alpha });
    }
    drawnFaces.sort((left, right) => right.center - left.center);
    for (const face of drawnFaces) {
      context.beginPath();
      context.moveTo(face.a[0], face.a[1]);
      context.lineTo(face.b[0], face.b[1]);
      context.lineTo(face.c[0], face.c[1]);
      context.closePath();
      context.fillStyle = `rgba(${face.color.join(",")},${face.alpha})`;
      context.fill();
    }

    const glowPaths = paths.map(path => ({
      points: path.points.map(project),
      depth: path.points.reduce((sum, vertex) => sum + transform(vertex)[2], 0) / path.points.length,
      color: path.color,
      radius: path.radius,
    })).sort((left, right) => left.depth - right.depth);
    for (const path of glowPaths) {
      if (path.points.length < 2) continue;
      context.beginPath();
      context.moveTo(path.points[0][0], path.points[0][1]);
      for (const projected of path.points.slice(1)) context.lineTo(projected[0], projected[1]);
      context.strokeStyle = `rgba(${path.color.join(",")},0.12)`;
      context.lineWidth = Math.max(1.4, path.radius * Math.min(width, height) * 0.48);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.stroke();
    }

    context.fillStyle = "#aeb9ce";
    context.font = "11px ui-sans-serif, system-ui, sans-serif";
    context.textAlign = "center";
    context.fillText(yaw === 0 ? "FRONT VIEW" : "DRAG TO ORBIT", width / 2, 24);
  }

  createModel();

  const pointerDown = event => {
    dragging = true;
    lastPointer = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
  };
  const pointerMove = event => {
    if (!dragging || !lastPointer) return;
    const dx = event.clientX - lastPointer[0];
    const dy = event.clientY - lastPointer[1];
    yaw += dx * 0.01;
    pitch = Math.max(-1.1, Math.min(1.1, pitch + dy * 0.008));
    lastPointer = [event.clientX, event.clientY];
    render();
  };
  const pointerUp = () => {
    dragging = false;
    lastPointer = null;
  };

  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    zoom = Math.max(0.7, Math.min(1.7, zoom * (event.deltaY < 0 ? 1.08 : 0.92)));
    render();
  }, { passive: false });
  canvas.addEventListener("keydown", event => {
    const rotations = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] };
    if (rotations[event.key]) {
      event.preventDefault();
      yaw += rotations[event.key][0];
      pitch = Math.max(-1.1, Math.min(1.1, pitch + rotations[event.key][1]));
      render();
    } else if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      zoom = Math.max(0.7, Math.min(1.7, zoom * (event.key === "-" ? 0.9 : 1.1)));
      render();
    }
  });

  document.querySelectorAll("[data-model-view]").forEach(button => {
    button.addEventListener("click", () => {
      if (button.dataset.modelView === "front") {
        yaw = 0;
        pitch = 0.04;
      } else if (button.dataset.modelView === "side") {
        yaw = Math.PI / 2;
        pitch = 0.04;
      } else {
        yaw = 0;
        pitch = 0.04;
        zoom = 1;
      }
      render();
    });
  });

  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }
  resize();
})();
