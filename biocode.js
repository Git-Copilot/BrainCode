(() => {
  const NUMBER = "(?:\\d+(?:\\.\\d*)?|\\.\\d+)";

  function parse(source) {
    const lines = [];
    for (const [index, raw] of source.split(/\r?\n/).entries()) {
      if (raw.includes("\t")) throw Error(`Line ${index + 1}: use spaces, not tabs.`);
      const text = raw.split("#", 1)[0].trimEnd();
      if (!text.trim()) continue;
      const indent = text.length - text.trimStart().length;
      lines.push({ line: index + 1, indent, text: text.trim() });
    }
    if (!lines.length || lines[0].indent !== 0) {
      throw Error("Start with: protocol Name:");
    }
    const header = lines[0].text.match(/^protocol ([A-Za-z_]\w*):$/);
    if (!header) throw Error(`Line ${lines[0].line}: expected "protocol Name:".`);

    const containers = {};
    const steps = [];
    let report = null;
    for (let index = 1; index < lines.length; index++) {
      const entry = lines[index];
      if (entry.indent !== 2) {
        throw Error(`Line ${entry.line}: declarations, steps, and report must be indented two spaces.`);
      }
      let match = entry.text.match(new RegExp(
        `^(sample|reagent) ([A-Za-z_]\\w*) volume=(${NUMBER}) (uL|mL)(?: signal=(${NUMBER}))?$`,
      ));
      if (match) {
        const [, kind, name, amountText, unit, signalText] = match;
        if (containers[name]) throw Error(`Line ${entry.line}: "${name}" is already declared.`);
        if (kind === "sample" && signalText === undefined) {
          throw Error(`Line ${entry.line}: samples need a simulated signal from 0 to 1.`);
        }
        const amount = Number(amountText) * (unit === "mL" ? 1000 : 1);
        const signal = signalText === undefined ? 0 : Number(signalText);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw Error(`Line ${entry.line}: volume must be greater than zero.`);
        }
        if (!Number.isFinite(signal) || signal < 0 || signal > 1) {
          throw Error(`Line ${entry.line}: signal must be between 0 and 1.`);
        }
        containers[name] = { kind, volumeUl: amount, signal };
        continue;
      }

      match = entry.text.match(/^step ([A-Za-z_]\w*):$/);
      if (match) {
        const name = match[1];
        if (steps.some(step => step.name === name)) {
          throw Error(`Line ${entry.line}: step "${name}" is already declared.`);
        }
        const commands = [];
        index++;
        while (index < lines.length && lines[index].indent > 2) {
          const commandLine = lines[index];
          if (commandLine.indent !== 4) {
            throw Error(`Line ${commandLine.line}: commands must be indented four spaces.`);
          }
          commands.push(parseCommand(commandLine));
          index++;
        }
        index--;
        if (!commands.length) throw Error(`Line ${entry.line}: step "${name}" is empty.`);
        steps.push({ name, line: entry.line, commands });
        continue;
      }

      match = entry.text.match(/^report ([A-Za-z_]\w*)$/);
      if (match) {
        if (report) throw Error(`Line ${entry.line}: only one report statement is allowed.`);
        report = match[1];
        continue;
      }
      throw Error(`Line ${entry.line}: unrecognized protocol statement "${entry.text}".`);
    }

    if (!Object.values(containers).some(item => item.kind === "sample")) {
      throw Error("Declare at least one sample.");
    }
    if (!Object.values(containers).some(item => item.kind === "reagent")) {
      throw Error("Declare at least one reagent.");
    }
    if (!steps.length) throw Error("Add at least one step.");
    if (!report) throw Error("Add a report statement for a measured value.");

    const measured = new Set();
    for (const step of steps) {
      for (const command of step.commands) {
        if (command.type === "transfer") {
          requireContainer(containers, command.from, command.line);
          requireContainer(containers, command.to, command.line);
          if (command.from === command.to) {
            throw Error(`Line ${command.line}: transfer source and destination must differ.`);
          }
        } else if (command.type === "mix" || command.type === "incubate") {
          requireContainer(containers, command.container, command.line);
        } else if (command.type === "measure") {
          requireContainer(containers, command.container, command.line);
          if (measured.has(command.as)) {
            throw Error(`Line ${command.line}: "${command.as}" is already measured.`);
          }
          measured.add(command.as);
        }
      }
    }
    if (!measured.has(report)) throw Error(`Report "${report}" is not a measured value.`);
    return { name: header[1], containers, steps, report };
  }

  function parseCommand(entry) {
    let match = entry.text.match(new RegExp(
      `^transfer (${NUMBER}) (uL|mL) from ([A-Za-z_]\\w*) to ([A-Za-z_]\\w*)$`,
    ));
    if (match) {
      const amount = Number(match[1]) * (match[2] === "mL" ? 1000 : 1);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw Error(`Line ${entry.line}: transfer volume must be greater than zero.`);
      }
      return { type: "transfer", amount, from: match[3], to: match[4], line: entry.line };
    }
    match = entry.text.match(new RegExp(
      `^mix ([A-Za-z_]\\w*) for (${NUMBER}) (seconds?|minutes?)$`,
    ));
    if (match) {
      const duration = Number(match[2]) * (match[3].startsWith("minute") ? 60 : 1);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw Error(`Line ${entry.line}: mixing time must be greater than zero.`);
      }
      return { type: "mix", container: match[1], duration, line: entry.line };
    }
    match = entry.text.match(new RegExp(
      `^incubate ([A-Za-z_]\\w*) for (${NUMBER}) (seconds?|minutes?) at (${NUMBER}) C$`,
    ));
    if (match) {
      const duration = Number(match[2]) * (match[3].startsWith("minute") ? 60 : 1);
      if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(Number(match[4]))) {
        throw Error(`Line ${entry.line}: incubation time and temperature must be finite; time must be greater than zero.`);
      }
      return {
        type: "incubate",
        container: match[1],
        duration,
        temperature: Number(match[4]),
        line: entry.line,
      };
    }
    match = entry.text.match(/^measure signal of ([A-Za-z_]\w*) as ([A-Za-z_]\w*)$/);
    if (match) return { type: "measure", container: match[1], as: match[2], line: entry.line };
    throw Error(`Line ${entry.line}: unsupported protocol command "${entry.text}".`);
  }

  function requireContainer(containers, name, line) {
    if (!Object.prototype.hasOwnProperty.call(containers, name)) {
      throw Error(`Line ${line}: "${name}" is not a declared sample or reagent.`);
    }
  }

  function format(value, digits = 3) {
    return Number(value.toFixed(digits)).toString();
  }

  function run(program) {
    const containers = Object.fromEntries(
      Object.entries(program.containers).map(([name, value]) => [name, { ...value }]),
    );
    const measurements = {};
    const trace = [`Protocol simulation: ${program.name}`];
    for (const [stepIndex, step] of program.steps.entries()) {
      trace.push(`Step ${stepIndex + 1}: ${step.name}`);
      for (const command of step.commands) {
        if (command.type === "transfer") {
          const source = containers[command.from];
          const target = containers[command.to];
          if (source.volumeUl + 1e-9 < command.amount) {
            throw Error(
              `Line ${command.line}: ${command.from} has ${format(source.volumeUl)} uL; ` +
              `${format(command.amount)} uL requested.`,
            );
          }
          const combinedVolume = target.volumeUl + command.amount;
          if (!Number.isFinite(combinedVolume)) {
            throw Error(`Line ${command.line}: combined volume is outside the simulator's numeric range.`);
          }
          target.signal = (
            target.signal * target.volumeUl + source.signal * command.amount
          ) / combinedVolume;
          source.volumeUl -= command.amount;
          target.volumeUl = combinedVolume;
          trace.push(
            `  Transfer ${format(command.amount)} uL from ${command.from} to ${command.to}.`,
          );
        } else if (command.type === "mix") {
          if (containers[command.container].volumeUl <= 0) {
            throw Error(`Line ${command.line}: cannot mix an empty container.`);
          }
          trace.push(`  Mix ${command.container} for ${format(command.duration)} seconds.`);
        } else if (command.type === "incubate") {
          if (containers[command.container].volumeUl <= 0) {
            throw Error(`Line ${command.line}: cannot incubate an empty container.`);
          }
          trace.push(
            `  Simulate incubation of ${command.container} for ${format(command.duration)} seconds at ${format(command.temperature)} C.`,
          );
        } else {
          if (containers[command.container].volumeUl <= 0) {
            throw Error(`Line ${command.line}: cannot measure an empty container.`);
          }
          measurements[command.as] = containers[command.container].signal;
          trace.push(
            `  Measure simulated signal of ${command.container} as ${command.as} = ${format(measurements[command.as])}.`,
          );
        }
      }
    }
    trace.push(`Report ${program.report}: ${format(measurements[program.report])} (simulated signal).`);
    return { trace, measurements, containers, report: measurements[program.report] };
  }

  const api = { parse, run };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window !== "undefined") window.BioCode = api;
})();
