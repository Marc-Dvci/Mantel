import { decideDoor, nightDoorAlert, nightPresenceAlert } from "../packages/core/src";
import { at, household } from "./helpers";

describe("At the Door", () => {
  it("names the expected visitor inside the visit window", () => {
    const { h } = household("15:58");
    const d = decideDoor(h, at("15:58"), "p1", "snap-1");
    expect(d.card.kind).toBe("expected-visit");
    expect(d.card.lines).toEqual(["That's probably Sarah.", "Sarah is due at 4 o'clock."]);
    expect(d.card.visitor).toBe("sarah");
    expect(d.card.snapshot).toBe("snap-1");
    expect(d.alert.urgency).toBe("info");
  });

  it("tells the person they need not open the door when nobody is expected, and tells Sarah", () => {
    const { h } = household("14:00");
    const d = decideDoor(h, at("14:00"), "p2", "snap-2");
    expect(d.card.kind).toBe("unexpected");
    expect(d.card.lines).toEqual(["You're not expecting anyone.", "You don't need to open the door.", "Sarah can see who it is."]);
    expect(d.alert).toMatchObject({ kind: "door.unexpected", urgency: "attention", snapshot: "snap-2" });
  });

  it("recognises a delivery window", () => {
    const { h } = household("14:00");
    const d = decideDoor(h, at("11:00", "2026-10-01"), "p3");
    expect(d.card.kind).toBe("expected-delivery");
    expect(d.card.lines).toContain("You don't need to open the door.");
  });

  it("treats a visit outside its window as unexpected", () => {
    const { h } = household("14:00");
    expect(decideDoor(h, at("15:20"), "p4").card.kind).toBe("expected-visit");
    expect(decideDoor(h, at("15:20"), "p4").visit?.who).toBe("sarah");
    expect(decideDoor(h, at("15:10"), "p5").card.kind).toBe("unexpected");
    expect(decideDoor(h, at("16:50"), "p6").card.kind).toBe("unexpected");
  });

  it("is urgent at night and never names a caller", () => {
    const { h } = household("02:30");
    const d = decideDoor(h, at("02:30"), "p6");
    expect(d.card.kind).toBe("night");
    expect(d.alert.urgency).toBe("urgent");
    expect(d.card.lines.join(" ")).not.toMatch(/probably|stranger|danger|police/i);
  });

  it("the expiry keeps the card on screen for three minutes", () => {
    const { h } = household("14:00");
    const d = decideDoor(h, at("14:00"), "p7");
    expect(Date.parse(d.card.expiresAt) - Date.parse(d.card.at)).toBe(180_000);
  });

  it("alerts on an outside door opening at night, and only at night", () => {
    const { h } = household();
    expect(nightDoorAlert(h, at("03:05"), "c1", "Front door")?.urgency).toBe("urgent");
    expect(nightDoorAlert(h, at("15:05"), "c2", "Front door")).toBeUndefined();
    h.settings.nightAlerts.doorOpen = false;
    expect(nightDoorAlert(h, at("03:05"), "c3", "Front door")).toBeUndefined();
  });

  it("alerts on night presence only when a live-in carer asked for it", () => {
    const { h } = household();
    expect(nightPresenceAlert(h, at("03:05"), "n1")).toBeUndefined();
    h.settings.nightAlerts.presence = true;
    expect(nightPresenceAlert(h, at("03:05"), "n2")?.kind).toBe("night.presence");
  });
});
