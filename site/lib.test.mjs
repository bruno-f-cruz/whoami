import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { load } from "./vendor/js-yaml.mjs";
import {
  FALLBACK_RULES,
  FIELD_ORDER,
  parseRegistry,
  renderPrBody,
  renderYamlBlock,
  repoUrls,
  rulesFromSchema,
  suggestWhoAmI,
  targetRepo,
  validateEntry,
} from "./lib.js";

const root = new URL("../", import.meta.url);
const baseYml = readFileSync(new URL("tests/fixtures/base.yml", root), "utf8");
const schema = JSON.parse(readFileSync(new URL("whoami.json", root), "utf8"));
const registry = parseRegistry(baseYml);
const rules = rulesFromSchema(schema);

const fieldsOf = (errors) => errors.map((e) => e.field).sort();

test("rulesFromSchema reads patterns", () => {
  assert.ok(rules.whoami.test("1500"));
  assert.ok(rules.name.test("MyDevice"));
  assert.ok(!rules.whoami.test("99"));
  assert.ok(!rules.whoami.test("10000"));
  assert.ok(!rules.name.test("my-device"));
});

test("fallback rules equal schema rules", () => {
  assert.equal(FALLBACK_RULES.whoami.source, rules.whoami.source);
  assert.equal(FALLBACK_RULES.name.source, rules.name.source);
});

test("parseRegistry resolves merge keys", () => {
  assert.equal(registry.size, 45);
  assert.equal(registry.get(1040).authors, "harp-tech");
  assert.equal(registry.get(1040).name, "MultiPwmGenerator");
});

test("validateEntry accepts a fresh entry", () => {
  assert.deepEqual(validateEntry({ whoami: "1500", name: "Fresh" }, rules, registry), []);
});

test("validateEntry flags taken whoami and duplicate name", () => {
  const errs = validateEntry({ whoami: "1410", name: "HOBGOBLIN" }, rules, registry);
  assert.deepEqual(fieldsOf(errs), ["name", "whoami"]);
  assert.match(errs.find((e) => e.field === "whoami").message, /deLuxDriver/);
  assert.match(errs.find((e) => e.field === "name").message, /Hobgoblin/);
});

test("validateEntry without registry skips uniqueness", () => {
  assert.deepEqual(validateEntry({ whoami: "1410", name: "Hobgoblin" }, rules, null), []);
});

test("validateEntry rejects http urls and bad names", () => {
  const errs = validateEntry(
    { whoami: "1500", name: "my-device", repositoryUrl: "http://x.org", projectUrl: "https://ok.org" },
    rules,
    registry,
  );
  assert.deepEqual(fieldsOf(errs), ["name", "repositoryUrl"]);
});

test("validateEntry requires whoami and name", () => {
  assert.deepEqual(fieldsOf(validateEntry({ whoami: "", name: "" }, rules, registry)), ["name", "whoami"]);
});

test("validateEntry rejects multi-line text", () => {
  const errs = validateEntry({ whoami: "1500", name: "Fresh", authors: "a\nb" }, rules, registry);
  assert.deepEqual(fieldsOf(errs), ["authors"]);
});

test("suggestWhoAmI returns next after max", () => {
  assert.equal(suggestWhoAmI(registry), 2111);
});

test("suggestWhoAmI fills gaps when max is 9999", () => {
  const r = new Map([[100, {}], [9999, {}]]);
  assert.equal(suggestWhoAmI(r), 101);
});

test("renderYamlBlock appends cleanly", () => {
  const entry = {
    whoami: "1500",
    name: "Fresh",
    authors: "Some Lab",
    copyright: "Some Lab",
    repositoryUrl: "https://github.com/x/y",
    projectUrl: "https://x.org/y",
  };
  const after = parseRegistry(baseYml + renderYamlBlock(entry));
  assert.equal(after.size, 46);
  const { whoami, ...fields } = entry;
  assert.deepEqual(after.get(1500), fields);
  for (const [k, v] of registry) assert.deepEqual(after.get(k), v);
});

test("renders special characters safely", () => {
  const entry = { whoami: "1500", name: "Fresh", authors: "Smith: Lab #2", copyright: "yes" };
  const block = renderYamlBlock(entry);
  const parsed = load("devices:" + block).devices[1500];
  assert.deepEqual(parsed, { name: "Fresh", authors: "Smith: Lab #2", copyright: "yes" });
  for (const v of ["2024", "null", "Ünïcødé Lab", "O'Brien \"Lab\"", "a: b", "Off"]) {
    const p = load("devices:" + renderYamlBlock({ whoami: "1500", name: "Fresh", authors: v })).devices[1500];
    assert.equal(p.authors, v, v);
  }
  // YAML 1.1 readers (PyYAML) treat yes/no/on/off as booleans: those must be quoted.
  assert.match(block, /copyright: "yes"/);
});

test("renderYamlBlock field order and omission", () => {
  assert.equal(renderYamlBlock({ whoami: "1500", name: "Foo", authors: "" }), "\n  1500:\n    name: Foo\n");
  assert.equal(
    renderYamlBlock({ projectUrl: "https://p.org", whoami: "1500", authors: "A", name: "Foo", copyright: "C", repositoryUrl: "https://r.org" }),
    "\n  1500:\n    name: Foo\n    authors: A\n    copyright: C\n    repositoryUrl: https://r.org\n    projectUrl: https://p.org\n",
  );
  assert.deepEqual(FIELD_ORDER, ["name", "authors", "copyright", "repositoryUrl", "projectUrl"]);
});

test("renderPrBody fills template headings", () => {
  const body = renderPrBody({ whoami: "1500", name: "Foo", repositoryUrl: "https://r.org" }, "A fancy device");
  assert.match(body, /\*\*WhoAmI:\*\* 1500/);
  assert.match(body, /\*\*Device name:\*\* Foo/);
  assert.match(body, /\*\*Device description:\*\* A fancy device/);
  assert.match(body, /\*\*Repository URL:\*\* https:\/\/r\.org/);
  assert.match(body, /\*\*Submitted via form:\*\* yes/);
});

test("targetRepo derives repo from GitHub Pages location", () => {
  assert.equal(targetRepo({ hostname: "bruno-f-cruz.github.io", pathname: "/whoami/", search: "" }), "bruno-f-cruz/whoami");
  assert.equal(targetRepo({ hostname: "harp-tech.github.io", pathname: "/whoami/index.html", search: "" }), "harp-tech/whoami");
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
  assert.equal(u.table, "https://github.com/me/sandbox/blob/main/whoami.md");
});
