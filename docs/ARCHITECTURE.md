# Architecture

## Goal

Let an owner register an item, let a claimant prove a claim, and let a resolver settle it — while publishing only hashes and claim state.

## Components

### ClaimRegistry (Solidity, Diana chain 9800)

- `createItem(bytes32 itemHash, bytes32 evidenceHash, uint64 warrantyEnd)`
- `openClaim(bytes32 itemHash, bytes32 evidenceHash)` payable
- `resolveClaim(bytes32 itemHash, address claimant, bool approved)`
- `getItem(bytes32 itemHash)` and `getClaim(bytes32 itemHash, address claimant)`
- Events for item creation, claim opening, and resolution.

### Web app

- React + Vite + viem/wagmi, scaffolded from `create-qorechain-dapp`.
- Hashes serial numbers and evidence in the browser with a user-supplied salt.
- Shows a public item page and a QR code.
- Connects QoreX for EVM writes through a scoped window.

### Metadata service

- Small Node service for optional labels and evidence pointers.
- Stores no raw evidence by default.
- Returns only public metadata for the item page.

## Flow

1. Owner hashes the item record and calls `createItem`.
2. Owner prints the QR tag / shares the item page.
3. Claimant opens a claim and attaches an evidence hash plus a test-QOR deposit.
4. Owner or resolver calls `resolveClaim`.
5. Contract releases or returns the deposit and emits the final state.
6. The public page reads the contract; no private evidence is exposed.

## Trust boundaries

- The contract cannot verify real-world ownership. It records who made a claim and who resolved it.
- The resolver is a trusted testnet role.
- The metadata service is not trusted for claim state; the contract is.
- Browser hashing is convenience, not proof that the underlying document is authentic.

## Failure modes

- Wrong salt: the item hash will not match. The UI must make this explicit.
- Duplicate item hash: reject at creation.
- Claim after warranty expiry: allowed only if the contract owner enables it; default is reject.
- Resolver unavailable: the owner can resolve; a future version can add a timeout.
