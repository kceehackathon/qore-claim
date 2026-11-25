import { QRCodeSVG } from "qrcode.react";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Link, Route, Routes, useNavigate, useParams } from "react-router-dom";

const EXPLORER = "https://explore.qore.network";

interface Claim {
  id: number;
  slug: string;
  itemSlug: string;
  itemLabel: string;
  claimant: string;
  claimantShort: string;
  claimantUrl: string;
  reason: string;
  evidenceHash: string;
  status: "draft" | "open" | "approved" | "rejected";
  createdAt: string;
  anchorTx: string | null;
  anchorUrl: string | null;
  anchoredAt: string | null;
  resolutionTx: string | null;
  resolutionUrl: string | null;
  resolvedAt: string | null;
  anchorMemo: string;
  resolveApprovedMemo: string;
  resolveRejectedMemo: string;
  itemUrl?: string;
}

interface Item {
  id: number;
  slug: string;
  owner: string;
  ownerShort: string;
  ownerUrl: string;
  label: string;
  category: string;
  itemHash: string;
  warrantyEnd: string;
  createdAt: string;
  anchorTx: string | null;
  anchorUrl: string | null;
  anchoredAt: string | null;
  status: "unverified" | "active" | "expired";
  claims: Claim[];
  openClaims: number;
  publicUrl: string;
  anchorMemo: string;
}

interface Health {
  ok: boolean;
  items: number;
  claims: number;
  network: string;
}

interface Recovery {
  slug: string;
  serial: string;
  salt: string;
  itemHash: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed: HTTP ${response.status}`);
  return payload as T;
}

async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function short(value: string, front = 7, back = 5): string {
  if (value.length <= front + back + 1) return value;
  return `${value.slice(0, front)}…${value.slice(-back)}`;
}

function date(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function dateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function itemStatusLabel(status: Item["status"]): string {
  if (status === "unverified") return "not anchored";
  if (status === "expired") return "warranty expired";
  return "anchored";
}

function TopBar() {
  return (
    <header className="topbar">
      <Link className="brand" to="/">
        <span className="brand-mark">QC</span>
        <span>
          Qore<span className="brand-accent">Claim</span>
        </span>
      </Link>
      <nav>
        <a href="/#items">Items</a>
        <a href="/#claims">Claims</a>
        <a href="/#how">How it works</a>
      </nav>
      <Link className="register-link" to="/new">
        Register an item
      </Link>
    </header>
  );
}

function Footer() {
  return (
    <footer>
      <span>QoreClaim · private evidence, public proof · testnet only</span>
      <span>
        Built for <a href="https://build.qorechain.io">Build Before Q-Day</a>
      </span>
    </footer>
  );
}

function MemoBox({
  memo,
  amount = "0.000001 QOR",
  label = "Memo",
}: {
  memo: string;
  amount?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(memo);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="memo-box">
      <div className="memo-head">
        <span>{label}</span>
        <span>{amount}</span>
      </div>
      <code>{memo}</code>
      <button type="button" className="mini-button" onClick={copy}>
        {copied ? "Copied" : "Copy memo"}
      </button>
    </div>
  );
}

function TxVerify({
  path,
  label,
  onDone,
  placeholder = "Paste the transaction hash",
}: {
  path: string;
  label: string;
  onDone: () => void;
  placeholder?: string;
}) {
  const [txHash, setTxHash] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await api<{ verified: boolean; txUrl: string }>(path, {
        method: "POST",
        body: JSON.stringify({ txHash }),
      });
      setSuccess(`Verified on chain. ${result.txUrl}`);
      setTxHash("");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="tx-verify" onSubmit={submit}>
      <label>
        {label}
        <input
          value={txHash}
          onChange={(event) => setTxHash(event.target.value.trim())}
          placeholder={placeholder}
          spellCheck={false}
        />
      </label>
      <button className="button dark" disabled={busy || txHash.length !== 64}>
        {busy ? "Checking chain…" : "Verify"}
      </button>
      {error && <p className="inline-error">{error}</p>}
      {success && <p className="inline-success">{success}</p>}
    </form>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status.replace("-", " ")}</span>;
}

function ItemCard({ item }: { item: Item }) {
  return (
    <Link className="item-card" to={`/item/${item.slug}`}>
      <div className="item-card-top">
        <StatusBadge status={item.status === "unverified" ? "draft" : item.status} />
        <span className="tiny">#{item.slug}</span>
      </div>
      <h3>{item.label}</h3>
      <p className="item-meta">
        {item.category} · warranty to {date(item.warrantyEnd)}
      </p>
      <div className="item-card-foot">
        <span>{item.claims.length} claim{item.claims.length === 1 ? "" : "s"}</span>
        <span>Open file →</span>
      </div>
    </Link>
  );
}

function Home() {
  const [items, setItems] = useState<Item[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [nextItems, nextClaims, nextHealth] = await Promise.all([
        api<Item[]>("/api/items"),
        api<Claim[]>("/api/claims/recent"),
        api<Health>("/api/health"),
      ]);
      setItems(nextItems);
      setClaims(nextClaims);
      setHealth(nextHealth);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 25_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <>
      <TopBar />
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="kicker">Consumer protection · QoreChain Diana</span>
            <h1>
              The receipt stays home.
              <br />
              <span>The proof goes on chain.</span>
            </h1>
            <p>
              QoreClaim lets an owner commit to an item without publishing its serial number, and
              lets a claimant prove an evidence bundle existed at a point in time. The chain stores
              hashes and state; your documents stay yours.
            </p>
            <div className="hero-actions">
              <Link className="button primary" to="/new">
                Register an item
              </Link>
              <a className="button quiet" href="#items">
                Browse the public files
              </a>
            </div>
            <div className="stats">
              <span>
                <strong>{health?.items ?? items.length}</strong> items
              </span>
              <span>
                <strong>{health?.claims ?? claims.length}</strong> claims
              </span>
              <span className="network">
                <span className="live-dot" /> {health?.network ?? "qorechain-diana"}
              </span>
            </div>
          </div>
          <aside className="dossier" aria-hidden="true">
            <div className="dossier-tab">PUBLIC FILE</div>
            <div className="dossier-body">
              <div className="dossier-head">
                <span>QORECLAIM / ITEM RECORD</span>
                <span>#A7C-19</span>
              </div>
              <div className="dossier-title">Field camera, 1978</div>
              <div className="dossier-row">
                <span>Owner</span>
                <code>qor1m…qd2z</code>
              </div>
              <div className="dossier-row">
                <span>Item hash</span>
                <code>9f3c…e81a</code>
              </div>
              <div className="dossier-row">
                <span>Claim</span>
                <code className="coral">EVIDENCE HASH ONLY</code>
              </div>
              <div className="dossier-note">
                Serial number, receipt scan, and claimant statement are not in this file.
              </div>
            </div>
            <div className="dossier-stamp">HYBRID<br />ANCHORED</div>
          </aside>
        </section>

        <section className="how" id="how">
          <span className="kicker">The design rule</span>
          <div className="how-grid">
            <article>
              <span className="step">01</span>
              <h3>Commit, don’t publish</h3>
              <p>
                The browser salts and hashes the serial. Only the hash, label, and warranty date
                reach the app. The serial and salt stay in your recovery note.
              </p>
            </article>
            <article>
              <span className="step">02</span>
              <h3>Anchor with a signature</h3>
              <p>
                A <strong>0.000001 QOR</strong> self-send carries the item memo. QoreX signs it
                classically and with ML-DSA-87; the verifier checks both.
              </p>
            </article>
            <article>
              <span className="step">03</span>
              <h3>Claim and resolve</h3>
              <p>
                A claimant anchors an evidence hash. The owner resolves with an approve or reject
                memo. Every state change has a transaction receipt.
              </p>
            </article>
          </div>
        </section>

        {error && <div className="error-banner">{error}</div>}

        <section className="listing" id="items">
          <div className="section-head">
            <div>
              <span className="kicker">Public index</span>
              <h2>Item files</h2>
            </div>
            <Link className="text-link" to="/new">
              New item →
            </Link>
          </div>
          {items.length === 0 ? (
            <div className="empty">
              <strong>No item files yet.</strong>
              <p>Register the first item and anchor it with a QoreX self-send.</p>
            </div>
          ) : (
            <div className="item-grid">
              {items.map((item) => (
                <ItemCard key={item.slug} item={item} />
              ))}
            </div>
          )}
        </section>

        <section className="listing" id="claims">
          <div className="section-head">
            <div>
              <span className="kicker">Dispute docket</span>
              <h2>Recent claims</h2>
            </div>
            <span className="tiny">{claims.length} public</span>
          </div>
          {claims.length === 0 ? (
            <div className="empty">
              <p>No claims yet. A claim can only be opened after its item is anchored.</p>
            </div>
          ) : (
            <div className="claim-table">
              {claims.map((claim) => (
                <Link className="claim-row" to={`/claim/${claim.slug}`} key={claim.slug}>
                  <StatusBadge status={claim.status} />
                  <div>
                    <strong>{claim.itemLabel}</strong>
                    <span>{claim.reason}</span>
                  </div>
                  <code>{claim.claimantShort}</code>
                  <span className="tiny">{dateTime(claim.createdAt)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <Footer />
    </>
  );
}

function NewItem() {
  const navigate = useNavigate();
  const [owner, setOwner] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("electronics");
  const [warrantyEnd, setWarrantyEnd] = useState(() => {
    const next = new Date(Date.now() + 365 * 86_400_000);
    return next.toISOString().slice(0, 10);
  });
  const [serial, setSerial] = useState("");
  const [salt, setSalt] = useState(randomSalt);
  const [hash, setHash] = useState("");
  const [keepSecret, setKeepSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function computeHash() {
    if (!serial.trim()) {
      setError("Enter the serial or another private identifier first.");
      return;
    }
    const digest = await sha256Hex(`qoreclaim:v1|${serial.trim()}|${salt}`);
    setHash(digest);
  }

  useEffect(() => {
    if (serial.trim()) {
      void sha256Hex(`qoreclaim:v1|${serial.trim()}|${salt}`).then(setHash);
    } else {
      setHash("");
    }
  }, [serial, salt]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!hash) throw new Error("Compute the item hash first.");
      const item = await api<Item>("/api/items", {
        method: "POST",
        body: JSON.stringify({
          owner,
          label,
          category,
          itemHash: hash,
          warrantyEnd: new Date(`${warrantyEnd}T23:59:59`).toISOString(),
          keepSecret,
        }),
      });
      const recovery: Recovery = { slug: item.slug, serial: serial.trim(), salt, itemHash: hash };
      localStorage.setItem(`qoreclaim:item:${item.slug}`, JSON.stringify(recovery));
      navigate(`/item/${item.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function downloadRecovery() {
    const body = JSON.stringify(
      {
        note: "Keep this file private. It is the only way to re-derive your item hash.",
        label,
        owner,
        serial: serial.trim(),
        salt,
        itemHash: hash,
      },
      null,
      2,
    );
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "qoreclaim-recovery.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <TopBar />
      <main className="form-page">
        <Link className="back-link" to="/">
          ← Public index
        </Link>
        <div className="form-layout">
          <div className="form-intro">
            <span className="kicker">New item file</span>
            <h1>Register what you own, without describing it to the internet.</h1>
            <p>
              The app stores a salted hash. Anyone can see the item exists and follow its claims,
              but the serial number and receipt never leave this browser.
            </p>
            <div className="warning-note">
              <strong>Keep the recovery note.</strong> If you lose the serial and salt, you cannot
              reproduce the hash. QoreClaim cannot recover them for you.
            </div>
          </div>

          <form className="file-form" onSubmit={submit}>
            <label>
              Owner address
              <input
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                placeholder="qor1… or 0x…"
                spellCheck={false}
              />
            </label>
            <div className="two-fields">
              <label>
                Item label
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="Field camera, 1978"
                  maxLength={80}
                />
              </label>
              <label>
                Category
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option value="electronics">Electronics</option>
                  <option value="apparel">Apparel</option>
                  <option value="bike">Bike</option>
                  <option value="document">Document</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
            <label>
              Warranty ends
              <input
                type="date"
                value={warrantyEnd}
                onChange={(event) => setWarrantyEnd(event.target.value)}
              />
            </label>
            <label>
              Private serial or identifier
              <input
                value={serial}
                onChange={(event) => setSerial(event.target.value)}
                placeholder="SN-… (stays in this browser)"
                autoComplete="off"
              />
            </label>
            <div className="salt-row">
              <label>
                Salt
                <input value={salt} onChange={(event) => setSalt(event.target.value)} spellCheck={false} />
              </label>
              <button type="button" className="mini-button" onClick={() => setSalt(randomSalt())}>
                New salt
              </button>
            </div>
            <div className="hash-preview">
              <span className="field-label">Public item hash</span>
              <code>{hash || "Enter a serial to compute the hash."}</code>
              {hash && (
                <button type="button" className="mini-button" onClick={() => void navigator.clipboard.writeText(hash)}>
                  Copy
                </button>
              )}
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={keepSecret}
                onChange={(event) => setKeepSecret(event.target.checked)}
              />
              I understand that the serial and salt stay with me, and that only the hash is stored.
            </label>
            {hash && (
              <button type="button" className="text-link inline" onClick={downloadRecovery}>
                Download recovery note
              </button>
            )}
            {error && <div className="inline-error">{error}</div>}
            <button className="button primary" disabled={busy || !hash || !keepSecret}>
              {busy ? "Writing the public file…" : "Create item file"}
            </button>
            <p className="fine-print">
              Creating the file is free. Anchoring it is a separate hybrid-signed QoreX transaction.
            </p>
          </form>
        </div>
      </main>
      <Footer />
    </>
  );
}

function ClaimCard({
  claim,
  item,
  onRefresh,
  expanded = false,
}: {
  claim: Claim;
  item: Item;
  onRefresh: () => void;
  expanded?: boolean;
}) {
  const [resolveDecision, setResolveDecision] = useState<"approve" | "reject">("approve");
  const recovery = useMemo(() => {
    try {
      const raw = localStorage.getItem(`qoreclaim:item:${item.slug}`);
      return raw ? (JSON.parse(raw) as Recovery) : null;
    } catch {
      return null;
    }
  }, [item.slug]);
  const isOwner = recovery?.serial ? localStorage.getItem("qoreclaim:lastOwner") === item.owner : false;

  return (
    <article className={`claim-card ${expanded ? "expanded" : ""}`}>
      <div className="claim-head">
        <div>
          <div className="claim-badges">
            <StatusBadge status={claim.status} />
            <span className="tiny">claim #{claim.slug}</span>
          </div>
          <h3>{claim.reason}</h3>
        </div>
        <div className="claim-person">
          <span>Claimant</span>
          <code title={claim.claimant}>{claim.claimantShort}</code>
        </div>
      </div>
      <div className="claim-meta">
        <span>Opened {dateTime(claim.createdAt)}</span>
        {claim.anchoredAt && <span>Anchored {dateTime(claim.anchoredAt)}</span>}
        {claim.resolvedAt && <span>Resolved {dateTime(claim.resolvedAt)}</span>}
      </div>
      <div className="evidence-line">
        <span className="field-label">Evidence hash</span>
        <code>{claim.evidenceHash}</code>
      </div>

      {claim.status === "draft" && (
        <div className="action-block">
          <div className="action-copy">
            <h4>Anchor this claim</h4>
            <p>
              From <code>{short(claim.claimant, 10, 8)}</code>, self-send{" "}
              <strong>0.000001 QOR</strong> with this memo. Then verify the hash.
            </p>
          </div>
          <MemoBox memo={claim.anchorMemo} />
          <TxVerify path={`/api/claims/${claim.slug}/anchor`} label="Anchor transaction hash" onDone={onRefresh} />
        </div>
      )}

      {claim.status === "open" && (
        <div className="action-block resolve-block">
          <div className="action-copy">
            <h4>Resolve from the owner wallet</h4>
            <p>
              Only <code>{item.ownerShort}</code> can resolve this claim. Pick a decision, copy the
              memo, and send a <strong>0.000001 QOR</strong> self-send.
            </p>
          </div>
          <div className="decision-toggle">
            <button
              type="button"
              className={resolveDecision === "approve" ? "active" : ""}
              onClick={() => setResolveDecision("approve")}
            >
              Approve
            </button>
            <button
              type="button"
              className={resolveDecision === "reject" ? "active" : ""}
              onClick={() => setResolveDecision("reject")}
            >
              Reject
            </button>
          </div>
          <MemoBox
            memo={
              resolveDecision === "approve"
                ? claim.resolveApprovedMemo
                : claim.resolveRejectedMemo
            }
            label={`${resolveDecision} memo`}
          />
          <TxVerify path={`/api/claims/${claim.slug}/resolve`} label="Resolution transaction hash" onDone={onRefresh} />
        </div>
      )}

      {claim.status !== "draft" && (
        <div className="tx-links">
          {claim.anchorUrl && (
            <a href={claim.anchorUrl} target="_blank" rel="noreferrer">
              Claim anchor ↗
            </a>
          )}
          {claim.resolutionUrl && (
            <a href={claim.resolutionUrl} target="_blank" rel="noreferrer">
              Resolution ↗
            </a>
          )}
          <Link to={`/claim/${claim.slug}`}>Permalink</Link>
        </div>
      )}
    </article>
  );
}

function ItemPage() {
  const { slug = "" } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [memo, setMemo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [claimant, setClaimant] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [evidenceHash, setEvidenceHash] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    try {
      const next = await api<Item>(`/api/items/${slug}`);
      setItem(next);
      setMemo(next.anchorMemo);
      document.title = `${next.label} · QoreClaim`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [slug]);

  async function hashEvidence() {
    if (!evidenceNote.trim()) {
      setError("Type or paste the private evidence note first, or choose a file below.");
      return;
    }
    setEvidenceHash(await sha256Hex(`qoreclaim:evidence:v1|${evidenceNote.trim()}`));
  }

  async function hashFile(file: File) {
    setEvidenceHash(await sha256Hex(await file.arrayBuffer()));
  }

  async function openClaim(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const claim = await api<Claim>(`/api/items/${slug}/claims`, {
        method: "POST",
        body: JSON.stringify({ claimant, reason, evidenceHash }),
      });
      setClaimant("");
      setReason("");
      setEvidenceNote("");
      setEvidenceHash("");
      await refresh();
      document.getElementById(`claim-${claim.slug}`)?.scrollIntoView({ behavior: "smooth" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!item && !error) {
    return (
      <>
        <TopBar />
        <main className="center-page">Opening the file…</main>
      </>
    );
  }

  if (!item) {
    return (
      <>
        <TopBar />
        <main className="center-page">
          <div className="error-banner">{error}</div>
          <Link to="/">Back to the index</Link>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="item-page">
        <Link className="back-link" to="/">
          ← Public index
        </Link>
        <header className="item-header">
          <div>
            <div className="item-badges">
              <StatusBadge status={item.status === "unverified" ? "draft" : item.status} />
              <span className="tiny">{item.category} · #{item.slug}</span>
            </div>
            <h1>{item.label}</h1>
            <p className="item-meta">
              Owner <code>{item.ownerShort}</code> · warranty to {date(item.warrantyEnd)} ·{" "}
              {item.openClaims} open claim{item.openClaims === 1 ? "" : "s"}
            </p>
          </div>
          <div className="qr-card">
            <QRCodeSVG value={item.publicUrl} size={104} bgColor="#fbf8f0" fgColor="#172033" level="M" />
            <span className="tiny">Scan to open the public file</span>
          </div>
        </header>

        {error && <div className="error-banner">{error}</div>}

        {item.status === "unverified" && (
          <section className="anchor-panel">
            <div className="anchor-copy">
              <span className="kicker">Step 1 · anchor the file</span>
              <h2>Make the item public without revealing it.</h2>
              <p>
                From the owner address, send <strong>0.000001 QOR</strong> to yourself with the memo
                below. QoreX must sign it hybrid. Then paste the transaction hash.
              </p>
              <div className="hash-block">
                <span className="field-label">Item hash</span>
                <code>{item.itemHash}</code>
              </div>
            </div>
            <div className="anchor-action">
              <MemoBox memo={memo || item.anchorMemo} />
              <TxVerify
                path={`/api/items/${item.slug}/anchor`}
                label="Anchor transaction hash"
                onDone={refresh}
              />
            </div>
          </section>
        )}

        <section className="item-layout">
          <aside className="record">
            <span className="kicker">Public record</span>
            <dl>
              <div>
                <dt>Status</dt>
                <dd>{itemStatusLabel(item.status)}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  <a href={item.ownerUrl} target="_blank" rel="noreferrer">
                    {item.ownerShort} ↗
                  </a>
                </dd>
              </div>
              <div>
                <dt>Warranty end</dt>
                <dd>{date(item.warrantyEnd)}</dd>
              </div>
              <div>
                <dt>Item hash</dt>
                <dd>
                  <code>{item.itemHash}</code>
                </dd>
              </div>
              {item.anchorUrl && (
                <div>
                  <dt>Anchor</dt>
                  <dd>
                    <a href={item.anchorUrl} target="_blank" rel="noreferrer">
                      {item.anchorTx ? short(item.anchorTx, 10, 8) : ""} ↗
                    </a>
                  </dd>
                </div>
              )}
            </dl>
            <p className="tiny">
              Serial, receipt, and claimant evidence are not in this record. Only their hashes are.
            </p>
          </aside>

          <section className="claims-section">
            <div className="section-head">
              <div>
                <span className="kicker">Evidence trail</span>
                <h2>Claims</h2>
              </div>
              <span className="tiny">{item.claims.length} total</span>
            </div>

            {item.status !== "unverified" && (
              <div className="claim-list">
                {item.claims.length === 0 ? (
                  <div className="empty">
                    <p>No claims on this item yet. The warranty is still a clean record.</p>
                  </div>
                ) : (
                  item.claims.map((claim) => (
                    <div id={`claim-${claim.slug}`} key={claim.slug}>
                      <ClaimCard claim={claim} item={item} onRefresh={refresh} />
                    </div>
                  ))
                )}
              </div>
            )}

            {item.status !== "unverified" && item.status !== "expired" && (
              <form className="claim-form" onSubmit={openClaim}>
                <span className="kicker">Open a claim</span>
                <h3>Anchor an evidence hash.</h3>
                <p>
                  Describe the issue in public. Keep the evidence itself private; only its SHA-256
                  hash is stored and anchored.
                </p>
                <label>
                  Claimant address
                  <input
                    value={claimant}
                    onChange={(event) => setClaimant(event.target.value)}
                    placeholder="qor1… or 0x…"
                    spellCheck={false}
                  />
                </label>
                <label>
                  Public reason
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="The left channel stopped working after normal use."
                    rows={3}
                    maxLength={600}
                  />
                </label>
                <label>
                  Private evidence note
                  <textarea
                    value={evidenceNote}
                    onChange={(event) => {
                      setEvidenceNote(event.target.value);
                      setEvidenceHash("");
                    }}
                    placeholder="What happened, who inspected it, reference numbers…"
                    rows={3}
                  />
                </label>
                <div className="evidence-actions">
                  <button type="button" className="mini-button" onClick={() => void hashEvidence()}>
                    Hash note in browser
                  </button>
                  <label className="file-button">
                    Or hash a file
                    <input
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void hashFile(file);
                      }}
                    />
                  </label>
                </div>
                <div className="hash-block">
                  <span className="field-label">Evidence hash</span>
                  <code>{evidenceHash || "No evidence hash yet."}</code>
                </div>
                <button
                  className="button primary"
                  disabled={busy || !evidenceHash || !claimant || reason.trim().length < 12}
                >
                  {busy ? "Opening claim…" : "Create draft claim"}
                </button>
                <p className="fine-print">
                  The claim becomes public only after the claimant anchors it with a hybrid-signed
                  transaction.
                </p>
              </form>
            )}
          </section>
        </section>
      </main>
      <Footer />
    </>
  );
}

function ClaimPage() {
  const { slug = "" } = useParams();
  const [item, setItem] = useState<Item | null>(null);
  const [claim, setClaim] = useState<Claim | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const result = await api<{ item: Item; claim: Claim }>(`/api/claims/${slug}`);
      setItem(result.item);
      setClaim(result.claim);
      document.title = `Claim ${slug} · QoreClaim`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(timer);
  }, [slug]);

  if (!item || !claim) {
    return (
      <>
        <TopBar />
        <main className="center-page">
          {error ? <div className="error-banner">{error}</div> : "Opening the claim…"}
          {error && <Link to="/">Back to the index</Link>}
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="claim-page">
        <Link className="back-link" to={`/item/${item.slug}`}>
          ← {item.label}
        </Link>
        <header className="claim-page-head">
          <span className="kicker">Claim file · #{claim.slug}</span>
          <h1>{claim.itemLabel}</h1>
          <p>
            Claimant <code>{claim.claimantShort}</code> · opened {dateTime(claim.createdAt)}
          </p>
        </header>
        <ClaimCard claim={claim} item={item} onRefresh={refresh} expanded />
      </main>
      <Footer />
    </>
  );
}

function NotFound() {
  return (
    <>
      <TopBar />
      <main className="center-page">
        <h1>File not found.</h1>
        <Link to="/">Back to the public index</Link>
      </main>
      <Footer />
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/new" element={<NewItem />} />
      <Route path="/item/:slug" element={<ItemPage />} />
      <Route path="/claim/:slug" element={<ClaimPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
