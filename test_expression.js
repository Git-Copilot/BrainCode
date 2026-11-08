const assert = require("node:assert/strict");
const test = require("node:test");
const ExpressionAtlas = require("./expression.js");
const { REGIONS, mapExpressionToSurface, parseCommand, parseCsv, toCsv } = ExpressionAtlas;

test("the atlas starts without predefined expression profiles", () => {
  assert.equal("DEMO_DATA" in ExpressionAtlas, false);
});

test("functional map defines the six broad M1 regions", () => {
  assert.deepEqual(
    REGIONS.map(region => region.id),
    ["leg_foot", "trunk", "arm", "hand", "face", "tongue"],
  );
});

test("expression values map onto the matching approximate M1 surface zones", () => {
  const vertices = [
    [-10, -15, 40],
    [-28, -15, 40],
    [-37, -15, 40],
    [-45, -15, 40],
    [-53, -15, 40],
    [-61, -15, 40],
    [-37, 20, 40],
    [-37, -15, -10],
  ];
  const profile = new Map([
    ["leg_foot", 0.1],
    ["trunk", 0.2],
    ["arm", 0.3],
    ["hand", 0.4],
    ["face", 0.5],
    ["tongue", 0.6],
  ]);
  const { values, hasExpression } = mapExpressionToSurface(vertices.flat(), profile);
  assert.deepEqual([...values].map(value => Number(value.toFixed(5))), [
    0.1, 0.2, 0.3, 0.4, 0.5, 0.6, -1, -1,
  ]);
  assert.equal(hasExpression, true);
});

test("zero and missing expression values do not create a lit surface layer", () => {
  const result = mapExpressionToSurface([-37, -15, 40], new Map([["arm", 0]]));
  assert.equal(result.values[0], 0);
  assert.equal(result.hasExpression, false);
  assert.throws(() => mapExpressionToSurface([1, 2], new Map()), /x, y, z/);
});

test("CSV import accepts mapped body regions, quoted genes, and CRLF rows", () => {
  const rows = parseCsv(
    'gene,region,expression\r\n"GENE, X",leg_foot,0.75\r\nGENE Y,"Hand / fingers",0.4\r\n',
  );
  assert.deepEqual(rows, [
    { gene: "GENE, X", region: "leg_foot", expression: 0.75 },
    { gene: "GENE Y", region: "hand", expression: 0.4 },
  ]);
});

test("CSV export round-trips quoted gene names and all expression values", () => {
  const rows = [
    { gene: 'GENE "X"', region: "leg_foot", expression: 0.75 },
    { gene: "GENE Y", region: "tongue", expression: 0 },
  ];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test("CSV parser rejects missing headers, unknown regions, and invalid values", () => {
  assert.throws(() => parseCsv("gene,expression\nG,0.5"), /missing the required "region"/);
  assert.throws(
    () => parseCsv("gene,region,expression\nG,cerebellum,0.5"),
    /unsupported brain region/,
  );
  assert.throws(
    () => parseCsv("gene,region,expression\nG,hand,1.1"),
    /normalized number from 0 to 1/,
  );
  assert.throws(
    () => parseCsv("gene,region,expression\nG,hand,0.3\nG,hand,0.8"),
    /duplicates G in hand/,
  );
});

test("movement commands map to the corresponding M1 body-map regions", () => {
  assert.deepEqual(parseCommand("move left hand"), { action: "flare", regions: ["hand"] });
  assert.deepEqual(parseCommand("walk"), { action: "flare", regions: ["leg_foot"] });
  assert.deepEqual(parseCommand("reach"), { action: "flare", regions: ["arm", "hand"] });
  assert.deepEqual(parseCommand("speak"), { action: "flare", regions: ["face", "tongue"] });
  assert.deepEqual(parseCommand("move trunk"), { action: "flare", regions: ["trunk"] });
});

test("command parser supports stopping and rejects unrecognized instructions", () => {
  assert.deepEqual(parseCommand("clear"), { action: "clear", regions: [] });
  assert.throws(() => parseCommand("launch a rocket"), /Command not recognized/);
  assert.throws(() => parseCommand("x".repeat(121)), /short action/);
});
