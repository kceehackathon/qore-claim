# QoreClaim

**Prove what's yours — without putting the receipt on chain.**

QoreClaim is a post-quantum claim registry for lost items, warranties, and ownership disputes on QoreChain. The public chain stores hashes and claim state; the private evidence stays with the people who need it. A QR tag on the item opens its public claim page, and every state change is authorised by a hybrid-signed transaction.

> **Status:** early scaffold. The repository, licence, architecture, and scope are in place. The Solidity registry, web app, and testnet deployment are being built for the Build Before Q-Day deadline (2 December 2026, 23:59 UTC).

## The problem

Lost-item and warranty claims still rely on screenshots, email threads, and a central support inbox. The claimant cannot prove that the evidence existed when it was submitted, and a buyer cannot check whether an item is already the subject of a claim. Publishing the receipt, serial number, or personal details to a public chain makes the problem worse.

QoreClaim separates **proof** from **private evidence**:

- the chain stores a hash of the item record and the claim record;
- the evidence itself stays off chain;
- every claim action is signed with QoreChain's hybrid secp256k1 + ML-DSA-87 transaction format;
- a public page shows the claim status without exposing the evidence.

## Planned MVP

1. **Register an item.** Hash a serial number, receipt, or photo bundle in the browser. Store only the hash, warranty end date, and owner address.
2. **Attach a QR tag.** The item page and QR code point to the public claim record.
3. **Open a claim.** The claimant submits an evidence hash and an optional small QOR deposit.
4. **Resolve a claim.** The owner or a designated resolver approves or rejects it; the deposit is released or returned.
5. **Verify publicly.** Anyone can look up the item hash and see its current state and history.
6. **Prove it on testnet.** One complete item → claim → resolution flow with real Diana transactions and explorer links.

## Why QoreChain

| Feature | Use |
|---|---|
| Hybrid ML-DSA-87 transactions | Claim creation and resolution are authorised by both secp256k1 and ML-DSA-87 signatures |
| EVM lane (`0x`, chain ID 9800) | `ClaimRegistry` contract and event history |
| PQC key status | The registry can require the resolver to have a registered ML-DSA-87 key |
| QoreX | Users sign the EVM transactions through their QoreX wallet |
| Test tokens | fUSD/fETH/fBTC available for contract tests and optional deposits |

## Architecture

```text
Browser (React + viem/wagmi)
   │  item hash, evidence hash, QR page
   ▼
QoreClaim web app ───► ClaimRegistry.sol (Diana, chain 9800)
   │                         │
   │                         └── events → public timeline
   ▼
SQLite metadata (labels, contact opt-in, evidence pointer)
```

Only hashes and public addresses belong on chain. Personal data is never written to the contract.

## Contract sketch

```solidity
struct Item {
    address owner;
    bytes32 itemHash;
    bytes32 evidenceHash;
    uint64 warrantyEnd;
    bool exists;
}

struct Claim {
    address claimant;
    bytes32 evidenceHash;
    uint64 openedAt;
    uint8 status; // 0 open, 1 approved, 2 rejected
}
```

The exact ABI will be published in [`contracts/`](contracts/) once the first version is deployed.

## Quickstart

> The app is not runnable yet. Setup instructions will be added as the scaffold lands.

```bash
git clone https://github.com/kceehackathon/qore-claim.git
cd qore-claim
cp .env.example .env
npm install
npm run dev
```

## Testnet addresses

| Purpose | Address |
|---|---|
| ClaimRegistry (Diana) | _to be deployed_ |
| Demo item / claim | _to be added_ |

## Demo video

_To be recorded before submission._

## Security and limitations

- Testnet only (`qorechain-diana`, EVM chain ID `9800`).
- Hashes are commitments, not encryption. A low-entropy serial number can be guessed; the UI will warn users and offer a salted hash.
- The resolver is a testnet role, not a legal arbitrator.
- Deposits are test QOR only and have no monetary value.
- The public page never displays private evidence.

## Licence

MIT. See [LICENSE](LICENSE).

## AI usage

See [AI_USAGE.md](AI_USAGE.md).

## Team

- Kcee Hackathon — [@kceehackathon](https://github.com/kceehackathon)
