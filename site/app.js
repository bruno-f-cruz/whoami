import {
  FALLBACK_RULES,
  NEW_OWNER,
  insertionPoint,
  ownerInsertionPoint,
  parseRegistry,
  renderOwnerBlock,
  renderPrBody,
  renderYamlBlock,
  repoUrls,
  rulesFromSchema,
  suggestWhoAmI,
  targetRepo,
  validateEntry,
} from "./lib.js";

const FIELDS = [
  "whoami", "name", "description", "owner", "newOwnerAuthors", "newOwnerKey",
  "repositoryUrl", "projectUrl", "appPackage",
];
const $ = (id) => document.getElementById(id);

const repo = targetRepo(window.location);
const urls = repoUrls(repo);
const state = { rules: FALLBACK_RULES, registry: null, touched: new Set(), keyEdited: false };

function setLinks() {
  $("repo-link").href = urls.repo;
  $("repo-link").textContent = repo;
  $("readme-link").href = `${urls.repo}#readme`;
  $("table-link").href = "../";
  $("edit-link").href = urls.edit;
}

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function fillOwners() {
  const select = $("owner");
  const newOption = select.querySelector(`option[value="${NEW_OWNER}"]`);
  const owners = [...state.registry.owners].sort((a, b) => String(a[1].authors).localeCompare(String(b[1].authors)));
  for (const [key, owner] of owners) {
    const option = new Option(owner.authors || key, key);
    select.insertBefore(option, newOption);
  }
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
    status.textContent = `Registry loaded: ${state.registry.devices.size} devices.`;
    status.className = "status ok";
    fillOwners();
    if (!$("whoami").value) $("whoami").value = String(suggestWhoAmI(state.registry) ?? "");
  } else {
    status.textContent =
      "Could not load the current registry, so WhoAmI, name and owner conflicts are not checked here. The pull request check will still catch them.";
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

function suggestOwnerKey() {
  if (state.keyEdited) return;
  $("newOwnerKey").value = $("newOwnerAuthors").value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+|-+$/g, "");
}

function refresh() {
  const entry = readEntry();
  $("new-owner").hidden = entry.owner !== NEW_OWNER;
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

function code(text) {
  const el = document.createElement("code");
  el.textContent = text;
  return el;
}

function where(target, parts) {
  target.replaceChildren(...parts.map((p) => (typeof p === "string" ? document.createTextNode(p) : p)));
}

function showSteps(entry) {
  const ownerBlock = renderOwnerBlock(entry);
  $("owner-step").hidden = !ownerBlock;
  $("owner-block").textContent = ownerBlock;
  const find = "Press Ctrl+F (⌘+F on macOS) in the editor to find the line ";
  const known = Boolean(state.registry);
  if (ownerBlock) {
    const next = known ? ownerInsertionPoint(state.registry, entry.newOwnerKey.trim()) : null;
    let parts;
    if (!known) parts = ["Paste it in the ", code("owners:"), " section, keeping owners in alphabetical order by key."];
    else if (next) parts = [find, code(`${next}: &${next}`), ", put the cursor at the start of that line, and paste. Owners stay in alphabetical order."];
    else parts = ["Paste it at the end of the ", code("owners:"), " section, just above the empty line before ", code("devices:"), "."];
    where($("owner-where"), parts);
  }
  const next = known ? insertionPoint(state.registry, entry.whoami) : null;
  let parts;
  if (!known) parts = ["Paste it so devices stay in ascending WhoAmI order: just above the first entry with a higher WhoAmI, or at the end of the file."];
  else if (next) parts = [find, code(`${next}:`), ", put the cursor at the start of that line, and paste. Devices stay in ascending WhoAmI order."];
  else parts = ["Press Ctrl+End (⌘+↓ on macOS) to jump to the end of the file. Make sure the cursor is at the start of an empty line, then paste."];
  where($("device-where"), parts);
  $("yaml-block").textContent = renderYamlBlock(entry);
  $("steps").hidden = false;
  $("steps").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copy(text, sourceId, doneId) {
  const done = $(doneId);
  try {
    await navigator.clipboard.writeText(text);
    done.textContent = "Copied.";
  } catch {
    const range = document.createRange();
    range.selectNodeContents($(sourceId));
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
  showSteps(readEntry());
}

function init() {
  setLinks();
  for (const f of FIELDS) {
    const touch = () => {
      state.touched.add(f);
      if (f === "newOwnerAuthors") suggestOwnerKey();
      if (f === "newOwnerKey") state.keyEdited = $(f).value !== "";
      refresh();
    };
    $(f).addEventListener("input", touch);
    $(f).addEventListener("change", touch);
    $(f).addEventListener("blur", touch);
  }
  $("device-form").addEventListener("submit", onSubmit);
  $("copy-owner").addEventListener("click", () => copy($("owner-block").textContent, "owner-block", "copy-owner-done"));
  $("copy-yaml").addEventListener("click", () => copy($("yaml-block").textContent, "yaml-block", "copy-yaml-done"));
  $("copy-pr").addEventListener("click", () => {
    const entry = readEntry();
    const text = renderPrBody(entry, state.registry, entry.description);
    navigator.clipboard.writeText(text).then(
      () => ($("copy-pr-done").textContent = "Copied."),
      () => ($("copy-pr-done").textContent = "Copy failed. Write the description by hand."),
    );
  });
  loadRegistry();
}

init();
