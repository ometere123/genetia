# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json

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

class MarketAdmissibility(gl.Contract):
    decisions: TreeMap[str, str]
    assessments: TreeMap[str, str]

    def __init__(self) -> None: pass

    @gl.public.write
    def assess(self, proposal_id: str, manifest: str) -> str:
        data = self._precheck(proposal_id, manifest)
        prompt = self._prompt(data)
        def independent():
            value = _json_value(gl.nondet.exec_prompt(prompt, response_format="json"))
            decision = str(value.get("decision", "")); issues = value.get("issue_codes", [])
            if decision not in DECISIONS or not isinstance(issues, list): raise gl.vm.UserError("[LLM_ERROR] invalid fields")
            return {"decision": decision, "issue_codes": sorted(set(str(item) for item in issues))[:16]}
        def validate(leader_result):
            if not isinstance(leader_result, gl.vm.Return): return False
            leader = leader_result.calldata
            if not isinstance(leader, dict) or leader.get("decision") not in DECISIONS: return False
            validator = independent()
            if validator["decision"] != leader.get("decision"): return False
            if leader.get("decision") == "APPROVED": return not validator["issue_codes"] and not leader.get("issue_codes", [])
            return bool(set(validator["issue_codes"]) & set(leader.get("issue_codes", [])))
        result = gl.vm.run_nondet_unsafe(independent, validate)
        decision = str(result["decision"])
        self.decisions[proposal_id] = decision
        self.assessments[proposal_id] = json.dumps(result, sort_keys=True, separators=(",", ":"))
        return decision

    @gl.public.view
    def get_assessment(self, proposal_id: str) -> str: return self.assessments.get(proposal_id, "")

    def _precheck(self, proposal_id: str, manifest: str):
        if not proposal_id or len(proposal_id) > 128: raise gl.vm.UserError("[EXPECTED] invalid proposal id")
        try: data = json.loads(manifest)
        except Exception: raise gl.vm.UserError("[EXPECTED] manifest is not valid JSON")
        if not isinstance(data, dict): raise gl.vm.UserError("[EXPECTED] manifest must be an object")
        missing = [field for field in REQUIRED_FIELDS if not data.get(field)]
        if missing: raise gl.vm.UserError("[EXPECTED] missing fields: " + ",".join(missing))
        if data.get("base_chain_id") != 84532 or data.get("genlayer_chain_id") != 61997: raise gl.vm.UserError("[EXPECTED] wrong chain binding")
        if data.get("resolution_profile") not in PROFILES: raise gl.vm.UserError("[EXPECTED] invalid resolution profile")
        if data.get("arbitrary_caller_urls_forbidden") is not True: raise gl.vm.UserError("[EXPECTED] caller source injection must be forbidden")
        if data.get("resolution_available_time") < data.get("close_time"): raise gl.vm.UserError("[EXPECTED] resolution precedes close")
        if data.get("absolute_terminal_deadline") != data.get("resolution_available_time") + 345600: raise gl.vm.UserError("[EXPECTED] terminal deadline must be +96h")
        return data

    def _prompt(self, data) -> str:
        return """Independently assess immutable YES/NO market terms. Evaluate question clarity, mutually exclusive YES and NO definitions, positive support for NO, timing, evidence identities/priority/fallback/corroboration, contradictions, and VOID conditions. Broad and long-tail subjects are allowed; never reject merely because a conventional oracle could answer. Return JSON only: {\"decision\":\"APPROVED|NEEDS_REVISION|REJECTED\",\"issue_codes\":[\"...\"]}. APPROVED requires no issues; NEEDS_REVISION is repairable ambiguity; REJECTED is abusive, contradictory, or inherently unresolvable. MANIFEST:\n""" + json.dumps(data, sort_keys=True, separators=(",", ":"))
