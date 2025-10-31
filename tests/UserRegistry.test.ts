// UserRegistry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { stringAsciiCV, listCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_ALREADY_REGISTERED = 101;
const ERR_INVALID_REPUTATION = 102;
const ERR_INVALID_ROLE = 103;
const ERR_USER_NOT_FOUND = 104;
const ERR_INVALID_EXPERTISE = 105;
const ERR_STAKE_REQUIRED = 106;
const ERR_INSUFFICIENT_STAKE = 107;

interface User {
  reputation: bigint;
  role: string;
  "expertise-langs": string[];
  "total-translated": bigint;
  "total-verified": bigint;
  stake: bigint;
  "joined-at": bigint;
  "is-active": boolean;
}

class UserRegistryMock {
  state: {
    minStakeAmount: bigint;
    totalUsers: bigint;
    users: Map<string, User>;
    userStakes: Map<string, bigint>;
    expertiseIndex: Map<string, boolean>;
    stxTransfers: Array<{ amount: bigint; from: string; to: string }>;
  } = {
    minStakeAmount: 5000000n,
    totalUsers: 0n,
    users: new Map(),
    userStakes: new Map(),
    expertiseIndex: new Map(),
    stxTransfers: [],
  };
  caller: string = "ST1USER";
  blockHeight: bigint = 200n;
  contractPrincipal: string = "ST2REGISTRY";

  reset() {
    this.state = {
      minStakeAmount: 5000000n,
      totalUsers: 0n,
      users: new Map(),
      userStakes: new Map(),
      expertiseIndex: new Map(),
      stxTransfers: [],
    };
    this.caller = "ST1USER";
    this.blockHeight = 200n;
  }

  registerUser(
    role: string,
    expertiseLangs: string[]
  ): { ok: boolean; value: boolean | number } {
    if (this.state.users.has(this.caller))
      return { ok: false, value: ERR_ALREADY_REGISTERED };
    if (!["creator", "translator", "verifier", "all"].includes(role))
      return { ok: false, value: ERR_INVALID_ROLE };
    if (!expertiseLangs.every((l) => l.length > 0 && l.length <= 10))
      return { ok: false, value: ERR_INVALID_EXPERTISE };

    for (const lang of expertiseLangs) {
      this.state.expertiseIndex.set(`${lang}-${this.caller}`, true);
    }

    this.state.users.set(this.caller, {
      reputation: 100n,
      role,
      "expertise-langs": expertiseLangs,
      "total-translated": 0n,
      "total-verified": 0n,
      stake: 0n,
      "joined-at": this.blockHeight,
      "is-active": true,
    });
    this.state.totalUsers += 1n;
    return { ok: true, value: true };
  }

  stakeForRole(amount: bigint): { ok: boolean; value: bigint | number } {
    const user = this.state.users.get(this.caller);
    if (!user) return { ok: false, value: ERR_USER_NOT_FOUND };
    if (amount <= 0n) return { ok: false, value: ERR_INSUFFICIENT_STAKE };

    this.state.stxTransfers.push({
      amount,
      from: this.caller,
      to: this.contractPrincipal,
    });
    const newStake = (this.state.userStakes.get(this.caller) || 0n) + amount;
    this.state.userStakes.set(this.caller, newStake);
    this.state.users.set(this.caller, { ...user, stake: newStake });
    return { ok: true, value: newStake };
  }

  updateReputation(
    user: string,
    delta: number
  ): { ok: boolean; value: bigint } {
    const userData = this.state.users.get(user);
    if (!userData) return { ok: false, value: 0n };
    const current = userData.reputation;
    const newRep =
      delta >= 0
        ? current + BigInt(delta)
        : current >= BigInt(-delta)
        ? current + BigInt(delta)
        : 0n;
    this.state.users.set(user, { ...userData, reputation: newRep });
    return { ok: true, value: newRep };
  }

  deactivateUser(): { ok: boolean; value: boolean | number } {
    const user = this.state.users.get(this.caller);
    if (!user) return { ok: false, value: ERR_USER_NOT_FOUND };
    const stake = this.state.userStakes.get(this.caller) || 0n;
    this.state.stxTransfers.push({
      amount: stake,
      from: this.contractPrincipal,
      to: this.caller,
    });
    this.state.users.set(this.caller, { ...user, "is-active": false });
    this.state.userStakes.delete(this.caller);
    return { ok: true, value: true };
  }

  updateExpertise(newLangs: string[]): {
    ok: boolean;
    value: boolean | number;
  } {
    const user = this.state.users.get(this.caller);
    if (!user) return { ok: false, value: ERR_USER_NOT_FOUND };
    if (!newLangs.every((l) => l.length > 0 && l.length <= 10))
      return { ok: false, value: ERR_INVALID_EXPERTISE };

    const oldLangs = user["expertise-langs"];
    for (const lang of oldLangs) {
      this.state.expertiseIndex.delete(`${lang}-${this.caller}`);
    }
    for (const lang of newLangs) {
      this.state.expertiseIndex.set(`${lang}-${this.caller}`, true);
    }
    this.state.users.set(this.caller, { ...user, "expertise-langs": newLangs });
    return { ok: true, value: true };
  }

  incrementTranslated(user: string): { ok: boolean; value: boolean } {
    const userData = this.state.users.get(user);
    if (!userData) return { ok: false, value: false };
    this.state.users.set(user, {
      ...userData,
      "total-translated": userData["total-translated"] + 1n,
    });
    return { ok: true, value: true };
  }

  incrementVerified(user: string): { ok: boolean; value: boolean } {
    const userData = this.state.users.get(user);
    if (!userData) return { ok: false, value: false };
    this.state.users.set(user, {
      ...userData,
      "total-verified": userData["total-verified"] + 1n,
    });
    return { ok: true, value: true };
  }

  getUser(user: string): User | null {
    return this.state.users.get(user) || null;
  }

  getExpertsByLang(lang: string): Array<{ user: string; lang: string }> {
    const result: Array<{ user: string; lang: string }> = [];
    for (const [key, _] of this.state.expertiseIndex) {
      const [kLang, kUser] = key.split("-");
      if (kLang === lang) result.push({ user: kUser, lang: kLang });
    }
    return result;
  }
}

describe("UserRegistry", () => {
  let registry: UserRegistryMock;

  beforeEach(() => {
    registry = new UserRegistryMock();
    registry.reset();
  });

  it("registers a translator with expertise", () => {
    const result = registry.registerUser("translator", ["es", "fr"]);
    expect(result.ok).toBe(true);
    const user = registry.getUser("ST1USER");
    expect(user?.role).toBe("translator");
    expect(user?.reputation).toBe(100n);
    expect(user?.["expertise-langs"]).toEqual(["es", "fr"]);
    expect(registry.state.totalUsers).toBe(1n);
  });

  it("rejects duplicate registration", () => {
    registry.registerUser("translator", ["es"]);
    const result = registry.registerUser("verifier", ["fr"]);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ALREADY_REGISTERED);
  });

  it("rejects invalid role", () => {
    const result = registry.registerUser("hacker", ["en"]);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ROLE);
  });

  it("allows staking after registration", () => {
    registry.registerUser("verifier", ["de"]);
    const result = registry.stakeForRole(10000000n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(10000000n);
    expect(registry.getUser("ST1USER")?.stake).toBe(10000000n);
    expect(registry.state.stxTransfers[0].to).toBe(registry.contractPrincipal);
  });

  it("updates reputation positively and negatively", () => {
    registry.registerUser("translator", ["es"]);
    registry.updateReputation("ST1USER", 50);
    expect(registry.getUser("ST1USER")?.reputation).toBe(150n);
    registry.updateReputation("ST1USER", -30);
    expect(registry.getUser("ST1USER")?.reputation).toBe(120n);
    registry.updateReputation("ST1USER", -200);
    expect(registry.getUser("ST1USER")?.reputation).toBe(0n);
  });

  it("indexes and retrieves experts by language", () => {
    registry.caller = "ST1USER";
    registry.registerUser("translator", ["es", "pt"]);
    registry.caller = "ST2USER";
    registry.registerUser("verifier", ["es", "it"]);
    const experts = registry.getExpertsByLang("es");
    expect(experts.map((e) => e.user)).toContain("ST1USER");
    expect(experts.map((e) => e.user)).toContain("ST2USER");
    expect(registry.getExpertsByLang("it")).toEqual([
      { user: "ST2USER", lang: "it" },
    ]);
  });

  it("updates expertise and reindexes", () => {
    registry.registerUser("translator", ["es", "fr"]);
    registry.updateExpertise(["de", "it"]);
    const user = registry.getUser("ST1USER");
    expect(user?.["expertise-langs"]).toEqual(["de", "it"]);
    expect(registry.getExpertsByLang("es")).toHaveLength(0);
    expect(registry.getExpertsByLang("de")).toHaveLength(1);
  });

  it("tracks translation and verification counts", () => {
    registry.registerUser("translator", ["es"]);
    registry.incrementTranslated("ST1USER");
    registry.incrementVerified("ST1USER");
    const user = registry.getUser("ST1USER");
    expect(user?.["total-translated"]).toBe(1n);
    expect(user?.["total-verified"]).toBe(1n);
  });

  it("deactivates user and returns stake", () => {
    registry.registerUser("verifier", ["en"]);
    registry.stakeForRole(5000000n);
    const result = registry.deactivateUser();
    expect(result.ok).toBe(true);
    expect(registry.getUser("ST1USER")?.["is-active"]).toBe(false);
    expect(registry.state.stxTransfers).toContainEqual({
      amount: 5000000n,
      from: registry.contractPrincipal,
      to: "ST1USER",
    });
  });
});
