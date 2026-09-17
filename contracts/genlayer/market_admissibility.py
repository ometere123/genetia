# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
import genlayer as gl
from genlayer.types import *
import json
import hashlib

DECISIONS = ("APPROVED", "NEEDS_REVISION", "REJECTED")
PROFILES = ("STRUCTURED", "MULTI_SOURCE", "SEMANTIC", "COMPOSITE")
REQUIRED_FIELDS = ("market_id", "base_chain_id", "question", "yes_definition", "no_definition", "close_time", "resolution_available_time", "absolute_terminal_deadline", "void_conditions", "resolution_profile", "authoritative_sources", "source_policy", "fallback_sources", "corroboration_rule", "manifest_hash")

def _json_value(value):
    if isinstance(value, dict): return value
    if not isinstance(value, str): raise gl.vm.UserError("[LLM_ERROR] non-JSON admissibility response")
    try: parsed = json.loads(value)
    except Exception: raise gl.vm.UserError("[LLM_ERROR] malformed admissibility response")
    if not isinstance(parsed, dict): raise gl.vm.UserError("[LLM_ERROR] response must be an object")
    return parsed

class MarketAdmissibility(gl.contract.Contract):
    decisions: gl.storage.TreeMap[str, str]
    assessments: gl.storage.TreeMap[str, str]

    def __init__(self) -> None: pass

    @gl.public.write
    def assess(self, proposal_id: str, manifest: str) -> str:
        data = self._precheck(proposal_id, manifest)
        prompt = self._prompt(data)
        def independent():
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            value = _json_value(raw)
            decision = str(value.get("decision", "")); issues = value.get("issue_codes", [])
            if decision not in DECISIONS or not isinstance(issues, list): raise gl.vm.UserError("[LLM_ERROR] invalid fields")
            return {"decision": decision, "issue_codes": issues}
        def validate(leader_result):
            if not isinstance(leader_result, gl.vm.Return): return False
            leader = leader_result.calldata
            if not isinstance(leader, dict) or leader.get("decision") not in DECISIONS: return False
            validator = independent()
            if validator["decision"] != leader.get("decision"): return False
            if leader.get("decision") == "APPROVED": return len(validator["issue_codes"]) == 0 and len(leader.get("issue_codes", [])) == 0
            if len(leader.get("issue_codes", [])) == 0: return False
            return validator["issue_codes"][0] == leader["issue_codes"][0]
        # Studio Dev v0.123/GenVM rc7 exposes the validator-backed default
        # nondeterministic runner under this name. Keep the validator explicit;
        # this is not a direct-mode shortcut.
        result = gl.vm.run_nondet_default(independent, validate)
        decision = str(result["decision"])
        issues = result.get("issue_codes", [])
        if not isinstance(issues, list): raise gl.vm.UserError("[LLM_ERROR] invalid issue codes")
        self.decisions[proposal_id] = decision
        serialized = json.dumps(result, sort_keys=True, separators=(",", ":"))
        self.assessments[proposal_id] = serialized
        return decision

    @gl.public.view
    def get_assessment(self, proposal_id: str) -> str:
        return self.assessments.get(proposal_id, "")

    def _precheck(self, proposal_id: str, manifest: str):
        if not proposal_id or len(proposal_id) > 128: raise gl.vm.UserError("[EXPECTED] invalid proposal id")
        try: data = json.loads(manifest)
        except Exception: raise gl.vm.UserError("[EXPECTED] manifest is not valid JSON")
        if not isinstance(data, dict): raise gl.vm.UserError("[EXPECTED] manifest must be an object")
        self._require(data, "market_id")
        self._require(data, "base_chain_id")
        self._require(data, "question")
        self._require(data, "yes_definition")
        self._require(data, "no_definition")
        self._require(data, "close_time")
        self._require(data, "resolution_available_time")
        self._require(data, "absolute_terminal_deadline")
        self._require(data, "void_conditions")
        self._require(data, "resolution_profile")
        self._require(data, "authoritative_sources")
        self._require(data, "source_policy")
        self._require(data, "fallback_sources")
        self._require(data, "corroboration_rule")
        self._require(data, "manifest_hash")
        if data.get("base_chain_id") != 84532 or data.get("genlayer_chain_id") != 61997: raise gl.vm.UserError("[EXPECTED] wrong chain binding")
        if data.get("resolution_profile") not in PROFILES: raise gl.vm.UserError("[EXPECTED] invalid resolution profile")
        if data.get("arbitrary_caller_urls_forbidden") is not True: raise gl.vm.UserError("[EXPECTED] caller source injection must be forbidden")
        if data.get("resolution_profile") == "MULTI_SOURCE":
            sources = data.get("authoritative_sources", []) + data.get("fallback_sources", [])
            urls = [str(source.get("exact_url", "")) for source in sources if isinstance(source, dict)]
            identities = [str(source.get("identity", "")) for source in sources if isinstance(source, dict)]
            if len(urls) < 2 or len(set(urls)) < 2 or len(set(identities)) < 2: raise gl.vm.UserError("[EXPECTED] MULTI_SOURCE requires two distinct source URLs and identities")
            if int(data.get("minimum_corroborating_sources", 0)) < 2: raise gl.vm.UserError("[EXPECTED] MULTI_SOURCE requires two corroborating sources")
        if data.get("resolution_available_time") < data.get("close_time"): raise gl.vm.UserError("[EXPECTED] resolution precedes close")
        if data.get("absolute_terminal_deadline") != data.get("resolution_available_time") + 345600: raise gl.vm.UserError("[EXPECTED] terminal deadline must be +96h")
        canonical_body = json.dumps({key: value for key, value in data.items() if key != "manifest_hash"}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        expected_hash = "0x" + hashlib.sha256(canonical_body.encode("utf-8")).hexdigest()
        if data.get("manifest_hash") != expected_hash: raise gl.vm.UserError("[EXPECTED] manifest hash mismatch")
        return data

    def _require(self, data, field: str):
        if field not in data or data[field] is None: raise gl.vm.UserError("[EXPECTED] missing field: " + field)
        # An empty fallback list means the proposal deliberately has no
        # fallback source. It is present and valid; truthiness is not a
        # suitable presence check for this optional collection.
        if field == "fallback_sources":
            if not isinstance(data[field], list): raise gl.vm.UserError("[EXPECTED] fallback_sources must be a list")
            return
        value = data[field]
        if value == "" or value == [] or value == {}: raise gl.vm.UserError("[EXPECTED] missing field: " + field)

    def _prompt(self, data) -> str:
        return """Independently assess immutable YES/NO market terms. Evaluate question clarity, mutually exclusive YES and NO definitions, positive support for NO, timing, evidence identities/priority/fallback/corroboration, contradictions, and VOID conditions. Broad and long-tail subjects are allowed; never reject merely because a conventional oracle could answer. Return JSON only: {\"decision\":\"APPROVED|NEEDS_REVISION|REJECTED\",\"issue_codes\":[\"...\"]}. APPROVED requires no issues; NEEDS_REVISION is repairable ambiguity; REJECTED is abusive, contradictory, or inherently unresolvable. MANIFEST:\n""" + json.dumps(data, sort_keys=True, separators=(",", ":"))
