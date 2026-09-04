# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfpjqmwsfhh8jpz09h6" }
from genlayer import *
import json
class MarketAdmissibility(gl.Contract):
    decisions: TreeMap[str, str]
    def __init__(self) -> None: self.decisions = TreeMap()
    @gl.public.write
    def assess(self, proposal_id: str, manifest: str) -> str:
        data = json.loads(manifest); assert data.get("genlayer_chain_id") == 61997
        assert data.get("question") and data.get("yes_definition") and data.get("no_definition") and data.get("authoritative_sources") and data.get("source_policy")
        decision = "APPROVED" if data.get("resolution_profile") in ("STRUCTURED", "MULTI_SOURCE", "SEMANTIC", "COMPOSITE") else "NEEDS_REVISION"; self.decisions[proposal_id] = decision; return decision
