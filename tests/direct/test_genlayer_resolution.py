import json
import pytest
from contracts.genlayer.manifest import manifest_hash


def manifest(**changes):
    value = {
        "market_id": "market-1", "base_chain_id": 84532, "genlayer_chain_id": 61997,
        "base_market_address": "0x1111111111111111111111111111111111111111",
        "question": "Will Example FC win the final?", "yes_definition": "YES iff the official final result names Example FC winner.",
        "no_definition": "NO iff the official final result positively names the opponent winner.",
        "close_time": 1893450000, "resolution_available_time": 1893456000,
        "absolute_terminal_deadline": 1893801600, "void_conditions": ["match abandoned without official result"],
        "resolution_profile": "STRUCTURED", "source_policy": "official-first",
        "authoritative_sources": [{"identity": "league", "exact_url": "https://official.example/final"}],
        "fallback_sources": [{"identity": "federation", "exact_url": "https://federation.example/final"}],
        "corroboration_rule": "one official source", "minimum_corroborating_sources": 1,
        "arbitrary_caller_urls_forbidden": True,
    }
    value.update(changes)
    if "manifest_hash" not in changes:
        value["manifest_hash"] = manifest_hash(value)
    return value


def candidate(outcome, sources=("league",), manifest_data=None):
    locked = manifest_data or manifest()
    return json.dumps({"manifest_hash": locked["manifest_hash"], "outcome": outcome, "used_sources": list(sources), "facts": ["official final"]})


def deploy_resolver(direct_deploy, direct_vm, data=None):
    data = data or manifest()
    direct_vm.warp("2030-01-01T02:00:00Z")
    return direct_deploy("contracts/genlayer/market_resolver.py", json.dumps(data), data["manifest_hash"], "resolver-release", sdk_version="v0.6.0-rc3")


def mock_sources(vm, league="Example FC won 2-1", federation="Example FC won"):
    vm.mock_web(r"official\.example/final", {"status": 200, "body": league})
    vm.mock_web(r"federation\.example/final", {"status": 200, "body": federation})


def test_admissibility_uses_independent_substantive_validator(direct_deploy, direct_vm):
    contract = direct_deploy("contracts/genlayer/market_admissibility.py", sdk_version="v0.6.0-rc3")
    direct_vm.mock_llm(r"Independently assess", json.dumps({"decision": "APPROVED", "issue_codes": []}))
    assert contract.assess("p1", json.dumps(manifest())) == "APPROVED"
    assert direct_vm.run_validator() is True
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r"Independently assess", json.dumps({"decision": "NEEDS_REVISION", "issue_codes": ["AMBIGUOUS_NO"]}))
    assert direct_vm.run_validator() is False


def test_admissibility_rejects_bad_timing_before_llm(direct_deploy, direct_vm):
    contract = direct_deploy("contracts/genlayer/market_admissibility.py", sdk_version="v0.6.0-rc3")
    bad = manifest(absolute_terminal_deadline=1893456001)
    with direct_vm.expect_revert("terminal deadline"):
        contract.assess("p2", json.dumps(bad))


@pytest.mark.parametrize(
    ("decision", "issue"),
    [("NEEDS_REVISION", "AMBIGUOUS_NO"), ("REJECTED", "CONTRADICTORY_TERMS")],
)
def test_admissibility_nonapproval_decisions_are_substantive(
    direct_deploy, direct_vm, decision, issue
):
    contract = direct_deploy(
        "contracts/genlayer/market_admissibility.py", sdk_version="v0.6.0-rc3"
    )
    direct_vm.mock_llm(
        r"Independently assess",
        json.dumps({"decision": decision, "issue_codes": [issue]}),
    )
    assert contract.assess("proposal-" + decision.lower(), json.dumps(manifest())) == decision
    assert direct_vm.run_validator() is True


def test_leader_yes_validator_evidence_no_disagrees(direct_deploy, direct_vm):
    contract = deploy_resolver(direct_deploy, direct_vm)
    mock_sources(direct_vm)
    direct_vm.mock_llm(r"Independently resolve", candidate("YES"))
    assert contract.resolve("market-1", 0) == "YES"
    direct_vm.clear_mocks(); mock_sources(direct_vm, "Opponent won", "Opponent won")
    direct_vm.mock_llm(r"Independently resolve", candidate("NO"))
    assert direct_vm.run_validator() is False


def test_leader_no_validator_evidence_yes_disagrees(direct_deploy, direct_vm):
    contract = deploy_resolver(direct_deploy, direct_vm)
    mock_sources(direct_vm, "Opponent won", "Opponent won")
    direct_vm.mock_llm(r"Independently resolve", candidate("NO"))
    assert contract.resolve("market-1", 0) == "NO"
    direct_vm.clear_mocks(); mock_sources(direct_vm)
    direct_vm.mock_llm(r"Independently resolve", candidate("YES"))
    assert direct_vm.run_validator() is False


def test_undeclared_source_and_manifest_injection_rejected(direct_deploy, direct_vm):
    contract = deploy_resolver(direct_deploy, direct_vm)
    mock_sources(direct_vm); direct_vm.mock_llm(r"Independently resolve", candidate("YES"))
    contract.resolve("market-1", 0)
    injected = {"manifest_hash": manifest()["manifest_hash"], "outcome": "YES", "used_sources": ["attacker"], "facts": []}
    assert direct_vm.run_validator(leader_result=injected) is False
    injected["used_sources"] = ["league"]; injected["manifest_hash"] = "sha256:other"
    assert direct_vm.run_validator(leader_result=injected) is False


def test_missing_sources_returns_unresolved_not_no(direct_deploy, direct_vm):
    data = manifest(fallback_sources=[], minimum_corroborating_sources=1)
    contract = deploy_resolver(direct_deploy, direct_vm, data)
    assert contract.resolve("market-1", 0) == "UNRESOLVED"


def test_later_evidence_retry_can_succeed(direct_deploy, direct_vm):
    contract = deploy_resolver(direct_deploy, direct_vm)
    assert contract.resolve("market-1", 0) == "UNRESOLVED"
    mock_sources(direct_vm)
    direct_vm.mock_llm(r"Independently resolve", candidate("YES"))
    assert contract.resolve("market-1", 1) == "YES"
    assert direct_vm.run_validator() is True


def test_fifth_persistent_unresolved_becomes_void(direct_deploy, direct_vm):
    data = manifest(fallback_sources=[], minimum_corroborating_sources=1)
    contract = deploy_resolver(direct_deploy, direct_vm, data)
    direct_vm.warp("2030-01-04T02:00:01Z")
    for attempt in range(4):
        assert contract.resolve("market-1", attempt) == "UNRESOLVED"
    assert contract.resolve("market-1", 4) == "VOID"


def test_attempts_must_be_consumed_in_order(direct_deploy, direct_vm):
    contract = deploy_resolver(direct_deploy, direct_vm, manifest(fallback_sources=[]))
    with direct_vm.expect_revert("sequential"):
        contract.resolve("market-1", 1)
    direct_vm.warp("2030-01-01T00:15:00Z")
    assert contract.resolve("market-1", 0) == "UNRESOLVED"
    with direct_vm.expect_revert("too early"):
        contract.resolve("market-1", 1)


@pytest.mark.parametrize("outcome", ["YES", "NO", "VOID"])
def test_terminal_outcome_stops_all_later_attempts(direct_deploy, direct_vm, outcome):
    contract = deploy_resolver(direct_deploy, direct_vm)
    mock_sources(direct_vm)
    direct_vm.mock_llm(r"Independently resolve", candidate(outcome))
    assert contract.resolve("market-1", 0) == outcome
    direct_vm.clear_mocks()
    direct_vm.warp("2030-01-04T02:00:01Z")
    with direct_vm.expect_revert("terminal result"):
        contract.resolve("market-1", 1)


def test_future_locked_source_page_is_resolved_without_exact_url(direct_deploy, direct_vm):
    data = manifest(authoritative_sources=[{
        "identity": "league", "allowed_domain": "official.example", "allowed_path": "/future-final",
        "source_type": "official", "priority": 0, "required": True,
    }])
    contract = deploy_resolver(direct_deploy, direct_vm, data)
    direct_vm.mock_web(r"official\.example/future-final", {"status": 200, "body": "Example FC won"})
    direct_vm.mock_llm(r"Independently resolve", candidate("YES", manifest_data=data))
    assert contract.resolve("market-1", 0) == "YES"


def test_too_early_wrong_market_and_duplicate_attempt_rejected(direct_deploy, direct_vm):
    data = manifest(resolution_available_time=1893456000, absolute_terminal_deadline=1893801600)
    direct_vm.warp("2029-12-31T00:00:00Z")
    contract = direct_deploy("contracts/genlayer/market_resolver.py", json.dumps(data), data["manifest_hash"], "resolver-release", sdk_version="v0.6.0-rc3")
    with direct_vm.expect_revert("too early"): contract.resolve("market-1", 0)
    direct_vm.warp("2030-01-01T02:00:00Z")
    with direct_vm.expect_revert("wrong market"): contract.resolve("other", 0)
    assert contract.resolve("market-1", 0) == "UNRESOLVED"
    with direct_vm.expect_revert("already consumed"): contract.resolve("market-1", 0)


def test_malformed_candidate_is_not_validated(direct_deploy, direct_vm):
    contract = deploy_resolver(direct_deploy, direct_vm)
    mock_sources(direct_vm); direct_vm.mock_llm(r"Independently resolve", candidate("YES"))
    contract.resolve("market-1", 0)
    assert direct_vm.run_validator(leader_result={"outcome": "YES"}) is False
