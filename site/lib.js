// Pure logic for the WhoAmI submission form. No DOM access: tested with `node --test`.
import { load } from "./vendor/js-yaml.esm.js";

export const DEFAULT_REPO = "harp-tech/whoami";
export const NEW_OWNER = "__new__";
export const APP_TYPE = "dotnetTool";
// Offline fallback only: must equal the patterns in whoami.json (asserted by tests).
export const FALLBACK_RULES = {
  whoami: /^[1-9][0-9]{2,3}$/,
  name: /^[a-zA-Z][a-zA-Z0-9_]*$/,
  owner: /^[a-z][a-z0-9-]*$/,
  appPackage: /^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$/,
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
    repo: `https://github.com/${repo}`,
  };
}

export function rulesFromSchema(schema) {
  const defs = schema.$defs || schema.definitions;
  const only = (obj) => new RegExp(Object.keys(obj)[0]);
  return {
    whoami: only(schema.properties.devices.patternProperties),
    name: new RegExp(defs.device.properties.name.pattern),
    owner: only(schema.properties.owners.patternProperties),
    appPackage: new RegExp(defs.packageIdentifier.pattern),
  };
}

/** @returns {{devices: Map<number, object>, owners: Map<string, object>}} */
export function parseRegistry(yamlText) {
  const doc = load(yamlText) || {};
  return {
    devices: new Map(Object.entries(doc.devices || {}).map(([k, v]) => [Number(k), v])),
    owners: new Map(Object.entries(doc.owners || {})),
  };
}

const trimmed = (v) => (typeof v === "string" ? v.trim() : "");
const ownerKeyOf = (entry) => (entry.owner === NEW_OWNER ? trimmed(entry.newOwnerKey) : trimmed(entry.owner));

export function validateEntry(entry, rules, registry) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });

  const whoami = trimmed(entry.whoami);
  if (!whoami) add("whoami", "WhoAmI is required.");
  else if (!rules.whoami.test(whoami)) add("whoami", "WhoAmI must be a whole number from 100 to 9999.");
  else if (registry && registry.devices.has(Number(whoami))) {
    add("whoami", `WhoAmI ${whoami} is already used by ${registry.devices.get(Number(whoami)).name}.`);
  }

  const name = trimmed(entry.name);
  if (!name) add("name", "Device name is required.");
  else if (!rules.name.test(name)) {
    add("name", "Device name must start with a letter and contain only letters, digits and underscores.");
  } else if (registry) {
    for (const [key, dev] of registry.devices) {
      if (typeof dev.name === "string" && dev.name.toLowerCase() === name.toLowerCase()) {
        add("name", `Device name is already used by ${dev.name} (WhoAmI ${key}).`);
        break;
      }
    }
  }

  if (entry.owner === NEW_OWNER) {
    const key = trimmed(entry.newOwnerKey);
    if (!rules.owner.test(key)) {
      add("newOwnerKey", "Owner key must start with a lowercase letter and contain only lowercase letters, digits and hyphens.");
    } else if (registry && registry.owners.has(key)) {
      add("newOwnerKey", `Owner key ${key} already exists. Pick it from the list instead.`);
    }
    const authors = entry.newOwnerAuthors || "";
    if (!authors.trim()) add("newOwnerAuthors", "Organization name is required.");
    else if (/[\r\n]/.test(authors)) add("newOwnerAuthors", "Must be a single line.");
    else if (registry) {
      for (const [k, o] of registry.owners) {
        if (typeof o.authors === "string" && o.authors.toLowerCase() === authors.trim().toLowerCase()) {
          add("newOwnerAuthors", `${o.authors} is already listed as owner ${k}. Pick it from the list instead.`);
          break;
        }
      }
    }
  } else if (trimmed(entry.owner) && registry && !registry.owners.has(trimmed(entry.owner))) {
    add("owner", "Unknown owner.");
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

  const app = trimmed(entry.appPackage);
  if (app && !rules.appPackage.test(app)) add("appPackage", "Not a valid NuGet package identifier.");
  return errors;
}

export function suggestWhoAmI(registry) {
  const max = Math.max(99, ...registry.devices.keys());
  if (max < 9999) return max + 1;
  for (let i = 100; i <= 9999; i++) if (!registry.devices.has(i)) return i;
  return null;
}

/** The WhoAmI the new entry must be pasted above, or null to paste at the end of the file. */
export function insertionPoint(registry, whoami) {
  const n = Number(whoami);
  const higher = [...registry.devices.keys()].filter((k) => k > n);
  return higher.length ? Math.min(...higher) : null;
}

/** The owner key a new owner must be pasted above, or null to paste at the end of the owners section. */
export function ownerInsertionPoint(registry, key) {
  const after = [...registry.owners.keys()].filter((k) => k > key).sort();
  return after.length ? after[0] : null;
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

export function renderYamlBlock(entry) {
  let out = `  ${trimmed(entry.whoami)}:\n`;
  const owner = ownerKeyOf(entry);
  if (owner) out += `    <<: *${owner}\n`;
  for (const field of ["name", "repositoryUrl", "projectUrl"]) {
    const value = trimmed(entry[field]);
    if (value) out += `    ${field}: ${scalar(value)}\n`;
  }
  const app = trimmed(entry.appPackage);
  if (app) out += `    app:\n      type: ${APP_TYPE}\n      package: ${scalar(app)}\n`;
  return out;
}

export function renderOwnerBlock(entry) {
  if (entry.owner !== NEW_OWNER) return "";
  const key = trimmed(entry.newOwnerKey);
  return `  ${key}: &${key}\n    authors: ${scalar(trimmed(entry.newOwnerAuthors))}\n`;
}

function insertBefore(lines, pattern, block, fallbackIndex) {
  const i = pattern ? lines.findIndex((l) => pattern.test(l)) : -1;
  lines.splice(i >= 0 ? i : fallbackIndex, 0, ...block.replace(/\n$/, "").split("\n"));
}

/** The whole whoami.yml after the contributor's edit: what the pasting instructions produce. */
export function applyEntry(text, entry, registry) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");

  const ownerBlock = renderOwnerBlock(entry);
  if (ownerBlock) {
    const next = ownerInsertionPoint(registry, trimmed(entry.newOwnerKey));
    let end = lines.findIndex((l) => /^devices:/.test(l));
    while (end > 0 && lines[end - 1].trim() === "") end--;
    insertBefore(lines, next ? new RegExp(`^  ${next}:`) : null, ownerBlock, end);
  }
  const next = insertionPoint(registry, entry.whoami);
  insertBefore(lines, next ? new RegExp(`^  ${next}:`) : null, renderYamlBlock(entry), lines.length);
  return lines.join(eol) + eol;
}

export function renderPrBody(entry, registry, description) {
  const v = (f) => trimmed(entry[f]) || "n/a";
  let owner = "n/a";
  if (entry.owner === NEW_OWNER) owner = `${trimmed(entry.newOwnerAuthors)} (new)`;
  else if (trimmed(entry.owner)) owner = registry?.owners.get(entry.owner)?.authors || entry.owner;
  return [
    "## WhoAmI reservation",
    "",
    `- **WhoAmI:** ${v("whoami")}`,
    `- **Device name:** ${v("name")}`,
    `- **Owner:** ${owner}`,
    `- **Device description:** ${trimmed(description) || "n/a"}`,
    `- **Repository URL:** ${v("repositoryUrl")}`,
    `- **Project URL:** ${v("projectUrl")}`,
    `- **App package:** ${v("appPackage")}`,
    "- **Submitted via form:** yes",
    "",
    "### Checklist",
    "",
    "- [x] The new entry keeps `devices` in ascending WhoAmI order",
    "- [x] No existing entries were changed",
    "- [ ] The \"Validate WhoAmI registry\" check passes",
    "",
  ].join("\n");
}
