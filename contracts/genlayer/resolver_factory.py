# { "Seq": [{ "Depends": "py-genlayer-multi:06zyvrlivjga0d5jlpdbprksc0pa6jmllxvp8s20hq1l512vh5yk" }, { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }] }
from genlayer import *
import json
import hashlib

class ResolverFactory(gl.Contract):
    resolver_release_id: str
    resolvers: TreeMap[str, str]
    manifest_hashes: TreeMap[str, str]

    def __init__(self, release_id: str) -> None:
        if not release_id: raise gl.vm.UserError("[EXPECTED] release id required")
        self.resolver_release_id = release_id

    @gl.public.write
    def deploy_resolver(self, market_id: str, manifest: str, manifest_hash: str) -> str:
        if not market_id or self.resolvers.get(market_id, ""): raise gl.vm.UserError("[EXPECTED] resolver binding immutable")
        data = json.loads(manifest)
        canonical_body = json.dumps({key: value for key, value in data.items() if key != "manifest_hash"}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        computed_hash = "0x" + hashlib.sha256(canonical_body.encode("utf-8")).hexdigest()
        if data.get("market_id") != market_id or data.get("manifest_hash") != manifest_hash or computed_hash != manifest_hash: raise gl.vm.UserError("[EXPECTED] manifest binding mismatch")
        with open("/contract/market_resolver.py", "rt") as resolver_file: resolver_code = resolver_file.read()
        resolver = gl.deploy_contract(code=resolver_code.encode("utf-8"), args=[manifest, manifest_hash, self.resolver_release_id], salt_nonce=int.from_bytes(market_id.encode("utf-8")[:32], "big"), on="accepted")
        address = str(resolver); self.resolvers[market_id] = address; self.manifest_hashes[market_id] = manifest_hash
        return address

    @gl.public.view
    def get_resolver(self, market_id: str) -> str: return self.resolvers.get(market_id, "")
