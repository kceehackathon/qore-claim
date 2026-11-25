import {
  anchorClaim,
  anchorItem,
  getClaim,
  getClaimWithItem,
  getItem,
  resolveClaim,
  type Claim,
  type Item,
} from "./db.js";
import { getDecodedTx, messageType, type DecodedTx } from "./qore.js";

export class ClaimError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "ClaimError";
  }
}

export interface ItemMemo {
  itemSlug: string;
  itemHash: string;
  warrantyEnd: number;
}

export interface ClaimMemo {
  itemSlug: string;
  claimSlug: string;
  evidenceHash: string;
}

export interface ResolutionMemo {
  claimSlug: string;
  decision: "approve" | "reject";
}

export function parseItemMemo(memo: string): ItemMemo | null {
  const match = memo.trim().match(/^qoreclaim:item:([a-z0-9]{6,16}):([0-9a-f]{64}):(\d{10,13})$/);
  if (!match) return null;
  return {
    itemSlug: match[1]!,
    itemHash: match[2]!,
    warrantyEnd: Number(match[3]),
  };
}

export function parseClaimMemo(memo: string): ClaimMemo | null {
  const match = memo
    .trim()
    .match(/^qoreclaim:claim:([a-z0-9]{6,16}):([a-z0-9]{6,16}):([0-9a-f]{64})$/);
  if (!match) return null;
  return {
    itemSlug: match[1]!,
    claimSlug: match[2]!,
    evidenceHash: match[3]!,
  };
}

export function parseResolutionMemo(memo: string): ResolutionMemo | null {
  const match = memo.trim().match(/^qoreclaim:resolve:([a-z0-9]{6,16}):(approve|reject)$/);
  if (!match) return null;
  return { claimSlug: match[1]!, decision: match[2] as "approve" | "reject" };
}

async function mustDecoded(hash: string): Promise<DecodedTx> {
  const normalized = hash.trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(normalized)) {
    throw new ClaimError("Enter a 64-character transaction hash.");
  }
  let tx: DecodedTx | null = null;
  try {
    tx = await getDecodedTx(normalized);
  } catch {
    throw new ClaimError("QoreChain REST is temporarily unavailable. Try again.", 503);
  }
  if (!tx) throw new ClaimError("Transaction not found on the Diana testnet.", 404);
  if (tx.code !== 0) throw new ClaimError(`Transaction failed with code ${tx.code}.`);
  if (!tx.isHybrid) {
    throw new ClaimError("This transaction is not hybrid-signed. QoreClaim requires ML-DSA-87 + secp256k1.");
  }
  return tx;
}

function selfSender(tx: DecodedTx): string {
  if (tx.messages.length !== 1) {
    throw new ClaimError("The anchor must be a single-message transaction.");
  }
  const message = tx.messages[0]!;
  if (!messageType(message).endsWith("MsgSend")) {
    throw new ClaimError("The anchor must be a native bank send.");
  }
  const from = String(message.from_address ?? "");
  const to = String(message.to_address ?? "");
  if (!from || from !== to) {
    throw new ClaimError("The anchor must be a self-send: from and to must match.");
  }
  const amount = Array.isArray(message.amount) ? message.amount : [];
  const oneUqor = amount.some((coin) => {
    const entry = coin as { denom?: string; amount?: string };
    return entry.denom === "uqor" && String(entry.amount) === "1";
  });
  if (amount.length !== 1 || !oneUqor) {
    throw new ClaimError("The anchor must send exactly 0.000001 QOR (1 uqor) to yourself.");
  }
  return from;
}

export async function verifyItemAnchor(
  itemSlug: string,
  rawHash: string,
): Promise<{ item: Item; tx: DecodedTx }> {
  const item = getItem(itemSlug);
  if (!item) throw new ClaimError("Item not found.", 404);
  if (item.anchorTx) {
    const tx = await mustDecoded(item.anchorTx);
    return { item, tx };
  }
  const tx = await mustDecoded(rawHash);
  const memo = parseItemMemo(tx.memo);
  if (!memo) {
    throw new ClaimError("Memo must look like qoreclaim:item:<itemId>:<hash>:<warrantyEnd>.");
  }
  if (memo.itemSlug !== item.slug) throw new ClaimError("That memo anchors a different item.");
  if (memo.itemHash !== item.itemHash) {
    throw new ClaimError("The item hash in the memo does not match this item.");
  }
  if (memo.warrantyEnd !== Math.floor(new Date(item.warrantyEnd).getTime() / 1000)) {
    throw new ClaimError("The warranty end in the memo does not match this item.");
  }
  const sender = selfSender(tx);
  if (sender !== item.owner) {
    throw new ClaimError("Only the item owner can anchor this item.");
  }
  const anchored = anchorItem(item.slug, tx.hash, tx.timestamp);
  if (!anchored) throw new ClaimError("This item was already anchored.", 409);
  return { item: anchored, tx };
}

export async function verifyClaimAnchor(
  claimSlug: string,
  rawHash: string,
): Promise<{ claim: Claim; item: Item; tx: DecodedTx }> {
  const found = getClaimWithItem(claimSlug);
  if (!found) throw new ClaimError("Claim not found.", 404);
  if (found.claim.anchorTx) {
    const tx = await mustDecoded(found.claim.anchorTx);
    return { ...found, tx };
  }
  if (!found.item.anchorTx) {
    throw new ClaimError("The item must be anchored before a claim can be opened.", 409);
  }
  const tx = await mustDecoded(rawHash);
  const memo = parseClaimMemo(tx.memo);
  if (!memo) {
    throw new ClaimError("Memo must look like qoreclaim:claim:<itemId>:<claimId>:<evidenceHash>.");
  }
  if (memo.itemSlug !== found.item.slug || memo.claimSlug !== found.claim.slug) {
    throw new ClaimError("That memo anchors a different claim.");
  }
  if (memo.evidenceHash !== found.claim.evidenceHash) {
    throw new ClaimError("The evidence hash in the memo does not match this claim.");
  }
  const sender = selfSender(tx);
  if (sender !== found.claim.claimant) {
    throw new ClaimError("Only the claimant can anchor this claim.");
  }
  const anchored = anchorClaim(found.claim.slug, tx.hash, tx.timestamp);
  if (!anchored) throw new ClaimError("This claim was already anchored.", 409);
  return { claim: anchored, item: getItem(found.item.slug)!, tx };
}

export async function verifyResolution(
  claimSlug: string,
  rawHash: string,
): Promise<{ claim: Claim; item: Item; tx: DecodedTx }> {
  const found = getClaimWithItem(claimSlug);
  if (!found) throw new ClaimError("Claim not found.", 404);
  if (found.claim.status !== "open") {
    throw new ClaimError("Only an open claim can be resolved.", 409);
  }
  const tx = await mustDecoded(rawHash);
  const memo = parseResolutionMemo(tx.memo);
  if (!memo) {
    throw new ClaimError("Memo must look like qoreclaim:resolve:<claimId>:<approve|reject>.");
  }
  if (memo.claimSlug !== found.claim.slug) throw new ClaimError("That memo resolves a different claim.");
  const sender = selfSender(tx);
  if (sender !== found.item.owner) {
    throw new ClaimError("Only the item owner can resolve this claim.");
  }
  const resolved = resolveClaim(found.claim.slug, memo.decision, tx.hash, tx.timestamp);
  if (!resolved) throw new ClaimError("This claim could not be resolved.", 409);
  return { claim: resolved, item: getItem(found.item.slug)!, tx };
}

export function getClaimOrThrow(slug: string): { claim: Claim; item: Item } {
  const found = getClaimWithItem(slug);
  if (!found) throw new ClaimError("Claim not found.", 404);
  return found;
}

export function getItemOrThrow(slug: string): Item {
  const item = getItem(slug);
  if (!item) throw new ClaimError("Item not found.", 404);
  return item;
}
