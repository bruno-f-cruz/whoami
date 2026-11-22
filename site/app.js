import {
  FALLBACK_RULES,
  NEW_OWNER,
  parseRegistry,
  renderSubmission,
  repoUrls,
  rulesFromSchema,
  submissionPath,
  submissionUrl,
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
  if (!$("steps").hidden && $("submission-block").textContent !== renderSubmission(entry)) $("steps").hidden = true;
  return errors;
}

function showSteps(entry) {
  $("submit-link").href = submissionUrl(repo, entry);
  $("submission-path").textContent = submissionPath(entry);
  $("fallback-path").textContent = submissionPath(entry);
  $("submission-block").textContent = renderSubmission(entry);
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
  $("copy-submission").addEventListener("click", () =>
    copy($("submission-block").textContent, "submission-block", "copy-submission-done"),
  );
  loadRegistry();
}

init();
