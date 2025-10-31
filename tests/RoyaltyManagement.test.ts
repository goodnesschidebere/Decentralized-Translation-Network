// RoyaltyManagement.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 100;
const ERR_REQUEST_NOT_FOUND = 101;
const ERR_ALREADY_DISTRIBUTED = 103;
const ERR_INSUFFICIENT_ROYALTY = 104;
const ERR_DISTRIBUTION_LOCKED = 107;

interface Distribution {
  "request-id": bigint;
  "total-amount": bigint;
  "translator-share": bigint;
  "verifier-share": bigint;
  "creator-share": bigint;
  "platform-share": bigint;
  distributed: boolean;
  timestamp: bigint;
}

class RoyaltyManagementMock {
  state: {
    royaltyNonce: bigint;
    platformFeeRate: bigint;
    distributionLock: boolean;
    distributions: Map<bigint, Distribution>;
    userRoyalties: Map<string, bigint>;
    requestRoyalties: Map<bigint, bigint>;
    stxTransfers: Array<{ amount: bigint; from: string; to: string }>;
    platformWallet: string;
  } = {
    royaltyNonce: 0n,
    platformFeeRate: 500n,
    distributionLock: false,
    distributions: new Map(),
    userRoyalties: new Map(),
    requestRoyalties: new Map(),
    stxTransfers: [],
    platformWallet: "STPLATFORM",
  };
  caller: string = "STCORE";
  blockHeight: bigint = 300n;
  contractPrincipal: string = "STROYALTY";

  reset() {
    this.state = {
      royaltyNonce: 0n,
      platformFeeRate: 500n,
      distributionLock: false,
      distributions: new Map(),
      userRoyalties: new Map(),
      requestRoyalties: new Map(),
      stxTransfers: [],
      platformWallet: "STPLATFORM",
    };
    this.caller = "STCORE";
    this.blockHeight = 300n;
  }

  initiateRoyaltyDistribution(
    requestId: bigint,
    totalAmount: bigint,
    translator: string,
    verifiers: string[]
  ): { ok: boolean; value: bigint | number } {
    if (this.caller !== this.contractPrincipal)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (this.state.requestRoyalties.has(requestId))
      return { ok: false, value: ERR_ALREADY_DISTRIBUTED };
    if (totalAmount <= 0n)
      return { ok: false, value: ERR_INSUFFICIENT_ROYALTY };

    const platformShare = (totalAmount * this.state.platformFeeRate) / 10000n;
    const remaining = totalAmount - platformShare;
    const translatorShare = (remaining * 7000n) / 10000n;
    const verifierPool = remaining - translatorShare;
    const verifierCount = BigInt(verifiers.length);
    const verifierShare =
      verifierCount > 0n ? verifierPool / verifierCount : 0n;

    const distId = this.state.royaltyNonce;
    this.state.distributions.set(distId, {
      "request-id": requestId,
      "total-amount": totalAmount,
      "translator-share": translatorShare,
      "verifier-share": verifierShare,
      "creator-share": 0n,
      "platform-share": platformShare,
      distributed: false,
      timestamp: this.blockHeight,
    });
    this.state.requestRoyalties.set(requestId, distId);
    this.state.royaltyNonce += 1n;
    return { ok: true, value: distId };
  }

  claimRoyalty(distId: bigint): { ok: boolean; value: bigint | number } {
    const dist = this.state.distributions.get(distId);
    if (!dist) return { ok: false, value: ERR_REQUEST_NOT_FOUND };
    if (dist.distributed) return { ok: false, value: ERR_ALREADY_DISTRIBUTED };
    if (this.state.distributionLock)
      return { ok: false, value: ERR_DISTRIBUTION_LOCKED };

    this.state.distributionLock = true;
    const translator = "STTRANSLATOR";
    const verifiers = ["STVERIFIER1", "STVERIFIER2"];
    const isTranslator = this.caller === translator;
    const isVerifier = verifiers.includes(this.caller);

    const amount = isTranslator
      ? dist["translator-share"]
      : isVerifier
      ? dist["verifier-share"]
      : 0n;
    if (amount === 0n) {
      this.state.distributionLock = false;
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    }

    this.state.stxTransfers.push({
      amount,
      from: this.contractPrincipal,
      to: this.caller,
    });
    this.state.userRoyalties.set(
      this.caller,
      (this.state.userRoyalties.get(this.caller) || 0n) + amount
    );
    this.state.distributions.set(distId, { ...dist, distributed: true });
    this.state.distributionLock = false;
    return { ok: true, value: amount };
  }

  distributePlatformFee(distId: bigint): { ok: boolean; value: bigint } {
    const dist = this.state.distributions.get(distId);
    if (!dist) return { ok: false, value: 0n };
    if (dist.distributed) return { ok: false, value: 0n };
    if (this.caller !== this.contractPrincipal) return { ok: false, value: 0n };

    const fee = dist["platform-share"];
    this.state.stxTransfers.push({
      amount: fee,
      from: this.contractPrincipal,
      to: this.state.platformWallet,
    });
    return { ok: true, value: fee };
  }

  setPlatformFeeRate(newRate: bigint): { ok: boolean; value: boolean } {
    if (this.caller !== this.contractPrincipal)
      return { ok: false, value: false };
    if (newRate > 1000n) return { ok: false, value: false };
    this.state.platformFeeRate = newRate;
    return { ok: true, value: true };
  }

  setPlatformWallet(wallet: string): { ok: boolean; value: boolean } {
    if (this.caller !== this.contractPrincipal)
      return { ok: false, value: false };
    this.state.platformWallet = wallet;
    return { ok: true, value: true };
  }

  getDistribution(id: bigint): Distribution | null {
    return this.state.distributions.get(id) || null;
  }

  getUserRoyalties(user: string): bigint {
    return this.state.userRoyalties.get(user) || 0n;
  }
}

describe("RoyaltyManagement", () => {
  let royalty: RoyaltyManagementMock;

  beforeEach(() => {
    royalty = new RoyaltyManagementMock();
    royalty.reset();
  });

  it("initiates royalty distribution correctly", () => {
    royalty.caller = royalty.contractPrincipal;
    const result = royalty.initiateRoyaltyDistribution(
      1n,
      10000000n,
      "STTRANSLATOR",
      ["STVERIFIER1", "STVERIFIER2"]
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);

    const dist = royalty.getDistribution(0n);
    expect(dist?.["total-amount"]).toBe(10000000n);
    expect(dist?.["platform-share"]).toBe(500000n);
    expect(dist?.["translator-share"]).toBe(6650000n);
    expect(dist?.["verifier-share"]).toBe(1425000n);
  });

  it("prevents double initiation", () => {
    royalty.caller = royalty.contractPrincipal;
    royalty.initiateRoyaltyDistribution(1n, 10000000n, "STT", ["STV1"]);
    const result = royalty.initiateRoyaltyDistribution(1n, 5000000n, "STT", [
      "STV2",
    ]);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_DISTRIBUTED);
  });

  it("translator claims correct share", () => {
    royalty.caller = royalty.contractPrincipal;
    royalty.initiateRoyaltyDistribution(1n, 10000000n, "STTRANSLATOR", [
      "STV1",
      "STV2",
    ]);
    royalty.caller = "STTRANSLATOR";
    const result = royalty.claimRoyalty(0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(6650000n);
    expect(royalty.getUserRoyalties("STTRANSLATOR")).toBe(6650000n);
  });

  it("verifier claims equal share", () => {
    royalty.caller = royalty.contractPrincipal;
    royalty.initiateRoyaltyDistribution(1n, 10000000n, "STT", [
      "STVERIFIER1",
      "STVERIFIER2",
    ]);
    royalty.caller = "STVERIFIER1";
    const result = royalty.claimRoyalty(0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1425000n);
  });

  it("prevents non-participant claims", () => {
    royalty.caller = royalty.contractPrincipal;
    royalty.initiateRoyaltyDistribution(1n, 10000000n, "STT", ["STV1"]);
    royalty.caller = "STHACKER";
    const result = royalty.claimRoyalty(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("locks distribution during claim", () => {
    royalty.caller = royalty.contractPrincipal;
    royalty.initiateRoyaltyDistribution(1n, 10000000n, "STT", ["STV1", "STV2"]);
    royalty.state.distributionLock = true;
    royalty.caller = "STV1";
    const result = royalty.claimRoyalty(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_DISTRIBUTION_LOCKED);
  });

  it("distributes platform fee", () => {
    royalty.caller = royalty.contractPrincipal;
    royalty.initiateRoyaltyDistribution(1n, 10000000n, "STT", ["STV1"]);
    const result = royalty.distributePlatformFee(0n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(500000n);
    expect(royalty.state.stxTransfers).toContainEqual({
      amount: 500000n,
      from: royalty.contractPrincipal,
      to: "STPLATFORM",
    });
  });
});
