# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from datetime import datetime, timezone
import json
import hashlib

OUTCOMES = ("YES", "NO", "VOID", "UNRESOLVED")

def _json_value(value):
    if isinstance(value, dict): return value
    if not isinstance(value, str): raise gl.vm.UserError("[LLM_ERROR] non-JSON candidate")
    try: parsed = json.loads(value)
    except Exception: raise gl.vm.UserError("[LLM_ERROR] malformed candidate")
    if not isinstance(parsed, dict): raise gl.vm.UserError("[LLM_ERROR] candidate must be an object")
    return parsed

class MarketResolver(gl.Contract):
    manifest: str
    manifest_hash: str
    market_id: str
    resolver_release_id: str
    status: str
    last_result: str
    attempts: TreeMap[str, str]

    def __init__(self, locked_manifest: str, locked_hash: str, release_id: str) -> None:
        data = json.loads(locked_manifest)
        canonical_body = json.dumps({key: value for key, value in data.items() if key != "manifest_hash"}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        computed_hash = "0x" + hashlib.sha256(canonical_body.encode("utf-8")).hexdigest()
        if data.get("manifest_hash") != locked_hash or locked_hash != computed_hash: raise gl.vm.UserError("[EXPECTED] manifest hash mismatch")
        if data.get("genlayer_chain_id") != 61997 or data.get("base_chain_id") != 84532: raise gl.vm.UserError("[EXPECTED] wrong chain binding")
        if data.get("arbitrary_caller_urls_forbidden") is not True: raise gl.vm.UserError("[EXPECTED] source injection policy missing")
        self.manifest = locked_manifest; self.manifest_hash = locked_hash; self.market_id = str(data["market_id"])
        self.resolver_release_id = release_id; self.status = "REGISTERED"; self.last_result = "UNRESOLVED"

    @gl.public.write
    def resolve(self, market_id: str, attempt_number: u256) -> str:
        data = json.loads(self.manifest)
        if market_id != self.market_id: raise gl.vm.UserError("[EXPECTED] wrong market")
        if self.status == "RESOLVED": raise gl.vm.UserError("[EXPECTED] terminal result already recorded")
        attempt = int(attempt_number)
        if attempt < 0 or attempt > 4: raise gl.vm.UserError("[EXPECTED] invalid evidence attempt")
        due = int(data["resolution_available_time"]) + [0, 1800, 14400, 86400, 259200][attempt]
        if int(datetime.now(timezone.utc).timestamp()) < due: raise gl.vm.UserError("[EXPECTED] resolution attempt too early")
        attempt_id = str(attempt)
        if self.attempts.get(attempt_id, ""): raise gl.vm.UserError("[EXPECTED] evidence attempt already consumed")
        for previous in range(attempt):
            previous_value = self.attempts.get(str(previous), "")
            if not previous_value: raise gl.vm.UserError("[EXPECTED] evidence attempts must be sequential")
            try: previous_outcome = json.loads(previous_value).get("outcome")
            except Exception: previous_outcome = ""
            if previous_outcome != "UNRESOLVED": raise gl.vm.UserError("[EXPECTED] terminal result already recorded")
        prompt = self._prompt(data, attempt)
        def independent():
            evidence = self._fetch_locked_evidence(data)
            usable = [item for item in evidence if item["available"]]
            if len(usable) < int(data.get("minimum_corroborating_sources", 1)):
                return {"manifest_hash": self.manifest_hash, "outcome": "UNRESOLVED", "used_sources": [], "facts": []}
            candidate = _json_value(gl.nondet.exec_prompt(prompt + "\nEVIDENCE:\n" + json.dumps(usable, sort_keys=True, separators=(",", ":")), response_format="json"))
            return {"manifest_hash": str(candidate.get("manifest_hash", "")), "outcome": str(candidate.get("outcome", "")), "used_sources": sorted(set(str(v) for v in candidate.get("used_sources", []))), "facts": sorted(set(str(v)[:500] for v in candidate.get("facts", [])))[:20]}
        def validate(leader_result):
            if not isinstance(leader_result, gl.vm.Return): return False
            leader = leader_result.calldata
            if not self._policy_valid(leader, data): return False
            validator = independent()
            return self._policy_valid(validator, data) and validator["outcome"] == leader["outcome"]
        candidate = gl.vm.run_nondet_unsafe(independent, validate)
        if not self._policy_valid(candidate, data): raise gl.vm.UserError("[LLM_ERROR] candidate violated locked policy")
        outcome = str(candidate["outcome"])
        if attempt == 4 and outcome == "UNRESOLVED":
            outcome = "VOID"; candidate["outcome"] = "VOID"; candidate["void_reason"] = "evidence retries exhausted"
        self.attempts[attempt_id] = json.dumps(candidate, sort_keys=True, separators=(",", ":"))
        self.last_result = outcome; self.status = "RESOLVED" if outcome in ("YES", "NO", "VOID") else "UNRESOLVED"
        return outcome

    @gl.public.view
    def get_attempt(self, attempt_number: u256) -> str: return self.attempts.get(str(int(attempt_number)), "")

    def _fetch_locked_evidence(self, data):
        evidence = []
        for source in (data.get("authoritative_sources", []) + data.get("fallback_sources", []))[:12]:
            identity = str(source.get("identity", "")); url = str(source.get("exact_url", ""))
            if not identity or not url: continue
            try: evidence.append({"identity": identity, "url": url, "available": True, "content": str(gl.nondet.web.render(url, mode="text"))[:6000]})
            except Exception: evidence.append({"identity": identity, "url": url, "available": False, "content": ""})
        return evidence

    def _policy_valid(self, candidate, data) -> bool:
        if not isinstance(candidate, dict) or candidate.get("manifest_hash") != self.manifest_hash or candidate.get("outcome") not in OUTCOMES: return False
        allowed = set(str(source.get("identity")) for source in data.get("authoritative_sources", []) + data.get("fallback_sources", []) if source.get("identity"))
        used = candidate.get("used_sources", [])
        return isinstance(used, list) and not any(str(item) not in allowed for item in used)

    def _prompt(self, data, attempt: int) -> str:
        return """Independently resolve this immutable YES/NO market using only supplied locked evidence. YES requires positive support for YES. NO requires positive support for NO; failure to prove YES is never NO. Apply contradiction, freshness, corroboration, fallback, and VOID rules. Insufficient, unavailable, stale, or unresolved conflicting evidence means UNRESOLVED. Return JSON only with manifest_hash, outcome (YES|NO|VOID|UNRESOLVED), used_sources (locked identities), and facts. ATTEMPT: """ + str(attempt) + "\nMANIFEST:\n" + json.dumps(data, sort_keys=True, separators=(",", ":"))
