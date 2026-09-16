import { describe, expect, it } from "vitest";
import { marketRow } from "./read-model";

const baseRow = {
  id: "db-id",
  marketId: "0x1111111111111111111111111111111111111111111111111111111111111111",
  engine: "POOL",
  creatorAddress: "0x2222222222222222222222222222222222222222",
  baseAddress: "0x3333333333333333333333333333333333333333",
  financialReleaseId: "0x4444444444444444444444444444444444444444444444444444444444444444",
  resolverAddress: "0x5555555555555555555555555555555555555555",
  resolverReleaseId: "0x6666666666666666666666666666666666666666666666666666666666666666",
  manifestHash: "0x7777777777777777777777777777777777777777777777777777777777777777",
  title: "Example market",
  question: "Will the example event happen?",
  description: "Indexed market",
  category: "Tech & AI",
  closeTime: new Date("2027-01-01T00:00:00.000Z"),
  resolutionAvailableTime: new Date("2027-01-02T00:00:00.000Z"),
  terminalDeadline: new Date("2027-01-06T00:00:00.000Z"),
  manifestJson: { yes_definition: "YES", no_definition: "NO" },
  poolYesTotal: "10",
  poolNoTotal: "20",
  terminalOutcome: null,
};

describe("market read-model normalization", () => {
  it("maps the database terminal lifecycle to the public resolved status", () => {
    expect(marketRow({ ...baseRow, status: "TERMINAL" })).toMatchObject({ status: "RESOLVED", category: "tech-ai" });
  });

  it("preserves active discovery status", () => {
    expect(marketRow({ ...baseRow, status: "ACTIVE" })).toMatchObject({ status: "ACTIVE" });
  });
});
