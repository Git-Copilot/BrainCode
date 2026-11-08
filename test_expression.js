const assert = require("node:assert/strict");
const test = require("node:test");
const { DEMO_DATA, REGIONS, parseCsv, toCsv } = require("./expression.js");

test("demo profiles have one normalized value per brain region", () => {
  const genes = [...new Set(DEMO_DATA.map(row => row.gene))];
  assert.equal(genes.length, 3);
  for (const gene of genes) {
    const profile = DEMO_DATA.filter(row => row.gene === gene);
    assert.equal(profile.length, REGIONS.length);
    assert.deepEqual(new Set(profile.map(row => row.region)), new Set(REGIONS.map(region => region.id)));
    assert.ok(profile.every(row => row.expression >= 0 && row.expression <= 1));
  }
});

test("CSV import accepts region IDs, labels, quoted genes, and CRLF rows", () => {
  const rows = parseCsv(
    'gene,region,expression\r\n"GENE, X",frontal,0.75\r\nGENE Y,"Motor cortex",0.4\r\n',
  );
  assert.deepEqual(rows, [
    { gene: "GENE, X", region: "frontal", expression: 0.75 },
    { gene: "GENE Y", region: "motor", expression: 0.4 },
  ]);
});

test("CSV export round-trips quoted gene names and all expression values", () => {
  const rows = [
    { gene: 'GENE "X"', region: "frontal", expression: 0.75 },
    { gene: "GENE Y", region: "hippocampus", expression: 0 },
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
    () => parseCsv("gene,region,expression\nG,motor,1.1"),
    /normalized number from 0 to 1/,
  );
  assert.throws(
    () => parseCsv("gene,region,expression\nG,motor,0.3\nG,motor,0.8"),
    /duplicates G in motor/,
  );
});
