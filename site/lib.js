// Pure logic for the WhoAmI submission form. No DOM access: tested with `node --test`.
import { load } from "./vendor/js-yaml.mjs";

export const DEFAULT_REPO = "harp-tech/whoami";
export const FIELD_ORDER = ["name", "authors", "copyright", "repositoryUrl", "projectUrl"];
// Offline fallback only: must equal the patterns in whoami.json (asserted by tests).
export const FALLBACK_RULES = {
  whoami: /^[1-9][0-9]{2,3}$/,
  name: /^[a-zA-Z][a-zA-Z0-9_]*$/,
};

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** owner/repo the form targets: ?repo= override, else <owner>.github.io/<repo>, else DEFAULT_REPO. */
export function targetRepo(loc) {
  const override = new URLSearchParams(loc.search || "").get("repo");
  if (override && REPO_RE.test(override)) return override;
  const host = /^([A-Za-z0-9-]+)\.github\.io$/i.exec(loc.hostname || "");
  const repo = (loc.pathname || "").split("/")[1];
  if (host && repo && REPO_RE.test(`${host[1]}/${repo}`)) return `${host[1]}/${repo}`;
  return DEFAULT_REPO;
}

export function repoUrls(repo) {
  return {
    registry: `https://raw.githubusercontent.com/${repo}/main/whoami.yml`,
    schema: `https://raw.githubusercontent.com/${repo}/main/whoami.json`,
    edit: `https://github.com/${repo}/edit/main/whoami.yml`,
    table: `https://github.com/${repo}/blob/main/whoami.md`,
  };
}

export function rulesFromSchema(schema) {
  const keyPatterns = Object.keys(schema.properties.devices.patternProperties);
  return {
    whoami: new RegExp(keyPatterns[0]),
    name: new RegExp(schema.definitions.device.properties.name.pattern),
  };
}

export function parseRegistry(yamlText) {
  const doc = load(yamlText);
  const devices = (doc && doc.devices) || {};
  return new Map(Object.entries(devices).map(([k, v]) => [Number(k), v]));
}

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");

export function validateEntry(entry, rules, registry) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  const whoami = trimmed(entry.whoami);
  if (!whoami) add("whoami", "WhoAmI is required.");
  else if (!rules.whoami.test(whoami)) add("whoami", "WhoAmI must be a whole number from 100 to 9999.");
  else if (registry && registry.has(Number(whoami))) {
    add("whoami", `WhoAmI ${whoami} is already used by ${registry.get(Number(whoami)).name}.`);
  }

  const name = trimmed(entry.name);
  if (!name) add("name", "Device name is required.");
  else if (!rules.name.test(name)) {
    add("name", "Device name must start with a letter and contain only letters, digits and underscores.");
  } else if (registry) {
    for (const [key, dev] of registry) {
      if (typeof dev.name === "string" && dev.name.toLowerCase() === name.toLowerCase()) {
        add("name", `Device name is already used by ${dev.name} (WhoAmI ${key}).`);
        break;
      }
    }
  }

  for (const field of ["authors", "copyright"]) {
    if (/[\r\n]/.test(entry[field] || "")) add(field, "Must be a single line.");
  }
  for (const field of ["repositoryUrl", "projectUrl"]) {
    const url = trimmed(entry[field]);
    if (!url) continue;
    let ok = url.startsWith("https://");
    try {
      new URL(url);
    } catch {
      ok = false;
    }
    if (!ok) add(field, "Must be a full https:// URL.");
  }
  return errors;
}

export function suggestWhoAmI(registry) {
  const max = Math.max(99, ...registry.keys());
  if (max < 9999) return max + 1;
  for (let i = 100; i <= 9999; i++) if (!registry.has(i)) return i;
  return null;
}

// Words YAML 1.1 (PyYAML) or 1.2 would not read back as the same string.
const RESERVED = /^(y|n|yes|no|on|off|true|false|null|~)$/i;
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9 _./:-]*$/;
const NUMBERISH = /^[-+]?[0-9][0-9_.:eE+-]*$/;

function scalar(value) {
  const plain =
    PLAIN.test(value) &&
    !value.includes(": ") &&
    !value.endsWith(":") &&
    !value.endsWith(" ") &&
    !RESERVED.test(value) &&
    !NUMBERISH.test(value);
  return plain ? value : JSON.stringify(value);
}

/** YAML block to append to whoami.yml. Starts with a newline because the file may not end with one. */
export function renderYamlBlock(entry) {
  let out = `\n  ${trimmed(entry.whoami)}:\n`;
  for (const field of FIELD_ORDER) {
    const value = trimmed(entry[field]);
    if (value) out += `    ${field}: ${scalar(value)}\n`;
  }
  return out;
}

export function renderPrBody(entry, description) {
  const v = (f) => trimmed(entry[f]) || "n/a";
  return [
    "## WhoAmI reservation",
    "",
    `- **WhoAmI:** ${v("whoami")}`,
    `- **Device name:** ${v("name")}`,
    `- **Device description:** ${trimmed(description) || "n/a"}`,
    `- **Repository URL:** ${v("repositoryUrl")}`,
    `- **Project URL:** ${v("projectUrl")}`,
    "- **Submitted via form:** yes",
    "",
    "### Checklist",
    "",
    "- [x] The new entry is appended at the end of `whoami.yml`",
    "- [x] No existing entries were changed",
    "- [ ] The \"Validate WhoAmI registry\" check passes",
    "",
  ].join("\n");
}
