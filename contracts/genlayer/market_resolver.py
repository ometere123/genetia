# v.0.2.17
# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

from genlayer import *
import json


class MarketResolver(gl.Contract):
    """
    GenLayer intelligent resolver for Genetia markets.

    This contract stores evidence-based verdicts only. Arc contracts remain
    the financial settlement layer. A trusted app/relayer reads the finalized
    verdict from GenLayer and submits it to Arc, where the challenge window,
    finalisation, and redemption happen.
    """

    # market_id -> JSON string:
    # {"outcome": bool, "reasoning": str}
    resolutions: TreeMap[str, str]

    # market_id -> JSON string:
    # {"question": str, "criteria": str, "sources": [str, ...]}
    pending: TreeMap[str, str]

    def __init__(self) -> None:
        pass

    # -------------------------
    # Views
    # -------------------------

    @gl.public.view
    def get_resolution(self, market_id: str) -> str:
        if market_id in self.resolutions:
            return self.resolutions[market_id]
        return "null"

    @gl.public.view
    def is_resolved(self, market_id: str) -> bool:
        return market_id in self.resolutions

    @gl.public.view
    def get_pending(self, market_id: str) -> str:
        if market_id in self.pending:
            return self.pending[market_id]
        return "null"

    # -------------------------
    # Writes
    # -------------------------

    @gl.public.write
    def request_resolution(
        self,
        market_id: str,
        question: str,
        resolution_criteria: str,
        sources: DynArray[str],
    ) -> None:
        """
        Store a pending market resolution request.

        NOTE:
        No timestamps are stored here.
        Any requestedAt/submittedAt/finalizedAt timestamps should live in
        the frontend/backend state, not inside this GenLayer contract.
        """

        if market_id in self.resolutions:
            return

        self.pending[market_id] = json.dumps({
            "question": question,
            "criteria": resolution_criteria,
            "sources": list(sources),
        })

    @gl.public.write
    def resolve_market(
        self,
        market_id: str,
        question: str,
        resolution_criteria: str,
        sources: DynArray[str],
    ) -> None:
        """
        Resolve a market using supplied sources.

        The leader fetches evidence and asks the LLM for a verdict.
        Validators repeat the process and only check that the final boolean
        outcome matches.

        Reasoning text is allowed to differ.
        """

        if market_id in self.resolutions:
            return

        q = question
        rc = resolution_criteria
        src = list(sources)[:5]

        def evaluate() -> dict:
            evidence_parts = []

            for url in src:
                try:
                    page = gl.nondet.web.render(url, mode="text")

                    if len(page) > 3000:
                        snippet = page[:3000]
                    else:
                        snippet = page

                    evidence_parts.append(
                        "SOURCE: " + url + "\n" + snippet
                    )
                except Exception:
                    evidence_parts.append(
                        "SOURCE: " + url + "\n[could not fetch]"
                    )

            if len(evidence_parts) > 0:
                evidence = "\n\n---\n\n".join(evidence_parts)
            else:
                evidence = "[no sources provided]"

            prompt = f"""You are a neutral fact-checker resolving a prediction market.

MARKET QUESTION:
{q}

RESOLUTION CRITERIA:
{rc}

EVIDENCE COLLECTED FROM SOURCES:
{evidence}

Decide whether the market resolves YES or NO.

Return ONLY this JSON object:
{{"outcome": true_or_false, "reasoning": "one short sentence"}}

Rules:
- outcome=true only if the resolution criteria are clearly satisfied.
- outcome=false if the criteria are clearly not satisfied.
- outcome=false if it is too early to tell.
- outcome=false if the evidence is ambiguous or contradictory.
- Use ONLY the supplied evidence.
- Do not use prior knowledge.
- Do not return markdown.
- Do not add any text outside the JSON object.
"""

            result = gl.nondet.exec_prompt(
                prompt,
                response_format="json",
            )

            if not isinstance(result, dict):
                result = {
                    "outcome": False,
                    "reasoning": "invalid LLM response",
                }

            outcome = result.get("outcome", False)

            if isinstance(outcome, str):
                normalized = outcome.strip().upper()
                outcome = normalized in ("YES", "TRUE", "1")

            outcome = bool(outcome)

            reasoning = result.get("reasoning", "")
            reasoning = str(reasoning)[:500]

            return {
                "outcome": outcome,
                "reasoning": reasoning,
            }

        def validator_fn(leader_result) -> bool:
            """
            IMPORTANT:
            GenLayer passes the leader result as gl.vm.Return.
            The real calldata/result is inside leader_result.calldata.
            """

            if not isinstance(leader_result, gl.vm.Return):
                return False

            leader_data = leader_result.calldata

            if not isinstance(leader_data, dict):
                return False

            try:
                validator_result = evaluate()

                if not isinstance(validator_result, dict):
                    return False

                leader_outcome = bool(
                    leader_data.get("outcome", False)
                )

                validator_outcome = bool(
                    validator_result.get("outcome", False)
                )

                return leader_outcome == validator_outcome

            except Exception:
                return False

        resolved = gl.vm.run_nondet_unsafe(
            evaluate,
            validator_fn,
        )

        if not isinstance(resolved, dict):
            resolved = {
                "outcome": False,
                "reasoning": "consensus failure",
            }

        self.resolutions[market_id] = json.dumps({
            "outcome": bool(resolved.get("outcome", False)),
            "reasoning": str(resolved.get("reasoning", ""))[:500],
        })

        if market_id in self.pending:
            del self.pending[market_id]
