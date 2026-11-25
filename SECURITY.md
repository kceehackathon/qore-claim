# Security policy

## Scope

QoreClaim is a testnet-only prototype. It does not custody real funds and it must never ask for a seed phrase, private key, or QoreX recovery phrase.

## Reporting a vulnerability

Open a private security advisory on GitHub, or contact the maintainer through the project page. Do not publish an exploitable issue before it has been acknowledged.

## Operational rules

- Keep `.env` out of git. Only `.env.example` is committed.
- Treat item hashes and claim evidence as sensitive. Only hashes belong on chain.
- Do not store personal data in the public contract.
- Use a salted hash for low-entropy serial numbers.
- Review the contract before every deployment; test on Diana first.
- Rotate any credential that is accidentally committed or shared.

## Known limitations

- The resolver is a testnet role, not a legal arbitrator.
- A hash commitment can be guessed if the underlying value has low entropy. The UI must warn users.
- Test QOR deposits have no monetary value.
