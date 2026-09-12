# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
import genlayer as gl
from genlayer.types import *
import json
import hashlib

class ResolverFactory(gl.contract.Contract):
    resolver_release_id: str
    resolver_code: str
    resolvers: gl.storage.TreeMap[str, str]
    manifest_hashes: gl.storage.TreeMap[str, str]

    def __init__(self, release_id: str, resolver_code: str) -> None:
        if not release_id or len(release_id) != 66 or not release_id.startswith("0x"): raise gl.vm.UserError("[EXPECTED] resolver release must be bytes32")
        if not resolver_code or "class MarketResolver(gl.contract.Contract):" not in resolver_code: raise gl.vm.UserError("[EXPECTED] MarketResolver source required")
        self.resolver_release_id = release_id
        self.resolver_code = resolver_code

    @gl.public.write
    def deploy_resolver(self, market_id: str, manifest: str, manifest_hash: str) -> str:
        if not market_id or self.resolvers.get(market_id, ""): raise gl.vm.UserError("[EXPECTED] resolver binding immutable")
        data = json.loads(manifest)
        canonical_body = json.dumps({key: value for key, value in data.items() if key != "manifest_hash"}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        computed_hash = "0x" + hashlib.sha256(canonical_body.encode("utf-8")).hexdigest()
        if data.get("market_id") != market_id or data.get("manifest_hash") != manifest_hash or computed_hash != manifest_hash: raise gl.vm.UserError("[EXPECTED] manifest binding mismatch")
        if len(market_id) != 66 or not market_id.startswith("0x"): raise gl.vm.UserError("[EXPECTED] market id must be bytes32")
        salt_nonce = int(market_id[2:], 16)
        # Default child deployment is finalized, avoiding re-execution during
        # appeals. A deterministic nonzero nonce makes one logical market map
        # to one immutable child address.
        # The live py-genlayer 5jyc runner exposes child deployment as
        # genlayer.contract.deploy. The similarly named deploy_contract
        # helper in newer SDK docs is not exported by this RC runner.
        resolver = gl.contract.deploy(code=self.resolver_code.encode("utf-8"), args=[manifest, manifest_hash, self.resolver_release_id], salt_nonce=salt_nonce)
        address = str(resolver); self.resolvers[market_id] = address; self.manifest_hashes[market_id] = manifest_hash
        return address

    @gl.public.view
    def get_resolver(self, market_id: str) -> str: return self.resolvers.get(market_id, "")
