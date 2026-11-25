import { describe, expect, it } from "vitest";

import { parseClaimMemo, parseItemMemo, parseResolutionMemo } from "./verify.js";

const HASH = "a".repeat(64);

describe("QoreClaim memo parsing", () => {
  it("parses an item anchor memo", () => {
    expect(parseItemMemo(`qoreclaim:item:abc123def4:${HASH}:1798761599`)).toEqual({
      itemSlug: "abc123def4",
      itemHash: HASH,
      warrantyEnd: 1798761599,
    });
  });

  it("parses a claim anchor memo", () => {
    expect(parseClaimMemo(`qoreclaim:claim:abc123def4:ffeeddccbb:${HASH}`)).toEqual({
      itemSlug: "abc123def4",
      claimSlug: "ffeeddccbb",
      evidenceHash: HASH,
    });
  });

  it("parses an approve resolution memo", () => {
    expect(parseResolutionMemo("qoreclaim:resolve:ffeeddccbb:approve")).toEqual({
      claimSlug: "ffeeddccbb",
      decision: "approve",
    });
  });

  it("rejects an unknown resolution decision", () => {
    expect(parseResolutionMemo("qoreclaim:resolve:ffeeddccbb:maybe")).toBeNull();
  });

  it("rejects a truncated evidence hash", () => {
    expect(parseClaimMemo(`qoreclaim:claim:abc123def4:ffeeddccbb:${"a".repeat(63)}`)).toBeNull();
  });
});
