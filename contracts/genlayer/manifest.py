import hashlib
import json

def canonical_manifest_body(value: dict) -> str:
    body = {key: item for key, item in value.items() if key != "manifest_hash"}
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def canonical_manifest_bytes(value: dict) -> bytes:
    return canonical_manifest_body(value).encode("utf-8")

def manifest_hash(value: dict) -> str:
    return "0x" + hashlib.sha256(canonical_manifest_bytes(value)).hexdigest()
