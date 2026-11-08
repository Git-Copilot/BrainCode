(() => {
  const REGIONS = [
    { id: "leg_foot", label: "Leg / foot", x: 300, y: 190 },
    { id: "trunk", label: "Trunk", x: 365, y: 195 },
    { id: "arm", label: "Arm", x: 432, y: 211 },
    { id: "hand", label: "Hand / fingers", x: 500, y: 230 },
    { id: "face", label: "Face", x: 565, y: 250 },
    { id: "tongue", label: "Mouth / tongue", x: 632, y: 278 },
  ];

  // Approximate M1 somatotopy zones on the left template surface, not atlas labels.
  const M1_SURFACE_BANDS = [
    { id: "tongue", minX: -65, maxX: -57 },
    { id: "face", minX: -57, maxX: -49 },
    { id: "hand", minX: -49, maxX: -41 },
    { id: "arm", minX: -41, maxX: -33 },
    { id: "trunk", minX: -33, maxX: -24 },
    { id: "leg_foot", minX: -24, maxX: -5 },
  ];

  function mapExpressionToSurface(positions, profile) {
    if (!positions || positions.length % 3 !== 0) {
      throw Error("Surface positions must contain x, y, z coordinates for each vertex.");
    }
    const values = new Float32Array(positions.length / 3);
    values.fill(-1);
    let hasExpression = false;
    for (let vertex = 0; vertex < values.length; vertex++) {
      const offset = vertex * 3;
      const [x, y, z] = [positions[offset], positions[offset + 1], positions[offset + 2]];
      if (y < -40 || y > 15 || z < -5 || z > 80) continue;
      const band = M1_SURFACE_BANDS.find(region => x >= region.minX && x < region.maxX);
      if (!band) continue;
      const value = profile instanceof Map ? profile.get(band.id) : profile?.[band.id];
      if (!Number.isFinite(value) || value < 0 || value > 1) continue;
      values[vertex] = value;
      hasExpression ||= value > 0;
    }
    return { values, hasExpression };
  }

  function parseCommand(input) {
    if (typeof input !== "string" || input.trim().length > 120) {
      throw Error("Enter a short action command.");
    }
    const command = input.trim().toLowerCase().replace(/[.!?]+$/, "").replace(/\s+/g, " ");
    const aliases = {
      leg: "leg_foot",
      legs: "leg_foot",
      foot: "leg_foot",
      feet: "leg_foot",
      walking: "leg_foot",
      walk: "leg_foot",
      step: "leg_foot",
      trunk: "trunk",
      torso: "trunk",
      body: "trunk",
      arm: "arm",
      arms: "arm",
      reaching: "arm",
      reach: "arm",
      hand: "hand",
      hands: "hand",
      finger: "hand",
      fingers: "hand",
      grip: "hand",
      gripping: "hand",
      writing: "hand",
      write: "hand",
      typing: "hand",
      type: "hand",
      face: "face",
      facial: "face",
      smile: "face",
      blinking: "face",
      blink: "face",
      tongue: "tongue",
      mouth: "tongue",
      speaking: "tongue",
      speak: "tongue",
      talking: "tongue",
      talk: "tongue",
      say: "tongue",
    };
    if (["stop", "rest", "clear"].includes(command)) {
      return { action: "clear", regions: [] };
    }

    const parts = command.match(/^(?:(?:move|activate|flare)\s+)?(?:(?:my|your|the|left|right)\s+)*(leg|legs|foot|feet|trunk|torso|body|arm|arms|hand|hands|finger|fingers|face|tongue|mouth)$/);
    if (parts) return { action: "flare", regions: [aliases[parts[1]]] };

    if (["walk", "walking", "step"].includes(command)) {
      return { action: "flare", regions: [aliases[command]] };
    }
    if (["reach", "reaching"].includes(command)) {
      return { action: "flare", regions: ["arm", "hand"] };
    }
    if (["grip", "gripping", "writing", "write", "typing", "type"].includes(command)) {
      return { action: "flare", regions: ["hand"] };
    }
    if (["speak", "speaking", "talk", "talking", "say"].includes(command)) {
      return { action: "flare", regions: ["face", "tongue"] };
    }
    if (["smile", "blink"].includes(command)) {
      return { action: "flare", regions: ["face"] };
    }

    throw Error("Command not recognized. Enter a mapped M1 action or clear the current highlight.");
  }

  function parseCsv(text) {
    if (typeof text !== "string" || text.length > 5_000_000) {
      throw Error("CSV must be text no larger than 5 MB.");
    }
    const records = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"';
          index++;
        } else if (character === '"') {
          quoted = false;
        } else {
          field += character;
        }
      } else if (character === '"' && field.length === 0) {
        quoted = true;
      } else if (character === ",") {
        row.push(field.trim());
        field = "";
      } else if (character === "\n" || character === "\r") {
        row.push(field.trim());
        field = "";
        if (row.some(value => value !== "")) records.push(row);
        row = [];
        if (character === "\r" && text[index + 1] === "\n") index++;
      } else {
        field += character;
      }
    }
    if (quoted) throw Error("CSV contains an unclosed quoted field.");
    row.push(field.trim());
    if (row.some(value => value !== "")) records.push(row);
    if (records.length < 2) throw Error("CSV needs a header and at least one expression row.");

    const headers = records[0].map(value => value.replace(/^\uFEFF/, "").toLowerCase());
    const indexes = Object.fromEntries(headers.map((header, index) => [header, index]));
    for (const header of ["gene", "region", "expression"]) {
      if (!(header in indexes)) throw Error(`CSV is missing the required "${header}" column.`);
    }

    const regionNames = new Map(REGIONS.flatMap(region => [
      [region.id.toLowerCase(), region.id],
      [region.label.toLowerCase(), region.id],
    ]));
    regionNames.set("leg", "leg_foot");
    regionNames.set("foot", "leg_foot");
    regionNames.set("hand", "hand");
    regionNames.set("fingers", "hand");
    regionNames.set("mouth", "tongue");
    if (records.length > 10001) throw Error("CSV may contain at most 10,000 expression rows.");
    const unique = new Set();
    return records.slice(1).map((values, index) => {
      const line = index + 2;
      const gene = values[indexes.gene]?.trim();
      const regionText = values[indexes.region]?.trim().toLowerCase();
      const region = regionNames.get(regionText);
      const expression = Number(values[indexes.expression]);
      if (!gene || gene.length > 80) throw Error(`CSV row ${line} needs a gene name of 1–80 characters.`);
      if (!region) throw Error(`CSV row ${line} has an unsupported brain region.`);
      if (!Number.isFinite(expression) || expression < 0 || expression > 1) {
        throw Error(`CSV row ${line} expression must be a normalized number from 0 to 1.`);
      }
      const key = `${gene}\u0000${region}`;
      if (unique.has(key)) throw Error(`CSV row ${line} duplicates ${gene} in ${region}.`);
      unique.add(key);
      return { gene, region, expression };
    });
  }

  function toCsv(records) {
    const quote = value => {
      const text = String(value);
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    return [
      "gene,region,expression",
      ...records.map(record => [
        quote(record.gene),
        quote(record.region),
        Number(record.expression).toFixed(3),
      ].join(",")),
    ].join("\n");
  }

  const api = { REGIONS, mapExpressionToSurface, parseCsv, toCsv, parseCommand };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ExpressionAtlas = api;
})();
