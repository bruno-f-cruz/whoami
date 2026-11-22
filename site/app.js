import {
  FALLBACK_RULES,
  parseRegistry,
  renderPrBody,
  renderYamlBlock,
  repoUrls,
  rulesFromSchema,
  suggestWhoAmI,
  targetRepo,
  validateEntry,
} from "./lib.js";

const FIELDS = ["whoami", "name", "description", "authors", "copyright", "repositoryUrl", "projectUrl"];
const $ = (id) => document.getElementById(id);

const repo = targetRepo(window.location);
const urls = repoUrls(repo);
const state = { rules: FALLBACK_RULES, registry: null, touched: new Set() };

function setLinks() {
  $("repo-link").href = `https://github.com/${repo}`;
  $("repo-link").textContent = repo;
  $("readme-link").href = `https://github.com/${repo}#readme`;
  $("table-link").href = urls.table;
  $("edit-link").href = urls.edit;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function loadRegistry() {
  const status = $("registry-status");
  const [yml, schema] = await Promise.allSettled([fetchText(urls.registry), fetchText(urls.schema)]);
  if (schema.status === "fulfilled") {
    try {
      state.rules = rulesFromSchema(JSON.parse(schema.value));
    } catch (e) {
      console.warn("Using fallback rules:", e);
    }
  }
  if (yml.status === "fulfilled") {
    try {
      state.registry = parseRegistry(yml.value);
    } catch (e) {
      console.warn("Could not parse registry:", e);
    }
  }
  if (state.registry) {
    status.textContent = `Registry loaded: ${state.registry.size} devices.`;
    status.className = "status ok";
    if (!$("whoami").value) $("whoami").value = String(suggestWhoAmI(state.registry) ?? "");
  } else {
    status.textContent =
      "Could not load the current registry, so WhoAmI and name uniqueness are not checked here. The pull request check will still catch conflicts.";
    status.className = "status warn";
  }
  refresh();
}

function readEntry() {
  return Object.fromEntries(FIELDS.map((f) => [f, $(f).value]));
}

function errorsFor(entry) {
  const errors = validateEntry(entry, state.rules, state.registry);
  if (!entry.description.trim()) errors.push({ field: "description", message: "Please describe the device." });
  return errors;
}

function refresh() {
  const entry = readEntry();
  const errors = errorsFor(entry);
  for (const f of FIELDS) {
    const err = errors.find((e) => e.field === f);
    const show = err && state.touched.has(f);
    $(`${f}-error`).textContent = show ? err.message : "";
    $(f).setAttribute("aria-invalid", show ? "true" : "false");
  }
  $("generate").disabled = errors.length > 0;
  // Any edit after generating invalidates the instructions below.
  if (!$("steps").hidden && $("yaml-block").textContent !== renderYamlBlock(entry)) $("steps").hidden = true;
  return errors;
}

async function copy(text, doneId) {
  const done = $(doneId);
  try {
    await navigator.clipboard.writeText(text);
    done.textContent = "Copied.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("yaml-block"));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    done.textContent = "Press Ctrl+C to copy.";
  }
  setTimeout(() => (done.textContent = ""), 4000);
}

function onSubmit(event) {
  event.preventDefault();
  FIELDS.forEach((f) => state.touched.add(f));
  if (refresh().length) return;
  const entry = readEntry();
  $("yaml-block").textContent = renderYamlBlock(entry);
  $("steps").hidden = false;
  $("steps").scrollIntoView({ behavior: "smooth", block: "start" });
}

function init() {
  setLinks();
  for (const f of FIELDS) {
    $(f).addEventListener("input", () => {
      state.touched.add(f);
      refresh();
    });
    $(f).addEventListener("blur", () => {
      state.touched.add(f);
      refresh();
    });
  }
  $("device-form").addEventListener("submit", onSubmit);
  $("copy-yaml").addEventListener("click", () => copy($("yaml-block").textContent, "copy-yaml-done"));
  $("copy-pr").addEventListener("click", () => {
    const entry = readEntry();
    copy(renderPrBody(entry, entry.description), "copy-pr-done");
  });
  loadRegistry();
}

init();
