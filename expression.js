(() => {
  const REGIONS = [
    { id: "frontal", label: "Frontal cortex", x: 202, y: 205 },
    { id: "motor", label: "Motor cortex", x: 326, y: 180 },
    { id: "parietal", label: "Parietal cortex", x: 447, y: 186 },
    { id: "occipital", label: "Occipital cortex", x: 572, y: 220 },
    { id: "temporal", label: "Temporal cortex", x: 361, y: 319 },
    { id: "hippocampus", label: "Hippocampus", x: 397, y: 351 },
  ];

  const DEMO_DATA = [
    ["Demo gene A", [0.84, 0.64, 0.42, 0.28, 0.16, 0.57]],
    ["Demo gene B", [0.24, 0.38, 0.75, 0.63, 0.31, 0.48]],
    ["Demo gene C", [0.33, 0.22, 0.46, 0.78, 0.88, 0.69]],
  ].flatMap(([gene, values]) =>
    REGIONS.map((region, index) => ({
      gene,
      region: region.id,
      expression: values[index],
    }))
  );

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

  const api = { REGIONS, DEMO_DATA, parseCsv, toCsv };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.ExpressionAtlas = api;
})();
