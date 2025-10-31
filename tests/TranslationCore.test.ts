// TranslationCore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  Cl,
  ClarityValue,
  uintCV,
  stringAsciiCV,
  someCV,
  noneCV,
  tupleCV,
  listCV,
  boolCV,
} from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_REQUEST_CLOSED = 101;
const ERR_INSUFFICIENT_BOUNTY = 102;
const ERR_VERIFICATION_FAILED = 103;
const ERR_ALREADY_SUBMITTED = 104;
const ERR_INVALID_HASH = 105;
const ERR_INVALID_LANG = 106;
const ERR_INVALID_STATUS = 107;
const ERR_REQUEST_NOT_FOUND = 108;
const ERR_NO_TRANSLATION = 110;

interface Request {
  creator: string;
  "content-hash": string;
  "source-lang": string;
  "target-lang": string;
  bounty: bigint;
  status: string;
  "created-at": bigint;
  translator: string | null;
  "translation-hash": string | null;
  "verification-count": bigint;
  "approval-threshold": bigint;
}

class TranslationCoreMock {
  state: {
    requestNonce: bigint;
    requests: Map<bigint, Request>;
    verifications: Map<string, { approved: boolean; timestamp: bigint }>;
    stxTransfers: Array<{ amount: bigint; from: string; to: string }>;
  } = {
    requestNonce: 0n,
    requests: new Map(),
    verifications: new Map(),
    stxTransfers: [],
  };
  caller: string = "ST1CREATOR";
  blockHeight: bigint = 100n;
  contractPrincipal: string = "ST2CONTRACT";

  reset() {
    this.state = {
      requestNonce: 0n,
      requests: new Map(),
      verifications: new Map(),
      stxTransfers: [],
    };
    this.caller = "ST1CREATOR";
    this.blockHeight = 100n;
  }

  createRequest(
    contentHash: string,
    sourceLang: string,
    targetLang: string,
    bounty: bigint,
    approvalThreshold: bigint
  ): { ok: boolean; value: bigint | number } {
    if (!contentHash || contentHash.length !== 64)
      return { ok: false, value: ERR_INVALID_HASH };
    if (!sourceLang || sourceLang.length > 10)
      return { ok: false, value: ERR_INVALID_LANG };
    if (!targetLang || targetLang.length > 10)
      return { ok: false, value: ERR_INVALID_LANG };
    if (bounty <= 0n) return { ok: false, value: ERR_INSUFFICIENT_BOUNTY };
    if (approvalThreshold < 1n || approvalThreshold > 10n)
      return { ok: false, value: ERR_INVALID_STATUS };

    const id = this.state.requestNonce;
    this.state.stxTransfers.push({
      amount: bounty,
      from: this.caller,
      to: this.contractPrincipal,
    });
    this.state.requests.set(id, {
      creator: this.caller,
      "content-hash": contentHash,
      "source-lang": sourceLang,
      "target-lang": targetLang,
      bounty,
      status: "open",
      "created-at": this.blockHeight,
      translator: null,
      "translation-hash": null,
      "verification-count": 0n,
      "approval-threshold": approvalThreshold,
    });
    this.state.requestNonce += 1n;
    return { ok: true, value: id };
  }

  submitTranslation(
    requestId: bigint,
    translationHash: string
  ): { ok: boolean; value: boolean | number } {
    const req = this.state.requests.get(requestId);
    if (!req) return { ok: false, value: ERR_REQUEST_NOT_FOUND };
    if (req.status !== "open") return { ok: false, value: ERR_REQUEST_CLOSED };
    if (translationHash.length !== 64)
      return { ok: false, value: ERR_INVALID_HASH };
    if (req.translator !== null)
      return { ok: false, value: ERR_ALREADY_SUBMITTED };

    this.state.requests.set(requestId, {
      ...req,
      translator: this.caller,
      "translation-hash": translationHash,
      status: "submitted",
    });
    return { ok: true, value: true };
  }

  startVerification(requestId: bigint): {
    ok: boolean;
    value: boolean | number;
  } {
    const req = this.state.requests.get(requestId);
    if (!req) return { ok: false, value: ERR_REQUEST_NOT_FOUND };
    if (req.status !== "submitted")
      return { ok: false, value: ERR_INVALID_STATUS };
    if (req.translator === null)
      return { ok: false, value: ERR_NO_TRANSLATION };

    this.state.requests.set(requestId, { ...req, status: "verifying" });
    return { ok: true, value: true };
  }

  verifyTranslation(
    requestId: bigint,
    approved: boolean
  ): { ok: boolean; value: number } {
    const req = this.state.requests.get(requestId);
    if (!req) return { ok: false, value: ERR_REQUEST_NOT_FOUND };
    if (req.status !== "verifying")
      return { ok: false, value: ERR_INVALID_STATUS };
    const key = `${requestId}-${this.caller}`;
    if (this.state.verifications.has(key))
      return { ok: false, value: ERR_ALREADY_SUBMITTED };

    this.state.verifications.set(key, {
      approved,
      timestamp: this.blockHeight,
    });
    const newCount = approved
      ? req["verification-count"] + 1n
      : req["verification-count"];
    const updated = { ...req, "verification-count": newCount };

    if (approved && newCount >= req["approval-threshold"]) {
      this.state.stxTransfers.push({
        amount: req.bounty,
        from: this.contractPrincipal,
        to: req.translator!,
      });
      this.state.requests.set(requestId, { ...updated, status: "approved" });
      return { ok: true, value: 200 };
    }
    this.state.requests.set(requestId, updated);
    return { ok: true, value: 201 };
  }

  rejectRequest(requestId: bigint): { ok: boolean; value: boolean | number } {
    const req = this.state.requests.get(requestId);
    if (!req) return { ok: false, value: ERR_REQUEST_NOT_FOUND };
    if (req.creator !== this.caller)
      return { ok: false, value: ERR_NOT_AUTHORIZED };
    if (req.status === "approved")
      return { ok: false, value: ERR_REQUEST_CLOSED };

    this.state.stxTransfers.push({
      amount: req.bounty,
      from: this.contractPrincipal,
      to: this.caller,
    });
    this.state.requests.set(requestId, { ...req, status: "rejected" });
    return { ok: true, value: true };
  }

  getRequest(id: bigint): Request | null {
    return this.state.requests.get(id) || null;
  }
}

describe("TranslationCore", () => {
  let core: TranslationCoreMock;

  beforeEach(() => {
    core = new TranslationCoreMock();
    core.reset();
  });

  it("creates translation request with valid params", () => {
    const result = core.createRequest("a".repeat(64), "en", "es", 1000000n, 2n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);
    const req = core.getRequest(0n);
    expect(req?.status).toBe("open");
    expect(req?.bounty).toBe(1000000n);
    expect(core.state.stxTransfers[0].to).toBe(core.contractPrincipal);
  });

  it("rejects invalid content hash", () => {
    const result = core.createRequest("short", "en", "es", 1000000n, 2n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_HASH);
  });

  it("rejects insufficient bounty", () => {
    const result = core.createRequest("a".repeat(64), "en", "es", 0n, 2n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INSUFFICIENT_BOUNTY);
  });

  it("submits translation successfully", () => {
    core.createRequest("a".repeat(64), "en", "es", 1000000n, 2n);
    core.caller = "ST2TRANSLATOR";
    const result = core.submitTranslation(0n, "b".repeat(64));
    expect(result.ok).toBe(true);
    const req = core.getRequest(0n);
    expect(req?.status).toBe("submitted");
    expect(req?.translator).toBe("ST2TRANSLATOR");
  });

  it("starts verification after submission", () => {
    core.createRequest("a".repeat(64), "en", "es", 1000000n, 2n);
    core.caller = "ST2TRANSLATOR";
    core.submitTranslation(0n, "b".repeat(64));
    const result = core.startVerification(0n);
    expect(result.ok).toBe(true);
    expect(core.getRequest(0n)?.status).toBe("verifying");
  });

  it("approves translation with threshold", () => {
    core.createRequest("a".repeat(64), "en", "es", 1000000n, 2n);
    core.caller = "ST2TRANSLATOR";
    core.submitTranslation(0n, "b".repeat(64));
    core.startVerification(0n);

    core.caller = "ST3VERIFIER1";
    core.verifyTranslation(0n, true);
    core.caller = "ST3VERIFIER2";
    const result = core.verifyTranslation(0n, true);

    expect(result.ok).toBe(true);
    expect(result.value).toBe(200);
    expect(core.getRequest(0n)?.status).toBe("approved");
    expect(core.state.stxTransfers).toContainEqual({
      amount: 1000000n,
      from: core.contractPrincipal,
      to: "ST2TRANSLATOR",
    });
  });

  it("rejects verification if not in verifying state", () => {
    core.createRequest("a".repeat(64), "en", "es", 1000000n, 2n);
    core.caller = "ST3VERIFIER1";
    const result = core.verifyTranslation(0n, true);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("creator can reject open request", () => {
    core.createRequest("a".repeat(64), "en", "es", 1000000n, 2n);
    const result = core.rejectRequest(0n);
    expect(result.ok).toBe(true);
    expect(core.getRequest(0n)?.status).toBe("rejected");
    expect(core.state.stxTransfers).toContainEqual({
      amount: 1000000n,
      from: core.contractPrincipal,
      to: "ST1CREATOR",
    });
  });

  it("non-creator cannot reject", () => {
    core.createRequest("a".repeat(64), "en", "es", 1000000n, 2n);
    core.caller = "ST2HACKER";
    const result = core.rejectRequest(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });
});
