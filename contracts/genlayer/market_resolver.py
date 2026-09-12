# v0.2.18
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


ALLOWED_OUTCOMES = ("YES", "NO", "VOID", "UNRESOLVED", "INVALID")
TERMINAL_OUTCOMES = ("YES", "NO", "VOID")
NON_SETTLE_OUTCOMES = ("UNRESOLVED", "INVALID")


class MarketResolver(gl.Contract):
    """
    Genetia GenLayer intelligent resolver.

    Arc remains the trading / financial settlement layer.
    This contract is only the evidence-based outcome resolver.

    v0.3.0 fixes the old trust hole by binding every resolution to a
    pre-registered canonical manifest and manifest_hash. Callers can trigger
    resolution permissionlessly, but they cannot provide different questions,
    rules, criteria, or sources at resolution time.

    Settlement bridge rule:
    - Settle Arc only for YES, NO, or VOID.
    - Do not settle Arc for UNRESOLVED or INVALID.
    - Always verify resolution.manifest_hash == expected manifest_hash.
    """

    owner: Address
    paused: bool
    market_count: u256
    attempt_count: u256

    # market_id -> manifest JSON string
    # manifest JSON must include, at minimum:
    # {
    #   "market_id": str,
    #   "arc_market_address": str,
    #   "arc_chain_id": str/int,
    #   "question": str,
    #   "yes_meaning": str,
    #   "no_meaning": str,
    #   "resolution_rule": str,
    #   "trusted_sources": [str],
    #   "void_conditions": [str],
    #   "close_time": str/int,
    #   "resolution_available_time": str/int,
    #   "prompt_version": str,
    #   "manifest_version": str
    # }
    manifests: TreeMap[str, str]

    # market_id -> expected manifest_hash string, computed off-chain from canonical manifest JSON
    manifest_hashes: TreeMap[str, str]

    # market_id -> resolution JSON string
    resolutions: TreeMap[str, str]

    # market_id -> latest status string
    # REGISTERED, UNDER_RESOLUTION, RESOLVED, VOID, UNRESOLVED, INVALID
    statuses: TreeMap[str, str]

    # attempt_id -> attempt JSON string
    attempts: TreeMap[str, str]

    # market_id -> JSON list of attempt IDs
    attempts_by_market: TreeMap[str, str]

    # address -> role string
    registrars: TreeMap[str, str]

    def __init__(self) -> None:
        self.owner = gl.message.sender_address
        self.paused = False
        self.market_count = u256(0)
        self.attempt_count = u256(0)
        self.registrars[self._addr_key(self.owner)] = "OWNER"

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _fail(self, msg: str) -> None:
        raise gl.vm.UserError(msg)

    def _addr_key(self, addr) -> str:
        return str(addr).lower()

    def _sender(self) -> str:
        return self._addr_key(gl.message.sender_address)

    def _require_owner(self) -> None:
        if self._sender() != self._addr_key(self.owner):
            self._fail("Only owner")

    def _is_registrar(self, addr) -> bool:
        return self.registrars.get(self._addr_key(addr), "") != ""

    def _require_registrar(self) -> None:
        if not self._is_registrar(gl.message.sender_address):
            self._fail("Only owner or registrar")

    def _require_not_paused(self) -> None:
        if self.paused:
            self._fail("Resolver is paused")

    def _safe_obj(self, raw: str) -> dict:
        try:
            data = json.loads(str(raw or ""))
            if isinstance(data, dict):
                return data
        except Exception:
            pass
        self._fail("Invalid JSON object")
        return {}

    def _safe_list(self, raw: str) -> list:
        try:
            data = json.loads(str(raw or "[]"))
            if isinstance(data, list):
                return data
        except Exception:
            pass
        return []

    def _extract_json(self, raw) -> dict:
        if isinstance(raw, dict):
            return raw

        text = str(raw or "").strip()
        if text.startswith("```"):
            # tolerate ```json fences
            nl = text.find("\n")
            if nl != -1:
                text = text[nl + 1:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return {}

        try:
            parsed = json.loads(text[start:end + 1])
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}

        return {}

    def _clean_str(self, value, max_len: int) -> str:
        return str(value or "").strip()[:max_len]

    def _clean_list(self, value, max_items: int, max_len: int) -> list:
        if not isinstance(value, list):
            value = []
        out = []
        for item in value:
            s = str(item or "").strip()
            if s and len(out) < max_items:
                out.append(s[:max_len])
        return out

    def _clamp_int(self, value, low: int, high: int) -> int:
        try:
            n = int(value)
        except Exception:
            n = 0
        if n < low:
            return low
        if n > high:
            return high
        return n

    def _append_attempt_index(self, market_id: str, attempt_id: str) -> None:
        arr = self._safe_list(self.attempts_by_market.get(market_id, "[]"))
        if attempt_id not in arr:
            arr.append(attempt_id)
        self.attempts_by_market[market_id] = json.dumps(arr)

    def _validate_manifest(self, market_id: str, manifest: dict, manifest_hash: str) -> None:
        if not market_id:
            self._fail("market_id required")
        if not manifest_hash:
            self._fail("manifest_hash required")

        required = (
            "market_id",
            "arc_market_address",
            "arc_chain_id",
            "question",
            "yes_meaning",
            "no_meaning",
            "resolution_rule",
            "trusted_sources",
            "void_conditions",
            "close_time",
            "resolution_available_time",
            "prompt_version",
            "manifest_version",
        )
        for key in required:
            if key not in manifest:
                self._fail("manifest missing field: " + key)

        if str(manifest.get("market_id", "")) != market_id:
            self._fail("manifest market_id mismatch")

        if not isinstance(manifest.get("trusted_sources"), list):
            self._fail("trusted_sources must be array")
        if len(manifest.get("trusted_sources")) < 1:
            self._fail("at least one trusted source required")
        if len(manifest.get("trusted_sources")) > 8:
            self._fail("too many trusted sources")

        if not isinstance(manifest.get("void_conditions"), list):
            self._fail("void_conditions must be array")

        if not str(manifest.get("question", "")).strip():
            self._fail("question required")
        if not str(manifest.get("resolution_rule", "")).strip():
            self._fail("resolution_rule required")

    def _normalise_resolution(self, parsed: dict, market_id: str, manifest_hash: str, prompt_version: str) -> dict:
        outcome = str(parsed.get("outcome", "INVALID")).strip().upper()
        if outcome not in ALLOWED_OUTCOMES:
            # Backward tolerance: old resolver/LLM may return bool.
            if isinstance(parsed.get("outcome"), bool):
                outcome = "YES" if parsed.get("outcome") else "NO"
            else:
                outcome = "INVALID"

        result_manifest_hash = str(parsed.get("manifest_hash", manifest_hash)).strip()
        if result_manifest_hash != manifest_hash:
            outcome = "INVALID"

        confidence = self._clamp_int(parsed.get("confidence", 0), 0, 100)
        sources_checked = self._clean_list(parsed.get("sources_checked", []), 8, 260)
        evidence_summary = self._clean_list(parsed.get("evidence_summary", []), 8, 500)
        reasoning = self._clean_str(parsed.get("reasoning", ""), 1200)
        void_reason = self._clean_str(parsed.get("void_reason", ""), 800)
        unresolved_reason = self._clean_str(parsed.get("unresolved_reason", ""), 800)

        if outcome in ("YES", "NO"):
            if not reasoning:
                outcome = "INVALID"
            if len(sources_checked) == 0:
                outcome = "INVALID"
            if len(evidence_summary) == 0:
                outcome = "INVALID"

        if outcome == "VOID" and not void_reason:
            outcome = "INVALID"

        if outcome == "UNRESOLVED" and not unresolved_reason:
            unresolved_reason = "Evidence is not sufficient or not available yet."

        if outcome == "INVALID":
            if not reasoning:
                reasoning = "Resolver output was invalid or did not match the expected manifest."

        return {
            "market_id": market_id,
            "manifest_hash": manifest_hash,
            "outcome": outcome,
            "confidence": confidence,
            "sources_checked": sources_checked,
            "evidence_summary": evidence_summary,
            "reasoning": reasoning,
            "void_reason": void_reason,
            "unresolved_reason": unresolved_reason,
            "prompt_version": prompt_version,
        }

    def _status_for_outcome(self, outcome: str) -> str:
        if outcome == "YES" or outcome == "NO":
            return "RESOLVED"
        if outcome == "VOID":
            return "VOID"
        if outcome == "UNRESOLVED":
            return "UNRESOLVED"
        return "INVALID"

    def _build_prompt(self, manifest: dict, manifest_hash: str, evidence: str) -> str:
        return (
            "You are Genetia's neutral GenLayer market resolver.\n"
            "Resolve this prediction market using ONLY the canonical manifest and the collected source evidence.\n\n"
            "CANONICAL RESOLUTION MANIFEST JSON:\n"
            + json.dumps(manifest, sort_keys=True)
            + "\n\nEXPECTED MANIFEST HASH:\n"
            + manifest_hash
            + "\n\nCOLLECTED SOURCE EVIDENCE:\n"
            + evidence
            + "\n\n"
            "Task:\n"
            "Determine whether the market resolves YES, NO, VOID, UNRESOLVED, or INVALID.\n\n"
            "Definitions:\n"
            "- YES: the resolution rule is clearly satisfied.\n"
            "- NO: the resolution rule is clearly not satisfied.\n"
            "- VOID: the market should not settle to either side because a listed void condition applies, the market is malformed, or fair resolution is impossible.\n"
            "- UNRESOLVED: the event is too early, evidence is unavailable, sources are down, or retry may later produce a valid answer.\n"
            "- INVALID: only use if the input/output cannot be processed or the manifest hash cannot be preserved.\n\n"
            "Rules:\n"
            "- Do not use prior knowledge.\n"
            "- Do not guess.\n"
            "- Follow the manifest resolution_rule exactly.\n"
            "- Apply the manifest void_conditions exactly.\n"
            "- Do not collapse ambiguous or too-early cases into NO. Use UNRESOLVED or VOID.\n"
            "- Preserve the exact manifest_hash in your output.\n"
            "- Return STRICT JSON only, no markdown and no prose outside JSON.\n\n"
            "Return exactly this JSON shape:\n"
            "{\n"
            '  "market_id": "' + str(manifest.get("market_id", "")) + '",\n'
            '  "manifest_hash": "' + manifest_hash + '",\n'
            '  "outcome": "YES | NO | VOID | UNRESOLVED | INVALID",\n'
            '  "confidence": 0,\n'
            '  "sources_checked": ["source url or source name"],\n'
            '  "evidence_summary": ["short evidence point"],\n'
            '  "reasoning": "short explanation",\n'
            '  "void_reason": "required if outcome is VOID, otherwise empty string",\n'
            '  "unresolved_reason": "required if outcome is UNRESOLVED, otherwise empty string",\n'
            '  "prompt_version": "' + str(manifest.get("prompt_version", "v1")) + '"\n'
            "}\n"
        )

    # ------------------------------------------------------------------
    # Admin / registrar writes
    # ------------------------------------------------------------------

    @gl.public.write
    def add_registrar(self, registrar: Address) -> None:
        self._require_owner()
        self.registrars[self._addr_key(registrar)] = "REGISTRAR"

    @gl.public.write
    def remove_registrar(self, registrar: Address) -> None:
        self._require_owner()
        key = self._addr_key(registrar)
        if key in self.registrars:
            del self.registrars[key]

    @gl.public.write
    def pause(self) -> None:
        self._require_owner()
        self.paused = True

    @gl.public.write
    def unpause(self) -> None:
        self._require_owner()
        self.paused = False

    @gl.public.write
    def transfer_ownership(self, new_owner: Address) -> None:
        self._require_owner()
        self.owner = new_owner
        self.registrars[self._addr_key(new_owner)] = "OWNER"

    @gl.public.write
    def register_market(self, market_id: str, manifest_json: str, manifest_hash: str) -> None:
        """
        Register the exact resolution manifest for a market.

        Only owner/registrar can register. This prevents a random user from
        poisoning market_id with different criteria or sources before the app.

        The app/pipeline must compute manifest_hash from canonical manifest JSON
        and store the same hash in its own Arc-side metadata.
        """
        self._require_not_paused()
        self._require_registrar()

        market_id = str(market_id).strip()
        manifest_hash = str(manifest_hash).strip()

        if self.manifests.get(market_id, ""):
            self._fail("market already registered")
        if self.resolutions.get(market_id, ""):
            self._fail("market already resolved")

        manifest = self._safe_obj(manifest_json)
        self._validate_manifest(market_id, manifest, manifest_hash)

        self.manifests[market_id] = json.dumps(manifest, sort_keys=True)
        self.manifest_hashes[market_id] = manifest_hash
        self.statuses[market_id] = "REGISTERED"
        self.market_count = u256(int(self.market_count) + 1)

    # Backward-friendly name for pipeline migration. It does NOT accept mutable
    # criteria at resolution time anymore. It registers the canonical manifest.
    @gl.public.write
    def request_resolution(self, market_id: str, manifest_json: str, manifest_hash: str) -> None:
        self.register_market(market_id, manifest_json, manifest_hash)

    # ------------------------------------------------------------------
    # Permissionless GenLayer resolution
    # ------------------------------------------------------------------

    @gl.public.write
    def resolve_market(self, market_id: str) -> None:
        """
        Permissionlessly trigger resolution for a registered market.

        Caller cannot provide a question, criteria, or sources. The resolver uses
        only the stored canonical manifest and expected manifest_hash.
        """
        self._require_not_paused()
        market_id = str(market_id).strip()

        manifest_json = self.manifests.get(market_id, "")
        if not manifest_json:
            self._fail("market not registered")

        existing_raw = self.resolutions.get(market_id, "")
        if existing_raw:
            existing = self._extract_json(existing_raw)
            if str(existing.get("outcome", "")).upper() in TERMINAL_OUTCOMES:
                self._fail("market already terminally resolved")
            # UNRESOLVED/INVALID can be retried.

        manifest_hash = self.manifest_hashes.get(market_id, "")
        if not manifest_hash:
            self._fail("manifest hash missing")

        manifest = self._safe_obj(manifest_json)
        prompt_version = str(manifest.get("prompt_version", "v1"))
        trusted_sources = manifest.get("trusted_sources", [])
        if not isinstance(trusted_sources, list):
            trusted_sources = []
        trusted_sources = trusted_sources[:8]

        self.statuses[market_id] = "UNDER_RESOLUTION"

        attempt_id = "ATTEMPT-" + str(int(self.attempt_count) + 1)
        self.attempt_count = u256(int(self.attempt_count) + 1)
        self.attempts[attempt_id] = json.dumps({
            "attempt_id": attempt_id,
            "market_id": market_id,
            "manifest_hash": manifest_hash,
            "status": "SUBMITTED",
        }, sort_keys=True)
        self._append_attempt_index(market_id, attempt_id)

        def leader_resolution() -> str:
            evidence_parts = []

            for url in trusted_sources:
                source = str(url or "")[:500]
                try:
                    page = gl.nondet.web.render(source, mode="text")
                    snippet = str(page or "")[:3500]
                    evidence_parts.append("SOURCE: " + source + "\n" + snippet)
                except Exception:
                    evidence_parts.append("SOURCE: " + source + "\n[could not fetch]")

            if len(evidence_parts) > 0:
                evidence = "\n\n---\n\n".join(evidence_parts)
            else:
                evidence = "[no trusted sources available]"

            prompt = self._build_prompt(manifest, manifest_hash, evidence)
            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            parsed = self._extract_json(raw)
            normalised = self._normalise_resolution(parsed, market_id, manifest_hash, prompt_version)
            return json.dumps(normalised, sort_keys=True)

        review_json = gl.eq_principle.prompt_non_comparative(
            leader_resolution,
            task=(
                "Resolve a Genetia prediction market using its stored canonical manifest, "
                "trusted sources, resolution rule, and void conditions. Return a strict JSON "
                "outcome enum: YES, NO, VOID, UNRESOLVED, or INVALID."
            ),
            criteria=(
                "Accept candidate O only if all conditions hold: "
                "1. O is strict JSON with keys market_id, manifest_hash, outcome, confidence, "
                "sources_checked, evidence_summary, reasoning, void_reason, unresolved_reason, prompt_version. "
                "2. O.market_id matches the target market. "
                "3. O.manifest_hash equals the expected manifest_hash. "
                "4. O.outcome is one of YES, NO, VOID, UNRESOLVED, INVALID. "
                "5. O.confidence is an integer 0 to 100. "
                "6. For YES or NO, O.sources_checked and O.evidence_summary are non-empty and reasoning is non-empty. "
                "7. VOID has a non-empty void_reason. "
                "8. UNRESOLVED has a non-empty unresolved_reason. "
                "9. The outcome is supported by the canonical manifest and collected source evidence, "
                "without using prior knowledge or caller-supplied rules. "
                "Do not require a specific outcome; accept any supported valid enum output."
            ),
        )

        parsed = self._extract_json(review_json)
        final = self._normalise_resolution(parsed, market_id, manifest_hash, prompt_version)
        final["attempt_id"] = attempt_id

        self.resolutions[market_id] = json.dumps(final, sort_keys=True)
        outcome = str(final.get("outcome", "INVALID"))
        self.statuses[market_id] = self._status_for_outcome(outcome)

        attempt = self._extract_json(self.attempts.get(attempt_id, "{}"))
        attempt["status"] = "ACCEPTED" if outcome in TERMINAL_OUTCOMES else outcome
        attempt["outcome"] = outcome
        self.attempts[attempt_id] = json.dumps(attempt, sort_keys=True)

    # ------------------------------------------------------------------
    # Views
    # ------------------------------------------------------------------

    @gl.public.view
    def get_resolution(self, market_id: str) -> str:
        return self.resolutions.get(str(market_id), "null")

    @gl.public.view
    def get_manifest(self, market_id: str) -> str:
        return self.manifests.get(str(market_id), "null")

    @gl.public.view
    def get_manifest_hash(self, market_id: str) -> str:
        return self.manifest_hashes.get(str(market_id), "")

    @gl.public.view
    def get_status(self, market_id: str) -> str:
        return self.statuses.get(str(market_id), "UNKNOWN")

    @gl.public.view
    def is_resolved(self, market_id: str) -> bool:
        raw = self.resolutions.get(str(market_id), "")
        if not raw:
            return False
        res = self._extract_json(raw)
        return str(res.get("outcome", "")).upper() in ("YES", "NO")

    @gl.public.view
    def is_terminal(self, market_id: str) -> bool:
        raw = self.resolutions.get(str(market_id), "")
        if not raw:
            return False
        res = self._extract_json(raw)
        return str(res.get("outcome", "")).upper() in TERMINAL_OUTCOMES

    @gl.public.view
    def is_settlement_ready(self, market_id: str) -> bool:
        return self.is_terminal(market_id)

    @gl.public.view
    def get_attempt(self, attempt_id: str) -> str:
        return self.attempts.get(str(attempt_id), "null")

    @gl.public.view
    def get_attempts_for_market(self, market_id: str) -> str:
        return self.attempts_by_market.get(str(market_id), "[]")

    @gl.public.view
    def get_owner(self) -> str:
        return self._addr_key(self.owner)

    @gl.public.view
    def is_registrar(self, addr: Address) -> bool:
        return self._is_registrar(addr)

    @gl.public.view
    def get_protocol_stats(self) -> str:
        return json.dumps({
            "market_count": int(self.market_count),
            "attempt_count": int(self.attempt_count),
            "paused": self.paused,
        }, sort_keys=True)
