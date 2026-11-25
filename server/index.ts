import { randomBytes } from "node:crypto";
import path from "node:path";
import express from "express";

import { env } from "./env.js";
import {
  countClaims,
  countItems,
  createClaim,
  createItem,
  getItem,
  listClaims,
  listItems,
  type Claim,
  type Item,
} from "./db.js";
import { explorerAddressUrl, explorerTxUrl, normalizeAddress, shortAddress } from "./qore.js";
import {
  ClaimError,
  getClaimOrThrow,
  getItemOrThrow,
  verifyClaimAnchor,
  verifyItemAnchor,
  verifyResolution,
} from "./verify.js";

const app = express();
app.use(express.json({ limit: "64kb" }));

const CATEGORIES = new Set(["electronics", "apparel", "bike", "document", "other"]);

function newSlug(): string {
  return randomBytes(5).toString("hex");
}

function secureUrl(pathname: string): string {
  return `${process.env.PUBLIC_BASE_URL ?? "http://localhost:5175"}${pathname}`;
}

function itemView(item: Item) {
  return {
    ...item,
    ownerShort: shortAddress(item.owner),
    ownerUrl: explorerAddressUrl(item.owner),
    anchorUrl: item.anchorTx ? explorerTxUrl(item.anchorTx) : null,
    publicUrl: secureUrl(`/item/${item.slug}`),
    anchorMemo: `qoreclaim:item:${item.slug}:${item.itemHash}:${Math.floor(new Date(item.warrantyEnd).getTime() / 1000)}`,
    claims: item.claims.map((claim) => claimView(claim)),
  };
}

function claimView(claim: Claim) {
  return {
    ...claim,
    claimantShort: shortAddress(claim.claimant),
    claimantUrl: explorerAddressUrl(claim.claimant),
    anchorUrl: claim.anchorTx ? explorerTxUrl(claim.anchorTx) : null,
    resolutionUrl: claim.resolutionTx ? explorerTxUrl(claim.resolutionTx) : null,
    anchorMemo: `qoreclaim:claim:${claim.itemSlug}:${claim.slug}:${claim.evidenceHash}`,
    resolveApprovedMemo: `qoreclaim:resolve:${claim.slug}:approve`,
    resolveRejectedMemo: `qoreclaim:resolve:${claim.slug}:reject`,
  };
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    network: env.network,
    chainId: env.chainId,
    restUrl: env.restUrl,
    items: countItems(),
    claims: countClaims(),
    now: new Date().toISOString(),
  });
});

app.get("/api/items", (_req, res) => {
  res.json(listItems().map(itemView));
});

app.get("/api/items/:slug", (req, res) => {
  const item = getItem(req.params.slug);
  if (!item) {
    res.status(404).json({ error: "Item not found." });
    return;
  }
  res.json(itemView(item));
});

app.post("/api/items", (req, res) => {
  const body = req.body as {
    owner?: string;
    label?: string;
    category?: string;
    itemHash?: string;
    warrantyEnd?: string;
    keepSecret?: boolean;
  };
  const owner = normalizeAddress(String(body.owner ?? ""));
  if (!owner) {
    res.status(400).json({ error: "Enter a valid qor1… or 0x… owner address." });
    return;
  }
  const label = String(body.label ?? "").trim();
  if (label.length < 3 || label.length > 80) {
    res.status(400).json({ error: "Item label must be 3–80 characters." });
    return;
  }
  const category = String(body.category ?? "other");
  if (!CATEGORIES.has(category)) {
    res.status(400).json({ error: "Choose a valid category." });
    return;
  }
  const itemHash = String(body.itemHash ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(itemHash)) {
    res.status(400).json({ error: "Item hash must be a 64-character SHA-256 hex digest." });
    return;
  }
  const warrantyEnd = new Date(String(body.warrantyEnd ?? ""));
  if (!Number.isFinite(warrantyEnd.getTime())) {
    res.status(400).json({ error: "Choose a valid warranty end date." });
    return;
  }
  if (warrantyEnd.getTime() < Date.now() - 86_400_000) {
    res.status(400).json({ error: "Warranty end cannot be in the past." });
    return;
  }
  if (warrantyEnd.getTime() > Date.now() + 40 * 365 * 86_400_000) {
    res.status(400).json({ error: "Warranty end must be within 40 years." });
    return;
  }
  if (!body.keepSecret) {
    res.status(400).json({
      error: "Confirm that the serial number and salt stay with you before creating the item.",
    });
    return;
  }
  const item = createItem({
    slug: newSlug(),
    owner: owner.address,
    label,
    category,
    itemHash,
    warrantyEnd: warrantyEnd.toISOString(),
  });
  res.status(201).json(itemView(item));
});

app.post("/api/items/:slug/anchor", async (req, res) => {
  const body = req.body as { txHash?: string };
  try {
    const result = await verifyItemAnchor(req.params.slug, String(body.txHash ?? ""));
    res.json({
      verified: true,
      item: itemView(result.item),
      txUrl: explorerTxUrl(result.tx.hash),
    });
  } catch (error) {
    if (error instanceof ClaimError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("item anchor failed:", error);
    res.status(500).json({ error: "Could not verify the anchor." });
  }
});

app.post("/api/items/:slug/claims", (req, res) => {
  const item = getItem(req.params.slug);
  if (!item) {
    res.status(404).json({ error: "Item not found." });
    return;
  }
  if (!item.anchorTx) {
    res.status(409).json({ error: "The owner must anchor the item before claims can be opened." });
    return;
  }
  const body = req.body as {
    claimant?: string;
    reason?: string;
    evidenceHash?: string;
  };
  const claimant = normalizeAddress(String(body.claimant ?? ""));
  if (!claimant) {
    res.status(400).json({ error: "Enter a valid qor1… or 0x… claimant address." });
    return;
  }
  const reason = String(body.reason ?? "").trim();
  if (reason.length < 12 || reason.length > 600) {
    res.status(400).json({ error: "Explain the claim in 12–600 characters." });
    return;
  }
  const evidenceHash = String(body.evidenceHash ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(evidenceHash)) {
    res.status(400).json({ error: "Evidence hash must be a 64-character SHA-256 hex digest." });
    return;
  }
  const claim = createClaim({
    slug: newSlug(),
    itemId: item.id,
    claimant: claimant.address,
    reason,
    evidenceHash,
  });
  res.status(201).json(claimView(claim));
});

app.get("/api/claims/:slug", (req, res) => {
  try {
    const { claim, item } = getClaimOrThrow(req.params.slug);
    res.json({ claim: claimView(claim), item: itemView(item) });
  } catch (error) {
    if (error instanceof ClaimError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Could not load the claim." });
  }
});

app.post("/api/claims/:slug/anchor", async (req, res) => {
  const body = req.body as { txHash?: string };
  try {
    const result = await verifyClaimAnchor(req.params.slug, String(body.txHash ?? ""));
    res.json({
      verified: true,
      claim: claimView(result.claim),
      item: itemView(result.item),
      txUrl: explorerTxUrl(result.tx.hash),
    });
  } catch (error) {
    if (error instanceof ClaimError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("claim anchor failed:", error);
    res.status(500).json({ error: "Could not verify the claim anchor." });
  }
});

app.post("/api/claims/:slug/resolve", async (req, res) => {
  const body = req.body as { txHash?: string };
  try {
    const result = await verifyResolution(req.params.slug, String(body.txHash ?? ""));
    res.json({
      verified: true,
      claim: claimView(result.claim),
      item: itemView(result.item),
      txUrl: explorerTxUrl(result.tx.hash),
    });
  } catch (error) {
    if (error instanceof ClaimError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    console.error("claim resolution failed:", error);
    res.status(500).json({ error: "Could not verify the resolution." });
  }
});

app.get("/api/claims/recent", (req, res) => {
  const limit = Number(req.query.limit ?? 25);
  res.json(
    listClaims(Number.isFinite(limit) ? limit : 25).map((claim) => ({
      ...claimView(claim),
      itemUrl: `/item/${claim.itemSlug}`,
    })),
  );
});

app.get("/api/memos/:claimSlug", (req, res) => {
  try {
    const { claim } = getClaimOrThrow(req.params.claimSlug);
    res.json({
      claimSlug: claim.slug,
      approve: claimView(claim).resolveApprovedMemo,
      reject: claimView(claim).resolveRejectedMemo,
      amount: "0.000001 QOR",
    });
  } catch (error) {
    if (error instanceof ClaimError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Could not build the memo." });
  }
});

app.get("/api/items/:slug/memo", (req, res) => {
  try {
    const item = getItemOrThrow(req.params.slug);
    res.json({
      memo: itemView(item).anchorMemo,
      amount: "0.000001 QOR",
      anchored: Boolean(item.anchorTx),
    });
  } catch (error) {
    if (error instanceof ClaimError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Could not build the memo." });
  }
});

app.get("/api/claims/:slug/memo", (req, res) => {
  try {
    const { claim } = getClaimOrThrow(req.params.slug);
    res.json({
      claimMemo: claimView(claim).anchorMemo,
      approveMemo: claimView(claim).resolveApprovedMemo,
      rejectMemo: claimView(claim).resolveRejectedMemo,
      amount: "0.000001 QOR",
    });
  } catch (error) {
    if (error instanceof ClaimError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Could not build the memo." });
  }
});

const dist = path.resolve(process.cwd(), "dist");
app.use(express.static(dist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(dist, "index.html"), (error) => {
    if (error) next();
  });
});

app.listen(env.port, () => {
  console.log(`QoreClaim API on http://localhost:${env.port} (${env.network})`);
});
