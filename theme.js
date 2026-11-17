(() => {
  const STORAGE_KEY = "braincode-theme";
  const root = document.documentElement;
  const slot = document.querySelector("#appearance-settings");
  if (!slot) return;

  let theme = "dark";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") theme = saved;
  } catch {
    // Keep the default theme when browser storage is unavailable.
  }
  root.dataset.theme = theme;

  const details = document.createElement("details");
  details.className = "appearance-settings";
  const summary = document.createElement("summary");
  summary.textContent = "Settings";
  const panel = document.createElement("div");
  panel.className = "appearance-panel";
  const label = document.createElement("label");
  label.htmlFor = "appearance-choice";
  label.textContent = "Appearance";
  const select = document.createElement("select");
  select.id = "appearance-choice";
  select.setAttribute("aria-label", "Choose light or dark mode");
  select.add(new Option("Dark", "dark"));
  select.add(new Option("Light", "light"));
  select.value = theme;

  select.addEventListener("change", () => {
    theme = select.value;
    root.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The selected theme remains active for this page.
    }
  });

  panel.append(label, select);
  details.append(summary, panel);
  slot.append(details);
})();
