# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "pyyaml==6.0.2",
#     "jsonschema==4.23.0",
# ]
# ///
"""Validate the WhoAmI registry (whoami.yml) against whoami.json and registry rules.

Usage: validate_whoami.py <head.yml> [--base <base.yml>] [--schema whoami.json]
"""

import argparse
import json
import re
import sys
from pathlib import Path

import jsonschema
import yaml

MERGE_TAG = "tag:yaml.org,2002:merge"


class DuplicateKeyError(Exception):
    def __init__(self, key, line):
        super().__init__(f"duplicate key {key!r} on line {line}")
        self.key = key
        self.line = line


class _StrictLoader(yaml.SafeLoader):
    """SafeLoader (YAML 1.1, merge keys) that rejects duplicate mapping keys."""

    def construct_mapping(self, node, deep=False):
        seen = {}
        for key_node, _ in node.value:
            if key_node.tag == MERGE_TAG:
                continue
            key = self.construct_object(key_node, deep=True)
            line = key_node.start_mark.line + 1
            if key in seen:
                raise DuplicateKeyError(key, line)
            seen[key] = line
        return super().construct_mapping(node, deep=deep)


def load_registry(text: str) -> dict:
    doc = yaml.load(text, Loader=_StrictLoader)
    if not isinstance(doc, dict) or not isinstance(doc.get("devices"), dict):
        raise ValueError("whoami.yml must contain a top-level 'devices' mapping")
    return doc["devices"]


def _key_pattern(schema: dict) -> re.Pattern:
    (pattern,) = schema["properties"]["devices"]["patternProperties"].keys()
    return re.compile(pattern)


def validate(registry: dict, schema: dict) -> list[str]:
    errors = []
    key_re = _key_pattern(schema)
    for key in registry:
        if not (isinstance(key, (int, str)) and not isinstance(key, bool) and key_re.fullmatch(str(key))):
            errors.append(f"WhoAmI {key}: must be an integer from 100 to 9999 (pattern {key_re.pattern})")

    instance = {"devices": {str(k): v for k, v in registry.items()}}
    validator = jsonschema.validators.validator_for(schema)(schema)
    for err in validator.iter_errors(instance):
        path = list(err.absolute_path)
        if len(path) < 2:
            if err.validator == "additionalProperties" and path == ["devices"]:
                continue  # reported by the key check above
            errors.append(f"WhoAmI ?: {err.message}")
            continue
        where = f".{path[2]}" if len(path) > 2 else ""
        errors.append(f"WhoAmI {path[1]}: {where.lstrip('.') + ' ' if where else ''}{err.message}")

    names = {}
    for key, entry in registry.items():
        name = entry.get("name") if isinstance(entry, dict) else None
        if not isinstance(name, str):
            continue
        folded = name.casefold()
        if folded in names:
            other_key, other_name = names[folded]
            errors.append(f"WhoAmI {key}: name '{name}' duplicates '{other_name}' (WhoAmI {other_key})")
        else:
            names[folded] = (key, name)
    return errors


def structure_errors(text: str) -> list[str]:
    """Rules about how whoami.yml is written, which the parsed data cannot show:
    devices are listed in ascending WhoAmI order, and authors come from an owner via a merge key."""
    root = yaml.compose(text, Loader=_StrictLoader)
    devices = next(
        (value for key, value in root.value if key.value == "devices"),
        None,
    ) if isinstance(root, yaml.MappingNode) else None
    if not isinstance(devices, yaml.MappingNode):
        return []
    errors = []
    previous = None
    for key_node, value_node in devices.value:
        try:
            key = int(key_node.value)
        except ValueError:
            continue  # reported by the schema check
        if previous is not None and key <= previous:
            errors.append(f"WhoAmI {key}: devices must be listed in ascending WhoAmI order (found after {previous})")
        previous = max(key, previous) if previous is not None else key
        if isinstance(value_node, yaml.MappingNode) and any(
            k.value == "authors" and k.tag != MERGE_TAG for k, _ in value_node.value
        ):
            errors.append(
                f"WhoAmI {key}: set authors through an owner (`<<: *owner`), not directly on the device"
            )
    return errors


def diff_existing(base: dict, head: dict) -> list[str]:
    errors = []
    for key, entry in base.items():
        if key not in head:
            errors.append(f"WhoAmI {key}: existing entry was removed")
        elif head[key] != entry:
            errors.append(f"WhoAmI {key}: existing entry was modified")
    return errors


def _line_of(text: str, message: str):
    m = re.match(r"WhoAmI (\S+):", message)
    if not m:
        return None
    hit = re.search(rf"^[ ]*{re.escape(m.group(1))}\s*:", text, re.M)
    return text.count("\n", 0, hit.start()) + 1 if hit else None


def _emit(path: str, message: str, line=None):
    loc = f"file={path},line={line}" if line else f"file={path}"
    print(f"::error {loc}::{message}")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("head")
    parser.add_argument("--base")
    parser.add_argument("--schema", default="whoami.json")
    args = parser.parse_args(argv)

    display = "whoami.yml"
    text = Path(args.head).read_text(encoding="utf-8")
    schema = json.loads(Path(args.schema).read_text(encoding="utf-8"))

    try:
        head = load_registry(text)
    except DuplicateKeyError as e:
        _emit(display, f"WhoAmI {e.key}: is defined more than once", e.line)
        return 1
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        line = mark.line + 1 if mark else None
        _emit(display, f"YAML syntax error (check indentation: 2 spaces before the WhoAmI, 4 before fields, no tabs): {e}".replace("\n", " "), line)
        return 1
    except ValueError as e:
        _emit(display, str(e))
        return 1

    errors = validate(head, schema) + structure_errors(text)
    if args.base:
        base = load_registry(Path(args.base).read_text(encoding="utf-8"))
        errors += diff_existing(base, head)

    for msg in errors:
        _emit(display, msg, _line_of(text, msg))
    if not errors:
        print(f"whoami.yml OK: {len(head)} devices")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
