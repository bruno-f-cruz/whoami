// Fold submissions/<whoami>.yml files into whoami.yml.
//   node scripts/fold-submissions.mjs [--root DIR] (--out FILE | --write)
// --out   writes the folded registry to FILE and leaves the repository untouched (PR check).
// --write updates whoami.yml in place and deletes the folded submission files (after merge).
import { readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { foldSubmissions, parseSubmission, rulesFromSchema } from "../site/lib.js";

const { values } = parseArgs({
  options: { root: { type: "string", default: "." }, out: { type: "string" }, write: { type: "boolean", default: false } },
});
if (!values.out === !values.write) {
  console.error("usage: fold-submissions.mjs [--root DIR] (--out FILE | --write)");
  process.exit(2);
}

const root = values.root;
const registryPath = join(root, "whoami.yml");
const registryText = readFileSync(registryPath, "utf8");
const rules = rulesFromSchema(JSON.parse(readFileSync(join(root, "whoami.json"), "utf8")));
const dir = join(root, "submissions");
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".yml")).sort() : [];
const submissions = files.map((f) => ({ path: `submissions/${f}`, text: readFileSync(join(dir, f), "utf8") }));

const { text, errors } = foldSubmissions(registryText, rules, submissions);
for (const { path, message } of errors) console.log(`::error file=${path}::${message}`);
if (errors.length) process.exit(1);

if (values.out) {
  writeFileSync(values.out, text);
} else {
  writeFileSync(registryPath, text);
  for (const { path, text: subText } of submissions) {
    rmSync(join(root, path));
    const e = parseSubmission(subText);
    console.log(`${e.whoami} ${e.name}`);
  }
}
