# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }
import genlayer as gl
from genlayer.types import u256


class StorageProbe(gl.contract.Contract):
    entries: gl.storage.TreeMap[str, str]
    last_key: str
    count: u256

    def __init__(self) -> None:
        self.last_key = ""
        self.count = u256(0)

    @gl.public.write
    def put(self, key: str, value: str) -> str:
        self.entries[key] = value
        self.last_key = key
        self.count = self.count + u256(1)
        return key

    @gl.public.view
    def get(self, key: str) -> str:
        return self.entries.get(key, "")

    @gl.public.view
    def metadata(self) -> str:
        return self.last_key + ":" + str(int(self.count))
