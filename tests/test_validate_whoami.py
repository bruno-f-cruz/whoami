import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
SCRIPT = ROOT / "scripts" / "validate_whoami.py"
sys.path.insert(0, str(ROOT / "scripts"))

from validate_whoami import (  # noqa: E402
    DuplicateKeyError,
    diff_existing,
    load_registry,
    structure_errors,
    validate,
)


def fixture(name):
    return (FIXTURES / name).read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def schema():
    return json.loads((ROOT / "whoami.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def current():
    return load_registry((ROOT / "whoami.yml").read_text(encoding="utf-8"))


def run_cli(*args):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *map(str, args), "--schema", str(ROOT / "whoami.json")],
        capture_output=True,
        text=True,
    )


def with_entry(registry, key, entry):
    r = dict(registry)
    r[key] = entry
    return r


def test_current_registry_is_valid(current, schema):
    assert validate(current, schema) == []
    assert structure_errors((ROOT / "whoami.yml").read_text(encoding="utf-8")) == []


def test_merge_key_resolves(current):
    assert current[1040]["authors"] == "harp-tech"


def test_duplicate_key_fails():
    with pytest.raises(DuplicateKeyError):
        load_registry(fixture("dup_key.yml"))
    result = run_cli(FIXTURES / "dup_key.yml")
    assert result.returncode == 1
    assert "1410" in result.stdout


@pytest.mark.parametrize("name", ["bad_indent.yml", "tab_indent.yml"])
def test_bad_indentation_reports_line(name):
    result = run_cli(FIXTURES / name)
    assert result.returncode == 1
    assert "line=" in result.stdout


@pytest.mark.parametrize("key", [99, 10000, "0123"])
def test_invalid_whoami_range(current, schema, key):
    assert validate(with_entry(current, key, {"name": "Fresh"}), schema), key


def test_whoami_100_is_valid(current, schema):
    assert validate(with_entry(current, 100, {"name": "Fresh"}), schema) == []


@pytest.mark.parametrize("name", ["9Device", "my-device"])
def test_invalid_name(current, schema, name):
    assert validate(with_entry(current, 2200, {"name": name}), schema)


def test_duplicate_name_case_insensitive(current, schema):
    errors = validate(with_entry(current, 2200, {"name": "hobgoblin"}), schema)
    assert any("Hobgoblin" in e for e in errors)


def test_unknown_field_fails(current, schema):
    assert validate(with_entry(current, 2200, {"name": "Fresh", "copyright": "x"}), schema)


def test_http_url_fails(current, schema):
    assert validate(with_entry(current, 2200, {"name": "Fresh", "repositoryUrl": "http://x"}), schema)


def test_missing_name_fails(current, schema):
    assert validate(with_entry(current, 2200, {"projectUrl": "https://x.org"}), schema)


def test_app_package_validated(current, schema):
    ok = {"name": "Fresh", "app": {"type": "dotnetTool", "package": "Harp.Fresh.App"}}
    bad = {"name": "Fresh", "app": {"type": "dotnetTool", "package": "bad package"}}
    assert validate(with_entry(current, 2200, ok), schema) == []
    assert validate(with_entry(current, 2200, bad), schema)


def test_unsorted_key_fails():
    errors = structure_errors(fixture("unsorted.yml"))
    assert len(errors) == 1 and errors[0].startswith("WhoAmI 1500:")


def test_direct_authors_fails():
    errors = structure_errors(fixture("direct_authors.yml"))
    assert len(errors) == 1 and errors[0].startswith("WhoAmI 2200:")


def test_modified_existing_entry_fails():
    errors = diff_existing(load_registry(fixture("base.yml")), load_registry(fixture("modified_existing.yml")))
    assert len(errors) == 1 and "2110" in errors[0]


def test_removed_existing_entry_fails(current):
    head = dict(current)
    del head[2110]
    errors = diff_existing(current, head)
    assert len(errors) == 1 and "2110" in errors[0]


def test_appended_entry_passes_cli():
    result = run_cli(FIXTURES / "appended_ok.yml", "--base", FIXTURES / "base.yml")
    assert result.returncode == 0, result.stdout


@pytest.mark.parametrize("name", ["modified_existing.yml", "unsorted.yml", "direct_authors.yml"])
def test_rule_violations_fail_cli(name):
    result = run_cli(FIXTURES / name, "--base", FIXTURES / "base.yml")
    assert result.returncode == 1
    assert "::error" in result.stdout
