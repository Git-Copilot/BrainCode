(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.BrainCodeBrowser = api;
  }
})(globalThis, function () {
  "use strict";

  const MAX_SOURCE_LENGTH = 100_000;
  const MAX_PROGRAM_LINES = 5_000;
  const MAX_NESTING_DEPTH = 128;
  const MAX_EXPRESSION_TOKENS = 1_024;
  const MAX_CHANNELS = 32;
  const MAX_WINDOWS = 256;
  const MAX_WINDOW_SAMPLES = 8192;
  const MAX_WORK = 8_000_000;
  const NUMBER = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  const IDENTIFIER = "[A-Za-z_]\\w*";

  class BrainCodeError extends Error {}

  function stripComment(line) {
    let quote = "";
    let escaped = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\" && quote) {
        escaped = true;
      } else if (character === quote) {
        quote = "";
      } else if (!quote && (character === '"' || character === "'")) {
        quote = character;
      } else if (!quote && character === "#") {
        return line.slice(0, index);
      }
    }
    return line;
  }

  function normalizeLines(source) {
    const lines = [];
    let braceDepth = 0;
    source.split(/\r\n|\r|\n/).forEach((rawLine, index) => {
      if (rawLine.includes("\t")) {
        throw new BrainCodeError(`line ${index + 1}: use spaces, not tabs`);
      }
      const rawIndent = rawLine.length - rawLine.trimStart().length;
      let content = stripComment(rawLine).trim().replace(/;+\s*$/, "").trimEnd();
      if (!content) return;
      while (content.startsWith("}")) {
        braceDepth -= 1;
        if (braceDepth < 0) {
          throw new BrainCodeError(`line ${index + 1}: unexpected closing brace`);
        }
        content = content.slice(1).trimStart();
      }
      if (!content) return;
      if (content.endsWith("{")) {
        content = `${content.slice(0, -1).trimEnd()}:`;
        lines.push([Math.max(rawIndent, 2 * braceDepth), content]);
        braceDepth += 1;
      } else {
        lines.push([Math.max(rawIndent, 2 * braceDepth), content]);
      }
    });
    if (braceDepth) throw new BrainCodeError("unmatched brace block");
    return lines;
  }

  function normalizeExpression(expression) {
    let value = expression
      .replace(/\bfrom\s*[:=]\s*/g, "")
      .replace(/\brate\s*:\s*/g, "rate=");
    if (value.startsWith("(") && value.endsWith(")")) {
      let depth = 0;
      let wrapsAll = true;
      for (let index = 0; index < value.length; index += 1) {
        if (value[index] === "(") depth += 1;
        if (value[index] === ")") {
          depth -= 1;
          if (depth === 0 && index !== value.length - 1) {
            wrapsAll = false;
            break;
          }
        }
      }
      if (wrapsAll && depth === 0) value = value.slice(1, -1);
    }
    return value;
  }

  function parseBlock(lines, start, indent, depth = 0) {
    const statements = [];
    let position = start;
    while (position < lines.length) {
      const [lineIndent, line] = lines[position];
      if (lineIndent < indent) break;
      if (lineIndent > indent) throw new BrainCodeError(`unexpected indentation: ${line}`);
      if (line === "else:" || line.startsWith("elif ")) break;

      const legacy = line.match(/^decide "([^"]+)" when (.+)$/);
      if (legacy) {
        statements.push({
          kind: "if",
          expression: normalizeExpression(legacy[2]),
          body: [{ kind: "decide", value: legacy[1] }],
          otherwise: [],
        });
        position += 1;
        continue;
      }
      if (/^if\s+(.+):$/.test(line)) {
        const parsed = parseConditional(lines, position, indent, depth);
        statements.push(parsed.statement);
        position = parsed.position;
        continue;
      }
      const decision = line.match(/^decide "([^"]+)"$/);
      if (decision) {
        statements.push({ kind: "decide", value: decision[1] });
        position += 1;
        continue;
      }
      const emit = line.match(/^emit "([^"]+)"(?:\s*,\s*(.+))?$/);
      if (emit) {
        statements.push({
          kind: "emit",
          value: emit[1],
          expression: normalizeExpression(emit[2] || "true"),
        });
        position += 1;
        continue;
      }
      const declaration = line.match(new RegExp(`^(?:let|const|var)\\s+(${IDENTIFIER})\\s*=\\s*(.+)$`));
      if (declaration) {
        statements.push({
          kind: "let",
          value: declaration[1],
          expression: normalizeExpression(declaration[2]),
        });
        position += 1;
        continue;
      }
      const assignment = line.match(new RegExp(`^(${IDENTIFIER})\\s*=\\s*(.+)$`));
      if (assignment) {
        statements.push({
          kind: "assign",
          value: assignment[1],
          expression: normalizeExpression(assignment[2]),
        });
        position += 1;
        continue;
      }
      const store = line.match(new RegExp(`^(${IDENTIFIER})\\.store\\((.+)\\)$`));
      if (store) {
        statements.push({
          kind: "store",
          value: store[1],
          expression: normalizeExpression(store[2]),
        });
        position += 1;
        continue;
      }
      throw new BrainCodeError(`invalid statement: ${line}`);
    }
    return { statements, position };
  }

  function parseConditional(lines, position, indent, depth) {
    if (depth > MAX_NESTING_DEPTH) {
      throw new BrainCodeError(`program nesting exceeds ${MAX_NESTING_DEPTH} levels`);
    }
    const condition = lines[position][1].match(/^(?:if|elif)\s+(.+):$/);
    if (!condition) throw new BrainCodeError(`invalid conditional: ${lines[position][1]}`);
    if (position + 1 >= lines.length || lines[position + 1][0] <= indent) {
      throw new BrainCodeError("if block must contain an indented body");
    }
    const body = parseBlock(lines, position + 1, lines[position + 1][0], depth + 1);
    position = body.position;
    let otherwise = [];
    if (position < lines.length && lines[position][0] === indent) {
      const nextLine = lines[position][1];
      if (nextLine.startsWith("elif ")) {
        const nested = parseConditional(lines, position, indent, depth + 1);
        otherwise = [nested.statement];
        position = nested.position;
      } else if (nextLine === "else:") {
        if (position + 1 >= lines.length || lines[position + 1][0] <= indent) {
          throw new BrainCodeError("else block must contain an indented body");
        }
        const alternate = parseBlock(lines, position + 1, lines[position + 1][0], depth + 1);
        otherwise = alternate.statements;
        position = alternate.position;
      }
    }
    return {
      statement: {
        kind: "if",
        expression: normalizeExpression(condition[1]),
        body: body.statements,
        otherwise,
      },
      position,
    };
  }

  function walkStatements(statements) {
    const result = [];
    for (const statement of statements) {
      result.push(statement, ...walkStatements(statement.body || []), ...walkStatements(statement.otherwise || []));
    }
    return result;
  }

  function parseProgram(source) {
    if (typeof source !== "string" || !source.trim()) {
      throw new BrainCodeError("empty BrainCode program");
    }
    if (source.length > MAX_SOURCE_LENGTH) {
      throw new BrainCodeError(`program exceeds the ${MAX_SOURCE_LENGTH}-character limit`);
    }
    const lines = normalizeLines(source);
    if (lines.length > MAX_PROGRAM_LINES) {
      throw new BrainCodeError(`program exceeds the ${MAX_PROGRAM_LINES}-line limit`);
    }
    const keys = ["brain", "input", "memory", "neuron", "state", "sample_rate", "window", "channels"];
    const declarations = Object.fromEntries(keys.map(key => [key, []]));
    let brainIndent = null;
    let handlerIndex = -1;
    let inputName;
    let inputKind;
    let bindingName;

    for (let index = 0; index < lines.length; index += 1) {
      const [indent, line] = lines[index];
      let match = line.match(new RegExp(`^brain (${IDENTIFIER}):$`));
      if (match) {
        if (brainIndent !== null) throw new BrainCodeError("program needs exactly one brain declaration");
        brainIndent = indent;
        declarations.brain.push([match[1]]);
        continue;
      }
      match = line.match(new RegExp(`^on (${IDENTIFIER}) as (${IDENTIFIER}):$`));
      if (match) {
        if (brainIndent === null || indent <= brainIndent) {
          throw new BrainCodeError("input handler must be indented inside the brain block");
        }
        handlerIndex = index;
        inputName = match[1];
        bindingName = match[2];
        break;
      }
      let matched = false;
      const patterns = {
        input: new RegExp(`^input (${IDENTIFIER}): (Signal|EEG)$`),
        memory: new RegExp(`^memory (${IDENTIFIER})\\(capacity\\s*[:=]\\s*(\\d+)\\)$`),
        neuron: new RegExp(`^neuron (${IDENTIFIER})\\(threshold\\s*[:=]\\s*(${NUMBER})\\)$`),
        state: new RegExp(`^state (${IDENTIFIER})\\s*=\\s*(-?${NUMBER})$`),
        sample_rate: /^sample_rate\s+(\d+)\s*Hz$/,
        window: /^window\s+(\d+)\s*samples(?:\s+step\s+(\d+)\s*samples)?$/,
        channels: new RegExp(`^channels\\s+(${IDENTIFIER}(?:\\s*,\\s*${IDENTIFIER})*)$`),
      };
      for (const key of keys.slice(1)) {
        const item = line.match(patterns[key]);
        if (item) {
          if (brainIndent === null || indent <= brainIndent) {
            throw new BrainCodeError(`${key} declaration must be in the indented body of the brain`);
          }
          declarations[key].push(item.slice(1));
          if (key === "input") inputKind = item[2];
          matched = true;
          break;
        }
      }
      if (!matched) throw new BrainCodeError(`invalid BrainCode declaration: ${line}`);
    }

    if (handlerIndex < 0) throw new BrainCodeError("missing input handler");
    if (declarations.brain.length !== 1 || declarations.input.length !== 1) {
      throw new BrainCodeError("program needs exactly one brain and one input declaration");
    }
    if (inputKind === "Signal") {
      if (declarations.memory.length !== 1) throw new BrainCodeError("Signal programs need exactly one memory declaration");
      if (!declarations.neuron.length) throw new BrainCodeError("Signal programs need at least one neuron declaration");
      if (!declarations.state.length) throw new BrainCodeError("Signal programs need at least one state declaration");
      if (["sample_rate", "window", "channels"].some(key => declarations[key].length)) {
        throw new BrainCodeError("EEG declarations require an EEG input");
      }
    } else {
      for (const key of ["sample_rate", "window", "channels"]) {
        if (declarations[key].length !== 1) {
          throw new BrainCodeError(`EEG programs need exactly one ${key.replace("_", " ")} declaration`);
        }
      }
      if (declarations.memory.length > 1) throw new BrainCodeError("EEG programs may declare memory only once");
    }
    const [declaredInput] = declarations.input[0];
    if (inputName !== declaredInput) throw new BrainCodeError("input handler must reference the declared input");

    const memoryDeclaration = declarations.memory[0];
    const memoryName = memoryDeclaration?.[0] || "recent";
    const memoryCapacity = Number(memoryDeclaration?.[1] || 1);
    if (!Number.isSafeInteger(memoryCapacity) || memoryCapacity < 1) {
      throw new BrainCodeError("memory capacity must be at least 1");
    }
    const neurons = new Map();
    for (const [name, rawThreshold] of declarations.neuron) {
      if (neurons.has(name)) throw new BrainCodeError(`duplicate neuron declaration: ${name}`);
      const threshold = Number(rawThreshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        throw new BrainCodeError(`neuron ${name} threshold must be between 0 and 1`);
      }
      neurons.set(name, threshold);
    }
    const states = Object.create(null);
    for (const [name, rawInitial] of declarations.state) {
      if (Object.hasOwn(states, name)) throw new BrainCodeError(`duplicate state declaration: ${name}`);
      const initial = Number(rawInitial);
      if (!Number.isFinite(initial)) throw new BrainCodeError(`state ${name} must be finite`);
      if (inputKind === "Signal" && (initial < 0 || initial > 1)) {
        throw new BrainCodeError(`state ${name} must be between 0 and 1`);
      }
      states[name] = initial;
    }
    if (inputKind === "Signal" && !neurons.size) {
      throw new BrainCodeError("Signal programs need at least one neuron declaration");
    }
    const sampleRate = inputKind === "EEG" ? Number(declarations.sample_rate[0][0]) : null;
    const windowSamples = inputKind === "EEG" ? Number(declarations.window[0][0]) : null;
    const stepSamples = inputKind === "EEG"
      ? Number(declarations.window[0][1] || declarations.window[0][0])
      : null;
    const channels = inputKind === "EEG"
      ? declarations.channels[0][0].split(/\s*,\s*/)
      : [];
    if (inputKind === "EEG") {
      if (sampleRate < 1) throw new BrainCodeError("sample rate must be at least 1 Hz");
      if (windowSamples < 2) throw new BrainCodeError("EEG window must contain at least 2 samples");
      if (windowSamples > MAX_WINDOW_SAMPLES) {
        throw new BrainCodeError(`browser runner supports windows up to ${MAX_WINDOW_SAMPLES} samples; use the local Python CLI for larger windows`);
      }
      if (stepSamples < 1 || stepSamples > windowSamples) {
        throw new BrainCodeError("EEG step must be between 1 and the window size");
      }
      if (new Set(channels).size !== channels.length) throw new BrainCodeError("EEG channel names must be unique");
      if (channels.length > MAX_CHANNELS) throw new BrainCodeError(`browser runner supports at most ${MAX_CHANNELS} EEG channels`);
    }
    const handlerIndent = lines[handlerIndex][0];
    if (handlerIndex + 1 >= lines.length || lines[handlerIndex + 1][0] <= handlerIndent) {
      throw new BrainCodeError("input handler must contain an indented body");
    }
    const body = parseBlock(lines, handlerIndex + 1, lines[handlerIndex + 1][0]);
    if (body.position !== lines.length) {
      throw new BrainCodeError(`unexpected declaration or statement: ${lines[body.position][1]}`);
    }
    for (const statement of walkStatements(body.statements)) {
      if (statement.kind === "store" && statement.value !== memoryName) {
        throw new BrainCodeError(`store must reference declared memory ${memoryName}`);
      }
      if (statement.kind === "store" && !memoryDeclaration) {
        throw new BrainCodeError("memory.store requires a memory declaration");
      }
      if (statement.kind === "assign" && !Object.hasOwn(states, statement.value)) {
        throw new BrainCodeError(`assignment to undeclared state or local: ${statement.value}`);
      }
    }
    return {
      name: declarations.brain[0][0],
      inputName: declaredInput,
      inputKind,
      bindingName,
      memoryName,
      memoryCapacity,
      neurons,
      initialStates: states,
      sampleRate,
      windowSamples,
      stepSamples,
      channels,
      body: body.statements,
    };
  }

  function tokenize(expression) {
    const tokens = [];
    let position = 0;
    const pattern = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|(?:[A-Za-z_]\w*)|(?:==|!=|<=|>=|\/\/|\*\*)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[()+\-*/%,.<> =]/y;
    while (position < expression.length) {
      pattern.lastIndex = position;
      const match = pattern.exec(expression);
      if (!match) throw new BrainCodeError(`invalid expression ${JSON.stringify(expression)}: unexpected character ${expression[position]}`);
      const token = match[0];
      position = pattern.lastIndex;
      if (/^\s+$/.test(token)) continue;
      if (/^(?:\d|\.\d)/.test(token)) {
        const number = Number(token);
        if (!Number.isFinite(number)) throw new BrainCodeError("numeric literals must be finite");
        tokens.push({ type: "number", value: number });
      } else if (token[0] === '"' || token[0] === "'") {
        const quote = token[0];
        let value = "";
        for (let index = 1; index < token.length - 1; index += 1) {
          if (token[index] === "\\" && index + 1 < token.length - 1) {
            index += 1;
            const escaped = token[index];
            value += ({ n: "\n", r: "\r", t: "\t", "\\": "\\", '"': '"', "'": "'" })[escaped] ?? escaped;
          } else {
            value += token[index];
          }
        }
        tokens.push({ type: "string", value });
      } else if (/^[A-Za-z_]/.test(token)) {
        tokens.push({ type: "name", value: token });
      } else {
        tokens.push({ type: "operator", value: token.trim() });
      }
      if (tokens.length > MAX_EXPRESSION_TOKENS) {
        throw new BrainCodeError(`expression exceeds the ${MAX_EXPRESSION_TOKENS}-token limit`);
      }
    }
    tokens.push({ type: "end", value: "" });
    return tokens;
  }

  const PRECEDENCE = {
    or: 1,
    and: 2,
    "==": 3,
    "!=": 3,
    "<": 3,
    "<=": 3,
    ">": 3,
    ">=": 3,
    "+": 4,
    "-": 4,
    "*": 5,
    "/": 5,
    "//": 5,
    "%": 5,
    "**": 6,
  };

  function parseExpression(expression) {
    const tokens = tokenize(normalizeExpression(expression));
    let position = 0;
    let parseDepth = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    const expect = value => {
      if (peek().value !== value) throw new BrainCodeError(`expected ${value} in expression ${JSON.stringify(expression)}`);
      return take();
    };

    function parseArguments() {
      const args = [];
      const keywords = Object.create(null);
      if (peek().value === ")") {
        take();
        return { args, keywords };
      }
      while (peek().type !== "end") {
        if (
          peek().type === "name" &&
          tokens[position + 1]?.value === "="
        ) {
          const name = take().value;
          take();
          if (Object.hasOwn(keywords, name)) throw new BrainCodeError(`duplicate keyword argument: ${name}`);
          keywords[name] = parse(0);
        } else {
          args.push(parse(0));
        }
        if (peek().value === ")") {
          take();
          return { args, keywords };
        }
        expect(",");
        if (peek().value === ")") {
          take();
          return { args, keywords };
        }
      }
      throw new BrainCodeError(`unclosed function call in expression ${JSON.stringify(expression)}`);
    }

    function prefix() {
      const token = take();
      if (token.type === "number" || token.type === "string") {
        return { type: "literal", value: token.value };
      }
      if (token.value === "true" || token.value === "false") {
        return { type: "literal", value: token.value === "true" };
      }
      if (token.type === "name" && token.value === "pi") {
        return { type: "literal", value: Math.PI };
      }
      if ((token.type === "name" && token.value === "not") || ["+", "-"].includes(token.value)) {
        return { type: "unary", operator: token.value, operand: parse(token.value === "not" ? 3 : 6) };
      }
      if (token.value === "(") {
        const node = parse(0);
        expect(")");
        return node;
      }
      if (token.type === "name") return { type: "name", value: token.value };
      throw new BrainCodeError(`unsupported expression element ${token.value || "at end"}`);
    }

    function parse(minimum) {
      parseDepth += 1;
      if (parseDepth > MAX_NESTING_DEPTH) {
        parseDepth -= 1;
        throw new BrainCodeError(`expression nesting exceeds ${MAX_NESTING_DEPTH} levels`);
      }
      try {
        let left = prefix();
        while (true) {
          if (peek().value === ".") {
            if (10 < minimum) break;
            take();
            const method = take();
            if (method.type !== "name" || peek().value !== "(") {
              throw new BrainCodeError("only declared methods may be called in expressions");
            }
            take();
            const call = parseArguments();
            left = { type: "method", owner: left, method: method.value, ...call };
            continue;
          }
          if (peek().value === "(") {
            if (10 < minimum) break;
            if (left.type !== "name") throw new BrainCodeError("unsupported function call");
            take();
            left = { type: "call", name: left.value, ...parseArguments() };
            continue;
          }
          if (peek().value === "if" && minimum === 0) {
            take();
            const condition = parse(0);
            expect("else");
            const fallback = parse(0);
            left = { type: "conditional", condition, value: left, fallback };
            continue;
          }
          const operator = peek().value;
          const precedence = PRECEDENCE[operator];
          if (precedence === undefined || precedence < minimum) break;
          if (precedence === 3) {
            const values = [left];
            const operators = [];
            while (PRECEDENCE[peek().value] === 3) {
              operators.push(take().value);
              values.push(parse(4));
            }
            left = { type: "compare", values, operators };
            continue;
          }
          take();
          const right = parse(precedence + (operator === "**" ? 0 : 1));
          left = { type: "binary", operator, left, right };
        }
        return left;
      } finally {
        parseDepth -= 1;
      }
    }

    const result = parse(0);
    if (peek().type !== "end") throw new BrainCodeError(`unexpected token ${peek().value} in expression ${JSON.stringify(expression)}`);
    return result;
  }

  function finite(value, description = "expression result") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new BrainCodeError(`${description} must be finite`);
    }
    return value;
  }

  function numberValue(value, label) {
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new BrainCodeError(`${label} must be a finite number`);
    }
    return value;
  }

  function minMax(samples) {
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const sample of samples) {
      if (sample < minimum) minimum = sample;
      if (sample > maximum) maximum = sample;
    }
    return { minimum, maximum };
  }

  function mean(samples) {
    const scale = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    return scale === 0 ? 0 : finite(scale * samples.reduce((sum, sample) => sum + sample / scale, 0) / samples.length, "mean feature");
  }

  function rms(samples) {
    const scale = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    if (scale === 0) return 0;
    return finite(scale * Math.sqrt(samples.reduce((sum, sample) => sum + (sample / scale) ** 2, 0) / samples.length), "RMS feature");
  }

  function lineLength(samples) {
    const scale = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    if (scale === 0) return 0;
    const length = samples.slice(1).reduce((sum, sample, index) =>
      sum + Math.abs(sample / scale - samples[index] / scale), 0);
    return finite(scale * length, "line_length feature");
  }

  function peakToPeak(samples) {
    const scale = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    if (scale === 0) return 0;
    const range = minMax(samples.map(sample => sample / scale));
    return finite(scale * (range.maximum - range.minimum), "peak_to_peak feature");
  }

  function powerSpectrum(samples) {
    const size = 2 ** Math.ceil(Math.log2(samples.length));
    const real = new Float64Array(size);
    const imaginary = new Float64Array(size);
    const scale = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
    if (scale === 0) return { powers: new Float64Array(size / 2 + 1), size };
    const normalized = samples.map(sample => sample / scale);
    const average = normalized.reduce((sum, sample) => sum + sample, 0) / normalized.length;
    for (let index = 0; index < samples.length; index += 1) {
      const taper = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (samples.length - 1));
      real[index] = (normalized[index] - average) * taper;
    }
    let reversed = 0;
    for (let index = 1; index < size; index += 1) {
      let bit = size >> 1;
      while (reversed & bit) {
        reversed ^= bit;
        bit >>= 1;
      }
      reversed ^= bit;
      if (index < reversed) {
        [real[index], real[reversed]] = [real[reversed], real[index]];
        [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
      }
    }
    for (let length = 2; length <= size; length *= 2) {
      const angle = -2 * Math.PI / length;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      const half = length / 2;
      for (let start = 0; start < size; start += length) {
        let twiddleReal = 1;
        let twiddleImaginary = 0;
        for (let offset = 0; offset < half; offset += 1) {
          const even = start + offset;
          const odd = even + half;
          const productReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
          const productImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
          real[odd] = real[even] - productReal;
          imaginary[odd] = imaginary[even] - productImaginary;
          real[even] += productReal;
          imaginary[even] += productImaginary;
          [twiddleReal, twiddleImaginary] = [
            twiddleReal * stepReal - twiddleImaginary * stepImaginary,
            twiddleReal * stepImaginary + twiddleImaginary * stepReal,
          ];
        }
      }
    }
    const powers = new Float64Array(size / 2 + 1);
    for (let index = 0; index < powers.length; index += 1) {
      powers[index] = real[index] ** 2 + imaginary[index] ** 2;
    }
    return { powers, size };
  }

  function bandpower(simulation, frame, channel, lowHz, highHz) {
    const samples = channelSamples(simulation, frame, String(channel));
    lowHz = numberValue(lowHz, "bandpower frequency");
    highHz = numberValue(highHz, "bandpower frequency");
    if (lowHz < 0 || highHz <= lowHz || highHz > simulation.program.sampleRate / 2) {
      throw new BrainCodeError(`bandpower range must be within 0..${simulation.program.sampleRate / 2} Hz`);
    }
    if (!simulation.spectrumCache.has(channel)) {
      simulation.spectrumCache.set(channel, powerSpectrum(samples));
    }
    const { powers, size } = simulation.spectrumCache.get(channel);
    const first = Math.max(1, Math.ceil(lowHz * size / simulation.program.sampleRate));
    const last = Math.min(powers.length - 1, Math.floor(highHz * size / simulation.program.sampleRate));
    if (first > last) {
      throw new BrainCodeError("bandpower range has no frequency bins at this sample rate; widen the band or use a longer window");
    }
    let total = powers[0] + powers[powers.length - 1];
    let band = 0;
    for (let index = 1; index < powers.length - 1; index += 1) {
      total += 2 * powers[index];
    }
    for (let index = first; index <= last; index += 1) {
      band += 2 * powers[index];
    }
    if (last === powers.length - 1) band -= powers[last];
    return total === 0 ? 0 : Math.min(1, band / total);
  }

  function channelSamples(simulation, frame, channel) {
    if (simulation.program.inputKind !== "EEG") throw new BrainCodeError("EEG channel features require an EEG input");
    if (frame !== simulation.currentWindow) throw new BrainCodeError("EEG features must use the current input frame");
    if (!simulation.program.channels.includes(channel)) throw new BrainCodeError(`undeclared EEG channel: ${channel}`);
    if (!simulation.currentWindow[channel]) throw new BrainCodeError(`no current window for EEG channel: ${channel}`);
    return simulation.currentWindow[channel];
  }

  function evaluate(node, simulation, variables) {
    switch (node.type) {
      case "literal":
        return node.value;
      case "name":
        if (Object.hasOwn(variables, node.value)) return variables[node.value];
        throw new BrainCodeError(`unknown value: ${node.value}`);
      case "unary": {
        const value = evaluate(node.operand, simulation, variables);
        if (node.operator === "not") return !value;
        const number = numberValue(value, "unary operand");
        return finite(node.operator === "-" ? -number : number);
      }
      case "binary": {
        if (node.operator === "and") {
          return Boolean(evaluate(node.left, simulation, variables) && evaluate(node.right, simulation, variables));
        }
        if (node.operator === "or") {
          return Boolean(evaluate(node.left, simulation, variables) || evaluate(node.right, simulation, variables));
        }
        const left = evaluate(node.left, simulation, variables);
        const right = evaluate(node.right, simulation, variables);
        if (node.operator === "+" && (typeof left === "string" || typeof right === "string")) {
          return String(left) + String(right);
        }
        const a = numberValue(left, "left operand");
        const b = numberValue(right, "right operand");
        if (node.operator === "**" && Math.abs(b) > 1000) {
          throw new BrainCodeError("power exponent must be between -1000 and 1000");
        }
        const operations = {
          "+": () => a + b,
          "-": () => a - b,
          "*": () => a * b,
          "/": () => a / b,
          "//": () => Math.floor(a / b),
          "%": () => a % b,
          "**": () => a ** b,
        };
        return finite(operations[node.operator]());
      }
      case "compare": {
        for (let index = 0; index < node.operators.length; index += 1) {
          const left = evaluate(node.values[index], simulation, variables);
          const right = evaluate(node.values[index + 1], simulation, variables);
          const leftType = typeof left;
          const rightType = typeof right;
          if (!((leftType === rightType && (leftType === "number" || leftType === "string")) ||
                (["number", "boolean"].includes(leftType) && ["number", "boolean"].includes(rightType)))) {
            throw new BrainCodeError("cannot compare values of different types");
          }
          const a = typeof left === "boolean" ? Number(left) : left;
          const b = typeof right === "boolean" ? Number(right) : right;
          const operation = node.operators[index];
          const matched = {
            "==": () => a === b,
            "!=": () => a !== b,
            "<": () => a < b,
            "<=": () => a <= b,
            ">": () => a > b,
            ">=": () => a >= b,
          }[operation]();
          if (!matched) return false;
        }
        return true;
      }
      case "conditional":
        return evaluate(node.condition, simulation, variables)
          ? evaluate(node.value, simulation, variables)
          : evaluate(node.fallback, simulation, variables);
      case "call": {
        const args = node.args.map(argument => evaluate(argument, simulation, variables));
        const keywords = Object.fromEntries(
          Object.entries(node.keywords).map(([name, value]) => [name, evaluate(value, simulation, variables)]),
        );
        if (node.name === "learn") {
          let values = args;
          if (values.length === 2 && Object.hasOwn(keywords, "rate")) values = [...values, keywords.rate];
          if (values.length !== 3 || Object.keys(keywords).some(name => name !== "rate") ||
              (args.length === 3 && Object.hasOwn(keywords, "rate"))) {
            throw new BrainCodeError("learn expects current value, observation, and rate");
          }
          const [current, observation, rate] = values.map(value => numberValue(value, "learn argument"));
          if ([current, observation, rate].some(value => value < 0 || value > 1)) {
            throw new BrainCodeError("learn values and rate must be between 0 and 1");
          }
          return current + rate * (observation - current);
        }
        if (Object.keys(keywords).length) throw new BrainCodeError("keyword arguments are not supported for this function");
        if (["mean", "rms", "line_length", "peak_to_peak", "bandpower"].includes(node.name)) {
          const expected = node.name === "bandpower" ? 4 : 2;
          if (args.length !== expected) throw new BrainCodeError(`${node.name} expects ${expected} arguments`);
          if (node.name === "bandpower") return bandpower(simulation, args[0], args[1], args[2], args[3]);
          const samples = channelSamples(simulation, args[0], String(args[1]));
          return ({
            mean: () => mean(samples),
            rms: () => rms(samples),
            line_length: () => lineLength(samples),
            peak_to_peak: () => peakToPeak(samples),
          })[node.name]();
        }
        const unary = {
          abs: Math.abs,
          sqrt: Math.sqrt,
          log: Math.log,
          log10: Math.log10,
          exp: Math.exp,
          floor: Math.floor,
          ceil: Math.ceil,
        };
        if (Object.hasOwn(unary, node.name)) {
          if (args.length !== 1) throw new BrainCodeError(`${node.name} expects one argument`);
          return finite(unary[node.name](numberValue(args[0], node.name)));
        }
        if (node.name === "min" || node.name === "max") {
          if (!args.length) throw new BrainCodeError(`${node.name} expects at least one argument`);
          return finite(Math[node.name](...args.map(value => numberValue(value, node.name))));
        }
        if (node.name === "round") {
          if (args.length < 1 || args.length > 2) throw new BrainCodeError("round expects one or two arguments");
          const places = args.length === 2 ? Math.trunc(numberValue(args[1], "round places")) : 0;
          const factor = 10 ** places;
          return finite(Math.round(numberValue(args[0], "round value") * factor) / factor);
        }
        if (node.name === "clamp") {
          if (args.length !== 3) throw new BrainCodeError("clamp expects a value, lower bound, and upper bound");
          const [value, lower, upper] = args.map(item => numberValue(item, "clamp argument"));
          if (lower > upper) throw new BrainCodeError("clamp lower bound must not exceed its upper bound");
          return Math.min(Math.max(value, lower), upper);
        }
        throw new BrainCodeError(`unsupported function or method call: ${node.name}`);
      }
      case "method": {
        const args = node.args.map(argument => evaluate(argument, simulation, variables));
        const keywords = Object.keys(node.keywords);
        if (keywords.length) throw new BrainCodeError("keyword arguments are not supported for methods");
        if (node.owner.type !== "name") throw new BrainCodeError("unsupported method owner");
        const owner = node.owner.value;
        if (simulation.program.neurons.has(owner) && node.method === "fire") {
          if (args.length !== 1) throw new BrainCodeError(`${owner}.fire expects one value`);
          const value = numberValue(args[0], "signal");
          if (value < 0 || value > 1) throw new BrainCodeError(`signal must be between 0 and 1, got ${value}`);
          return value >= simulation.program.neurons.get(owner);
        }
        if (owner !== simulation.program.memoryName) throw new BrainCodeError("unsupported function or method call");
        if (args.length) throw new BrainCodeError(`${owner}.${node.method} does not take arguments`);
        const recent = simulation.recent;
        if (node.method === "count") return recent.length;
        if (node.method === "last") return recent.length ? recent[recent.length - 1] : 0;
        if (node.method === "mean" || node.method === "ratio") {
          const average = recent.length
            ? recent.reduce((sum, value) => sum + Number(value), 0) / recent.length
            : 0;
          return node.method === "ratio" ? average > 0.5 : average;
        }
        throw new BrainCodeError(`unknown memory method: ${node.method}`);
      }
      default:
        throw new BrainCodeError(`unsupported expression element: ${node.type}`);
    }
  }

  function execute(statements, simulation, variables, outputs) {
    for (const statement of statements) {
      if (statement.kind === "let" || statement.kind === "assign") {
        const value = evaluate(parseExpression(statement.expression), simulation, variables);
        variables[statement.value] = value;
        if (Object.hasOwn(simulation.states, statement.value)) {
          const number = numberValue(value, "state value");
          if (simulation.program.inputKind === "Signal" && (number < 0 || number > 1)) {
            throw new BrainCodeError("signal state values must be between 0 and 1");
          }
          simulation.states[statement.value] = number;
        }
      } else if (statement.kind === "store") {
        const value = evaluate(parseExpression(statement.expression), simulation, variables);
        if (typeof value !== "number" && typeof value !== "boolean") {
          throw new BrainCodeError("memory.store accepts only numeric or boolean values");
        }
        simulation.recent.push(value);
        simulation.recent.splice(0, Math.max(0, simulation.recent.length - simulation.program.memoryCapacity));
      } else if (statement.kind === "if") {
        const condition = evaluate(parseExpression(statement.expression), simulation, variables);
        execute(condition ? statement.body : statement.otherwise, simulation, variables, outputs);
      } else if (statement.kind === "decide") {
        outputs.push({ type: "decision", label: statement.value });
      } else if (statement.kind === "emit") {
        const value = evaluate(parseExpression(statement.expression), simulation, variables);
        if (!["boolean", "number", "string"].includes(typeof value)) {
          throw new BrainCodeError("emit accepts only scalar values");
        }
        finite(value, "emit value");
        outputs.push({ type: "signal", label: statement.value, value });
      } else {
        throw new BrainCodeError(`unsupported statement: ${statement.kind}`);
      }
    }
  }

  function createSimulation(program) {
    return {
      program,
      states: Object.assign(Object.create(null), program.initialStates),
      recent: [],
      currentWindow: null,
      spectrumCache: new Map(),
    };
  }

  function runInput(simulation, input, index, offset) {
    const { program } = simulation;
    const variables = Object.assign(Object.create(null), simulation.states);
    variables[program.bindingName] = program.inputKind === "EEG" ? input : input;
    variables.signal = program.inputKind === "EEG" ? 0 : input;
    simulation.currentWindow = program.inputKind === "EEG" ? input : null;
    simulation.spectrumCache.clear();
    const outputs = [];
    execute(program.body, simulation, variables, outputs);
    for (const name of Object.keys(simulation.states)) {
      if (Object.hasOwn(variables, name) &&
          (typeof variables[name] === "number" || typeof variables[name] === "boolean")) {
        simulation.states[name] = Number(variables[name]);
        if (!Number.isFinite(simulation.states[name])) throw new BrainCodeError("state values must be finite");
        if (program.inputKind === "Signal" && (simulation.states[name] < 0 || simulation.states[name] > 1)) {
          throw new BrainCodeError("signal state values must be between 0 and 1");
        }
      }
    }
    const result = {
      index,
      decision: outputs.slice().reverse().find(item => item.type === "decision")?.label ?? null,
      outputs,
      states: { ...simulation.states },
    };
    if (offset !== undefined) result.sample_offset = offset;
    return result;
  }

  function runSignal(program, signals) {
    if (!Array.isArray(signals) || signals.length < 1 || signals.length > MAX_WINDOWS) {
      throw new BrainCodeError(`signal input must contain between 1 and ${MAX_WINDOWS} values`);
    }
    const simulation = createSimulation(program);
    const results = signals.map((value, index) => {
      value = numberValue(value, `signal ${index}`);
      if (value < 0 || value > 1) throw new BrainCodeError(`signal must be between 0 and 1, got ${value}`);
      return runInput(simulation, value, index);
    });
    return { program: program.name, input_kind: "Signal", results };
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    let closedQuote = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
          closedQuote = true;
        } else {
          cell += character;
        }
      } else if (character === "," && !quoted) {
        row.push(cell);
        cell = "";
        closedQuote = false;
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(cell);
        if (row.some(value => value.trim() !== "")) rows.push(row);
        row = [];
        cell = "";
        closedQuote = false;
      } else if (character === '"' && cell.trim() === "" && !closedQuote) {
        cell = "";
        quoted = true;
      } else if (closedQuote && character !== " " && character !== "\t") {
        throw new BrainCodeError("invalid CSV: unexpected text after a quoted field");
      } else {
        cell += character;
      }
    }
    if (quoted) throw new BrainCodeError("invalid CSV: unclosed quoted field");
    row.push(cell);
    if (row.some(value => value.trim() !== "")) rows.push(row);
    return rows;
  }

  function parseEegCsv(text, channels) {
    if (typeof text !== "string" || !text.trim()) throw new BrainCodeError("EEG CSV needs a header row and sample rows");
    const rows = parseCsvRows(text.replace(/^\uFEFF/, ""));
    if (rows.length < 2) throw new BrainCodeError("EEG CSV needs at least one sample row");
    const headers = rows[0].map(header => header.trim());
    if (headers.some(header => !header)) throw new BrainCodeError("EEG CSV headers must not be empty");
    if (new Set(headers).size !== headers.length) throw new BrainCodeError("EEG CSV column names must be unique");
    const indexes = Object.fromEntries(channels.map(channel => [channel, headers.indexOf(channel)]));
    const missing = channels.filter(channel => indexes[channel] < 0);
    if (missing.length) throw new BrainCodeError(`EEG CSV is missing channel(s): ${missing.join(", ")}`);
    const samples = Object.fromEntries(channels.map(channel => [channel, []]));
    rows.slice(1).forEach((values, rowIndex) => {
      const line = rowIndex + 2;
      if (values.length > headers.length) throw new BrainCodeError(`EEG CSV line ${line}: too many columns`);
      for (const channel of channels) {
        const raw = values[indexes[channel]]?.trim() || "";
        const value = Number(raw);
        if (!raw || !Number.isFinite(value)) {
          throw new BrainCodeError(`EEG CSV line ${line}: ${channel} must be a finite numeric sample`);
        }
        samples[channel].push(value);
      }
    });
    return samples;
  }

  function runEeg(program, samples) {
    if (!samples || typeof samples !== "object" || Array.isArray(samples)) {
      throw new BrainCodeError("EEG programs require an EEG CSV file");
    }
    const providedChannels = Object.keys(samples);
    if (program.channels.some(channel => !Object.hasOwn(samples, channel))) {
      const missing = program.channels.filter(channel => !Object.hasOwn(samples, channel));
      throw new BrainCodeError(`EEG input is missing channel(s): ${missing.join(", ")}`);
    }
    for (const channel of program.channels) {
      if (!Array.isArray(samples[channel])) {
        throw new BrainCodeError(`EEG channel ${channel} must be an array of samples`);
      }
    }
    const lengths = new Set(program.channels.map(channel => samples[channel].length));
    if (lengths.size !== 1) throw new BrainCodeError("EEG channels must contain the same number of samples");
    const sampleCount = lengths.values().next().value;
    if (sampleCount < program.windowSamples) {
      throw new BrainCodeError(`EEG input needs at least ${program.windowSamples} samples per channel`);
    }
    const windowCount = 1 + Math.floor((sampleCount - program.windowSamples) / program.stepSamples);
    if (windowCount > MAX_WINDOWS) throw new BrainCodeError(`browser runner is limited to ${MAX_WINDOWS} windows`);
    const work = windowCount * program.channels.length * program.windowSamples;
    if (work > MAX_WORK) {
      throw new BrainCodeError(`this recording is too large for the browser runner (${work.toLocaleString()} window-samples); use the local Python CLI`);
    }
    for (const channel of program.channels) {
      if (!Array.isArray(samples[channel]) ||
          samples[channel].some(value => typeof value !== "number" || !Number.isFinite(value))) {
        throw new BrainCodeError(`EEG channel ${channel} contains a non-finite or non-numeric sample`);
      }
    }
    const simulation = createSimulation(program);
    const results = [];
    for (let offset = 0, index = 0; offset + program.windowSamples <= sampleCount; offset += program.stepSamples, index += 1) {
      const window = {};
      for (const channel of program.channels) {
        window[channel] = samples[channel].slice(offset, offset + program.windowSamples);
      }
      results.push(runInput(simulation, window, index, offset));
    }
    return { program: program.name, input_kind: "EEG", results };
  }

  function runProgram(source, options = {}) {
    const program = parseProgram(source);
    if (program.inputKind === "Signal") {
      if (!Array.isArray(options.signals)) throw new BrainCodeError("Signal programs need comma-separated signal values from 0 to 1");
      return runSignal(program, options.signals);
    }
    let samples = options.eegSamples;
    if (!samples && typeof options.csvText === "string") {
      samples = parseEegCsv(options.csvText, program.channels);
    }
    return runEeg(program, samples);
  }

  return { BrainCodeError, parseProgram, parseEegCsv, runProgram };
});
