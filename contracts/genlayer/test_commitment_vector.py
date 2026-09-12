import ast
import hashlib
import json
from pathlib import Path

SOURCE = Path(__file__).with_name("market_resolver.py")


def _commitment_functions():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    selected = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in {"_evidence_commitment", "_result_commitment"}]
    namespace = {"json": json, "hashlib": hashlib}
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace["_evidence_commitment"], namespace["_result_commitment"]


def test_cross_language_commitment_vector():
    vector = json.loads(Path(__file__).with_name("commitment_vector.json").read_text(encoding="utf-8"))
    _evidence_commitment, _result_commitment = _commitment_functions()
    evidence = _evidence_commitment(vector["evidence"])
    assert evidence == vector["evidence_commitment"]
    canonical_result = {
        "attempt": vector["attempt"],
        "base_market": vector["base_market"].lower(),
        "evidence_commitment": evidence.lower(),
        "manifest_hash": vector["manifest_hash"].lower(),
        "market_id": vector["market_id"].lower(),
        "outcome": vector["outcome"],
        "resolver_release_id": vector["resolver_release_id"].lower(),
    }
    assert json.dumps(canonical_result, sort_keys=True, separators=(",", ":")) == vector["canonical_result_json"]
    result = _result_commitment(
        vector["market_id"], vector["base_market"], vector["manifest_hash"],
        vector["resolver_release_id"], vector["attempt"], vector["outcome"], evidence,
    )
    assert result == vector["result_commitment"]
