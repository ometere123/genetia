# Proposal identity and bond boundary

The proposal identity is a SHA-256 digest represented as a lowercase `0x` +
64-hex-character value. Its canonical UTF-8 preimage is deterministic JSON:

```json
{"proposal":<canonical proposal object>,"proposer":"0x..."}
```

Object keys are sorted lexicographically, arrays retain their declared order,
integers are represented as JSON integers, and no insignificant whitespace is
included. The proposer is lowercased before hashing. The proposal object
includes its `idempotencyKey`; this makes the bond, proposal record, GenLayer
admissibility operation, and eventual market lineage share one identity. The
same idempotency key with a different canonical proposal body is therefore a
conflict, not a second proposal.

The creator first calls `POST /api/market-proposals/prepare-bond`. The response
contains the exact Base Sepolia (84532) `ProposalBondEscrow.lock(bytes32,address)`
calldata and the separate USDC approval requirement for the fixed 2 USDC
(2,000,000 micro-USDC) bond. The user-owned wallet signs both transactions as
needed. `POST /api/market-proposals` accepts the resulting transaction hash
only after the backend verifies a successful Base receipt, the configured
escrow, the canonical `BondLocked` event, and the exact 2 USDC transfer from
the proposer to escrow. A client boolean or database row is never sufficient.

The default API service fails closed after verification until a durable proposal
workflow binding is configured. Tests inject that binding to prove the route
contract without treating a mock as a production financial success.

The durable repository writes the proposal projection and a
`WorkflowState` outbox intent in one PostgreSQL transaction. A dispatcher may
deliver that intent to the Cloudflare Queue repeatedly; the deterministic
`admissibility:<proposalId>` key makes delivery idempotent. If queue delivery
fails after the database transaction commits, reconciliation scans undispatched
workflow intents and resends them. Queue acknowledgement is never treated as
financial completion.
