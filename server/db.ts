import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

import { env } from "./env.js";

fs.mkdirSync(path.dirname(env.databaseUrl), { recursive: true });

export const db = new Database(env.databaseUrl);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    item_hash TEXT NOT NULL,
    warranty_end TEXT NOT NULL,
    created_at TEXT NOT NULL,
    anchor_tx TEXT UNIQUE,
    anchored_at TEXT
  );

  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    claimant TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TEXT NOT NULL,
    anchor_tx TEXT UNIQUE,
    anchored_at TEXT,
    resolution_tx TEXT UNIQUE,
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS claims_item ON claims(item_id, id DESC);
`);

export interface Claim {
  id: number;
  slug: string;
  itemSlug: string;
  itemLabel: string;
  claimant: string;
  reason: string;
  evidenceHash: string;
  status: "draft" | "open" | "approved" | "rejected";
  createdAt: string;
  anchorTx: string | null;
  anchoredAt: string | null;
  resolutionTx: string | null;
  resolvedAt: string | null;
}

export interface Item {
  id: number;
  slug: string;
  owner: string;
  label: string;
  category: string;
  itemHash: string;
  warrantyEnd: string;
  createdAt: string;
  anchorTx: string | null;
  anchoredAt: string | null;
  status: "unverified" | "active" | "expired";
  claims: Claim[];
  openClaims: number;
}

interface ItemRow {
  id: number;
  slug: string;
  owner: string;
  label: string;
  category: string;
  item_hash: string;
  warranty_end: string;
  created_at: string;
  anchor_tx: string | null;
  anchored_at: string | null;
}

interface ClaimRow {
  id: number;
  slug: string;
  item_slug: string;
  item_label: string;
  claimant: string;
  reason: string;
  evidence_hash: string;
  status: "draft" | "open" | "approved" | "rejected";
  created_at: string;
  anchor_tx: string | null;
  anchored_at: string | null;
  resolution_tx: string | null;
  resolved_at: string | null;
}

function mapClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    slug: row.slug,
    itemSlug: row.item_slug,
    itemLabel: row.item_label,
    claimant: row.claimant,
    reason: row.reason,
    evidenceHash: row.evidence_hash,
    status: row.status,
    createdAt: row.created_at,
    anchorTx: row.anchor_tx,
    anchoredAt: row.anchored_at,
    resolutionTx: row.resolution_tx,
    resolvedAt: row.resolved_at,
  };
}

function claimSelect(where: string): string {
  return `SELECT c.id, c.slug, i.slug AS item_slug, i.label AS item_label,
                 c.claimant, c.reason, c.evidence_hash, c.status, c.created_at,
                 c.anchor_tx, c.anchored_at, c.resolution_tx, c.resolved_at
          FROM claims c JOIN items i ON i.id = c.item_id
          WHERE ${where}`;
}

function claimsFor(itemId: number): Claim[] {
  const rows = db
    .prepare(`${claimSelect("c.item_id = ?")} ORDER BY c.created_at DESC`)
    .all(itemId) as ClaimRow[];
  return rows.map(mapClaim);
}

function mapItem(row: ItemRow, claims: Claim[]): Item {
  return {
    id: row.id,
    slug: row.slug,
    owner: row.owner,
    label: row.label,
    category: row.category,
    itemHash: row.item_hash,
    warrantyEnd: row.warranty_end,
    createdAt: row.created_at,
    anchorTx: row.anchor_tx,
    anchoredAt: row.anchored_at,
    status: !row.anchor_tx
      ? "unverified"
      : Date.now() > new Date(row.warranty_end).getTime()
        ? "expired"
        : "active",
    claims,
    openClaims: claims.filter((claim) => claim.status === "open").length,
  };
}

export function createItem(input: {
  slug: string;
  owner: string;
  label: string;
  category: string;
  itemHash: string;
  warrantyEnd: string;
}): Item {
  db.prepare(
    `INSERT INTO items (slug, owner, label, category, item_hash, warranty_end, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.slug,
    input.owner,
    input.label,
    input.category,
    input.itemHash,
    input.warrantyEnd,
    new Date().toISOString(),
  );
  return getItem(input.slug)!;
}

export function getItem(slug: string): Item | undefined {
  const row = db.prepare("SELECT * FROM items WHERE slug = ?").get(slug) as ItemRow | undefined;
  if (!row) return undefined;
  return mapItem(row, claimsFor(row.id));
}

export function listItems(): Item[] {
  const rows = db.prepare("SELECT * FROM items ORDER BY created_at DESC").all() as ItemRow[];
  return rows.map((row) => mapItem(row, claimsFor(row.id)));
}

export function anchorItem(slug: string, txHash: string, anchoredAt: string): Item | undefined {
  const result = db
    .prepare("UPDATE items SET anchor_tx = ?, anchored_at = ? WHERE slug = ? AND anchor_tx IS NULL")
    .run(txHash, anchoredAt, slug);
  if (result.changes === 0) return undefined;
  return getItem(slug);
}

export function createClaim(input: {
  slug: string;
  itemId: number;
  claimant: string;
  reason: string;
  evidenceHash: string;
}): Claim {
  db.prepare(
    `INSERT INTO claims (slug, item_id, claimant, reason, evidence_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'draft', ?)`,
  ).run(
    input.slug,
    input.itemId,
    input.claimant,
    input.reason,
    input.evidenceHash,
    new Date().toISOString(),
  );
  return getClaim(input.slug)!;
}

export function getClaim(slug: string): Claim | undefined {
  const row = db.prepare(claimSelect("c.slug = ?")).get(slug) as ClaimRow | undefined;
  return row ? mapClaim(row) : undefined;
}

export function getClaimWithItem(slug: string): { claim: Claim; item: Item } | undefined {
  const claim = getClaim(slug);
  if (!claim) return undefined;
  const item = getItem(claim.itemSlug);
  return item ? { claim, item } : undefined;
}

export function listClaims(limit = 30): Claim[] {
  const rows = db
    .prepare(`${claimSelect("1 = 1")} ORDER BY c.created_at DESC LIMIT ?`)
    .all(Math.min(Math.max(limit, 1), 100)) as ClaimRow[];
  return rows.map(mapClaim);
}

export function anchorClaim(slug: string, txHash: string, anchoredAt: string): Claim | undefined {
  const result = db
    .prepare(
      "UPDATE claims SET anchor_tx = ?, anchored_at = ?, status = 'open' WHERE slug = ? AND anchor_tx IS NULL AND status = 'draft'",
    )
    .run(txHash, anchoredAt, slug);
  if (result.changes === 0) return undefined;
  return getClaim(slug);
}

export function resolveClaim(
  slug: string,
  decision: "approve" | "reject",
  txHash: string,
  resolvedAt: string,
): Claim | undefined {
  const result = db
    .prepare(
      `UPDATE claims
       SET status = ?, resolution_tx = ?, resolved_at = ?
       WHERE slug = ? AND status = 'open'`,
    )
    .run(decision === "approve" ? "approved" : "rejected", txHash, resolvedAt, slug);
  if (result.changes === 0) return undefined;
  return getClaim(slug);
}

export function countItems(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM items").get() as { n: number }).n;
}

export function countClaims(): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM claims").get() as { n: number }).n;
}
