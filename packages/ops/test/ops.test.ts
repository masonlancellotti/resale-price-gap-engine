import { describe, expect, test } from "vitest";
import { FakeShippingProvider, FakeTrackingProvider, Ops } from "../src/index.js";

const now = () => new Date("2026-07-04T00:00:00.000Z");
const label = { sku: "FD-2026-00001", fromZip: "10001", toZip: "94103", weightOz: 20 };

describe("Ops — fulfillment", () => {
  test("buys a label and records the shipment", async () => {
    const ops = new Ops({ now });
    const s = await ops.fulfill(label);
    expect(s.trackingNumber).toContain("FD-2026-00001");
    expect(s.labelCostCents).toBe(560n); // 400 + 20×8
    expect(s.state).toBe("label_created");
    expect(s.shippedAt).toBe("2026-07-04T00:00:00.000Z");
  });

  test("fulfill is idempotent per SKU — never double-buys a label", async () => {
    const shipping = new FakeShippingProvider();
    const ops = new Ops({ shipping, now });
    const a = await ops.fulfill(label);
    const b = await ops.fulfill(label);
    expect(b.trackingNumber).toBe(a.trackingNumber); // same label reused
  });

  test("tracking refresh reflects the carrier state", async () => {
    const ops = new Ops({ now, tracking: new FakeTrackingProvider({}) });
    const s = await ops.fulfill(label);
    const state = await ops.refreshTracking(s.sku);
    expect(state).toBe("in_transit");
  });
});

describe("Ops — returns", () => {
  test("full refund on a return, restockable flag preserved", () => {
    const ops = new Ops({ now });
    const r = ops.handleReturn({ sku: "FD-2026-00002", saleGrossCents: 9_900n, reason: "not_as_expected", restockable: true });
    expect(r.refundCents).toBe(9_900n);
    expect(r.restockable).toBe(true);
    expect(r.receivedAt).toBe("2026-07-04T00:00:00.000Z");
  });
});
