import hashlib, json
def canonical_manifest(value: dict) -> str: return json.dumps(value, sort_keys=True, separators=(",", ":"))
def manifest_hash(value: dict) -> str: return "sha256:" + hashlib.sha256(canonical_manifest(value).encode()).hexdigest()
