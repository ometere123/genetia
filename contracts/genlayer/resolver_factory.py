# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
from genlayer import *
from market_resolver import MarketResolver
class ResolverFactory(gl.Contract):
    resolver_release_id: str
    resolvers: TreeMap[str, str]
    def __init__(self, release_id: str) -> None: self.resolver_release_id = release_id
    @gl.public.write
    def deploy_resolver(self, market_id: str, manifest: str, manifest_hash: str) -> str:
        resolver = MarketResolver(manifest, manifest_hash, self.resolver_release_id); self.resolvers[market_id] = str(resolver.address); return str(resolver.address)
