# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
import json
TERMINAL = ("YES", "NO", "VOID")

class MarketResolver(gl.Contract):
    manifest: str
    manifest_hash: str
    resolver_release_id: str
    status: str
    last_result: str
    attempts: TreeMap[str, str]
    def __init__(self, locked_manifest: str, locked_hash: str, release_id: str) -> None:
        self.manifest = locked_manifest; self.manifest_hash = locked_hash; self.resolver_release_id = release_id; self.status = "REGISTERED"; self.last_result = "UNRESOLVED"
    @gl.public.write
    def resolve(self, attempt_id: str) -> str:
        data = json.loads(self.manifest); assert data.get("manifest_hash") == self.manifest_hash; assert data.get("genlayer_chain_id") == 61997
        self.status = "UNDER_RESOLUTION"
        def leader() -> str:
            evidence = []
            for source in data["authoritative_sources"]:
                try: evidence.append(str(gl.nondet.web.render(str(source), mode="text"))[:3500])
                except Exception: evidence.append("[unavailable]")
            return str(gl.nondet.exec_prompt(self._prompt(data, attempt_id) + json.dumps(evidence), response_format="json"))
        checked = gl.eq_principle.prompt_non_comparative(leader, task="Resolve the locked market", criteria="Independently fetch permitted sources, derive the outcome, and reject undeclared sources or manifest mismatch.")
        candidate = checked
        result = self._validate(candidate, checked, data)
        self.attempts[attempt_id] = json.dumps({"candidate": candidate, "validated": checked, "outcome": result})
        self.last_result = result; self.status = "RESOLVED" if result in TERMINAL else "UNRESOLVED"; return result
    def _prompt(self, data: dict, attempt_id: str) -> str:
        return json.dumps({"attempt": attempt_id, "question": data["question"], "yes": data["yes_definition"], "no": data["no_definition"], "sources": data["authoritative_sources"], "profile": data["resolution_profile"], "rule": data["resolution_rule"]}, sort_keys=True)
    def _validate(self, leader_raw: str, validator_raw: str, data: dict) -> str:
        leader = json.loads(leader_raw); validator = json.loads(validator_raw)
        assert leader.get("manifest_hash") == self.manifest_hash and validator.get("manifest_hash") == self.manifest_hash
        assert leader.get("source_policy") == data["source_policy"] and validator.get("source_policy") == data["source_policy"]
        assert leader.get("outcome") in TERMINAL + ("UNRESOLVED",) and validator.get("outcome") == leader.get("outcome")
        return leader["outcome"]
