import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { load } from "./vendor/js-yaml.esm.js";
import {
  FALLBACK_RULES,
  NEW_OWNER,
  applyEntry,
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

const root = new URL("../", import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));
const baseYml = readFileSync(path("tests/fixtures/base.yml"), "utf8");
const schema = JSON.parse(readFileSync(path("whoami.json"), "utf8"));
const registry = parseRegistry(baseYml);
const rules = rulesFromSchema(schema);

const fieldsOf = (errors) => errors.map((e) => e.field).sort();
const entry = (over = {}) => ({ whoami: "2200", name: "Fresh", owner: "", ...over });

test("rulesFromSchema reads patterns", () => {
  assert.ok(rules.whoami.test("1500"));
  assert.ok(!rules.whoami.test("99"));
  assert.ok(!rules.whoami.test("10000"));
  assert.ok(rules.name.test("MyDevice"));
  assert.ok(!rules.name.test("my-device"));
  assert.ok(rules.owner.test("my-lab"));
  assert.ok(!rules.owner.test("MyLab"));
  assert.ok(rules.appPackage.test("Harp.Behavior.App"));
  assert.ok(!rules.appPackage.test("bad package"));
});

test("fallback rules equal schema rules", () => {
  for (const k of Object.keys(FALLBACK_RULES)) assert.equal(FALLBACK_RULES[k].source, rules[k].source, k);
});

test("parseRegistry resolves merge keys and owners", () => {
  assert.equal(registry.devices.size, 48);
  assert.equal(registry.devices.get(1040).authors, "harp-tech");
  assert.equal(registry.owners.get("aind").authors, "Allen Institute");
  assert.deepEqual([...registry.owners.keys()], ["aind", "champalimaud", "harptech", "neurogears", "neurophotometrics"]);
});

test("validateEntry accepts a fresh entry", () => {
  assert.deepEqual(validateEntry(entry({ owner: "aind", appPackage: "Harp.Fresh.App" }), rules, registry), []);
});

test("validateEntry flags taken whoami and duplicate name", () => {
  const errs = validateEntry(entry({ whoami: "1040", name: "HOBGOBLIN" }), rules, registry);
  assert.deepEqual(fieldsOf(errs), ["name", "whoami"]);
  assert.match(errs.find((e) => e.field === "whoami").message, /MultiPwm/);
  assert.match(errs.find((e) => e.field === "name").message, /Hobgoblin/);
});

test("validateEntry without registry skips uniqueness", () => {
  assert.deepEqual(validateEntry(entry({ whoami: "1040", name: "Hobgoblin" }), rules, null), []);
});

test("validateEntry rejects http urls, bad names and bad app package", () => {
  const errs = validateEntry(
    entry({ name: "my-device", repositoryUrl: "http://x.org", projectUrl: "https://ok.org", appPackage: "bad package" }),
    rules,
    registry,
  );
  assert.deepEqual(fieldsOf(errs), ["appPackage", "name", "repositoryUrl"]);
});

test("validateEntry requires whoami and name", () => {
  assert.deepEqual(fieldsOf(validateEntry(entry({ whoami: "", name: "" }), rules, registry)), ["name", "whoami"]);
});

test("validateEntry rejects an unknown owner", () => {
  assert.deepEqual(fieldsOf(validateEntry(entry({ owner: "nobody" }), rules, registry)), ["owner"]);
});

test("validateEntry checks a new owner", () => {
  const ok = entry({ owner: NEW_OWNER, newOwnerKey: "my-lab", newOwnerAuthors: "My Lab" });
  assert.deepEqual(validateEntry(ok, rules, registry), []);
  const taken = entry({ owner: NEW_OWNER, newOwnerKey: "aind", newOwnerAuthors: "allen institute" });
  const errs = validateEntry(taken, rules, registry);
  assert.deepEqual(fieldsOf(errs), ["newOwnerAuthors", "newOwnerKey"]);
  assert.match(errs.find((e) => e.field === "newOwnerAuthors").message, /aind/);
  const bad = entry({ owner: NEW_OWNER, newOwnerKey: "Bad Key", newOwnerAuthors: "a\nb" });
  assert.deepEqual(fieldsOf(validateEntry(bad, rules, registry)), ["newOwnerAuthors", "newOwnerKey"]);
});

test("suggestWhoAmI returns next after max", () => {
  assert.equal(suggestWhoAmI(registry), 2121);
});

test("suggestWhoAmI fills gaps when max is 9999", () => {
  assert.equal(suggestWhoAmI({ devices: new Map([[100, {}], [9999, {}]]), owners: new Map() }), 101);
});

test("insertionPoint returns the next higher WhoAmI or null", () => {
  assert.equal(insertionPoint(registry, "1413"), 2064);
  assert.equal(insertionPoint(registry, "2200"), null);
});

test("ownerInsertionPoint returns the next owner key alphabetically or null", () => {
  assert.equal(ownerInsertionPoint(registry, "bonsai-lab"), "champalimaud");
  assert.equal(ownerInsertionPoint(registry, "zeta"), null);
});

test("renderYamlBlock field order and omission", () => {
  assert.equal(renderYamlBlock(entry({ name: "Foo", repositoryUrl: "" })), "  2200:\n    name: Foo\n");
  assert.equal(
    renderYamlBlock(entry({ projectUrl: "https://p.org", owner: "aind", name: "Foo", repositoryUrl: "https://r.org", appPackage: "Harp.Foo.App" })),
    "  2200:\n    <<: *aind\n    name: Foo\n    repositoryUrl: https://r.org\n    projectUrl: https://p.org\n    app:\n      type: dotnetTool\n      package: Harp.Foo.App\n",
  );
  assert.equal(
    renderYamlBlock(entry({ owner: NEW_OWNER, newOwnerKey: "my-lab", newOwnerAuthors: "My Lab" })),
    "  2200:\n    <<: *my-lab\n    name: Fresh\n",
  );
});

test("renderOwnerBlock only for new owners, with safe quoting", () => {
  assert.equal(renderOwnerBlock(entry({ owner: "aind" })), "");
  assert.equal(
    renderOwnerBlock(entry({ owner: NEW_OWNER, newOwnerKey: "my-lab", newOwnerAuthors: "Smith: Lab #2" })),
    '  my-lab: &my-lab\n    authors: "Smith: Lab #2"\n',
  );
});

test("renders special characters safely", () => {
  for (const v of ["Smith: Lab #2", "yes", "Off", "2024", "null", "Ünïcødé Lab", "O'Brien \"Lab\"", "a: b"]) {
    const block = renderOwnerBlock(entry({ owner: NEW_OWNER, newOwnerKey: "x", newOwnerAuthors: v }));
    assert.equal(load("owners:\n" + block).owners.x.authors, v, v);
  }
});

test("applyEntry keeps devices sorted and owners alphabetical", () => {
  const e = entry({
    whoami: "1413",
    owner: NEW_OWNER,
    newOwnerKey: "bonsai-lab",
    newOwnerAuthors: "Bonsai Lab",
    repositoryUrl: "https://github.com/a/b",
  });
  const after = parseRegistry(applyEntry(baseYml, e, registry));
  assert.equal(after.devices.size, 49);
  assert.deepEqual(after.devices.get(1413), { authors: "Bonsai Lab", name: "Fresh", repositoryUrl: "https://github.com/a/b" });
  assert.deepEqual(
    [...after.owners.keys()],
    ["aind", "bonsai-lab", "champalimaud", "harptech", "neurogears", "neurophotometrics"],
  );
  const keys = [...after.devices.keys()];
  assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  for (const [k, v] of registry.devices) assert.deepEqual(after.devices.get(k), v);
});

test("applyEntry output passes the CI validator", () => {
  const dir = mkdtempSync(join(tmpdir(), "whoami-"));
  const cases = [
    entry({ whoami: "1413", owner: NEW_OWNER, newOwnerKey: "zeta-lab", newOwnerAuthors: "Off" }),
    entry({ whoami: "2200", owner: "aind", appPackage: "Harp.Fresh.App", projectUrl: "https://x.org" }),
  ];
  for (const [i, e] of cases.entries()) {
    const file = join(dir, `case${i}.yml`);
    writeFileSync(file, applyEntry(baseYml, e, registry));
    const out = execFileSync(
      "uv",
      ["run", "-q", path("scripts/validate_whoami.py"), file, "--base", path("tests/fixtures/base.yml"), "--schema", path("whoami.json")],
      { encoding: "utf8" },
    );
    assert.match(out, /OK: 49 devices/);
  }
});

test("renderPrBody fills template headings", () => {
  const body = renderPrBody(entry({ owner: "aind", repositoryUrl: "https://r.org" }), registry, "A fancy device");
  assert.match(body, /\*\*WhoAmI:\*\* 2200/);
  assert.match(body, /\*\*Device name:\*\* Fresh/);
  assert.match(body, /\*\*Owner:\*\* Allen Institute/);
  assert.match(body, /\*\*Device description:\*\* A fancy device/);
  assert.match(body, /\*\*Repository URL:\*\* https:\/\/r\.org/);
  assert.match(body, /\*\*Submitted via form:\*\* yes/);
  const fresh = renderPrBody(entry({ owner: NEW_OWNER, newOwnerKey: "my-lab", newOwnerAuthors: "My Lab" }), registry, "d");
  assert.match(fresh, /\*\*Owner:\*\* My Lab \(new\)/);
});

test("targetRepo derives repo from GitHub Pages location", () => {
  assert.equal(targetRepo({ hostname: "bruno-f-cruz.github.io", pathname: "/whoami/submit/", search: "" }), "bruno-f-cruz/whoami");
  assert.equal(targetRepo({ hostname: "harp-tech.org", pathname: "/whoami/submit/", search: "" }), "harp-tech/whoami");
});

test("targetRepo falls back and honours ?repo= override", () => {
  assert.equal(targetRepo({ hostname: "localhost", pathname: "/", search: "" }), "harp-tech/whoami");
  assert.equal(targetRepo({ hostname: "localhost", pathname: "/", search: "?repo=me/sandbox" }), "me/sandbox");
  assert.equal(targetRepo({ hostname: "localhost", pathname: "/", search: "?repo=<script>" }), "harp-tech/whoami");
});

test("repoUrls builds raw and editor URLs", () => {
  const u = repoUrls("me/sandbox");
  assert.equal(u.registry, "https://raw.githubusercontent.com/me/sandbox/main/whoami.yml");
  assert.equal(u.schema, "https://raw.githubusercontent.com/me/sandbox/main/whoami.json");
  assert.equal(u.edit, "https://github.com/me/sandbox/edit/main/whoami.yml");
});
