import { describe, expect, it } from "vitest";
import { createPlatformClient } from "../src/client.js";
import { MEMBER_COLOURS, isMemberColour, nextFreeColour } from "../src/member-colours.js";
import { createInMemoryStore } from "./in-memory-store.js";

/**
 * Managing the household's roster.
 *
 * `family_members` has existed since Phase 1 and nothing created one beyond the row provisioning
 * writes — so a household could rate a recipe for exactly one person, which is not what a
 * five-point scale and a "whole family likes" filter are for.
 *
 * The rules worth testing are the ones a caller could otherwise talk the seam out of: a child
 * never gets a login, a colour is a word from a list rather than whatever a client sends, and
 * nobody removes themselves.
 */
/** Two households, so "another household's member" is a real case rather than a hypothetical. */
const store = () =>
  createInMemoryStore({
    accounts: [
      { id: "account-1", email: "one@example.test" },
      { id: "account-2", email: "two@example.test" },
    ],
    families: [
      { id: "fam-1", name: "One", ownerAccountId: "account-1", measurementSystem: "metric" },
      { id: "fam-2", name: "Two", ownerAccountId: "account-2", measurementSystem: "metric" },
    ],
    members: [
      { id: "mem-1", familyId: "fam-1", accountId: "account-1", displayName: "Adult One", colour: null, isChild: false },
      { id: "mem-2", familyId: "fam-2", accountId: "account-2", displayName: "Adult Two", colour: null, isChild: false },
    ],
  });
const clientFor = (accountId: string, s = store()) =>
  createPlatformClient({ store: s, accountId });

describe("adding a child", () => {
  it("creates a member with a name and no account", async () => {
    const s = store();
    const client = clientFor("account-1", s);
    const child = await client.addChild({ displayName: "Isla" });

    expect(child).toMatchObject({ displayName: "Isla", isChild: true, accountId: null });
  });

  it("gives a child a colour nobody is using, so adding one is a single field", async () => {
    const s = store();
    const client = clientFor("account-1", s);
    const first = await client.addChild({ displayName: "Isla" });
    const second = await client.addChild({ displayName: "Rowan" });

    expect(first.colour).not.toBe(second.colour);
    expect(isMemberColour(first.colour)).toBe(true);
  });

  it("refuses a colour that is not one of ours", async () => {
    // the column is free text; without this a platform table collects '#ff00ff' and 'red'
    await expect(clientFor("account-1").addChild({ displayName: "Isla", colour: "#ff00ff" }))
      .rejects.toThrow(/not a colour/);
  });

  it("refuses a nameless member", async () => {
    await expect(clientFor("account-1").addChild({ displayName: "   " })).rejects.toThrow(/needs a name/);
  });

  it("trims the name rather than storing the spaces", async () => {
    const child = await clientFor("account-1").addChild({ displayName: "  Isla  " });
    expect(child.displayName).toBe("Isla");
  });

  it("cannot be talked into giving a child a login", async () => {
    // the invariant behind decisions §5, and the schema's child_has_no_login check. There is no
    // parameter for it: the only way to ask is to change this function.
    const child = await clientFor("account-1").addChild({ displayName: "Isla" });
    expect(child.accountId).toBeNull();
    expect(child.isChild).toBe(true);
  });

  it("belongs to the caller's household and no other", async () => {
    const s = store();
    const child = await clientFor("account-1", s).addChild({ displayName: "Isla" });
    const mine = await clientFor("account-1", s).listMembers();
    expect(mine.map((m) => m.id)).toContain(child.id);
  });

  it("refuses an account with no household rather than inventing one", async () => {
    await expect(
      createPlatformClient({ store: createInMemoryStore(), accountId: "nobody" }).addChild({
        displayName: "Isla",
      }),
    ).rejects.toThrow(/no family/);
  });
});

describe("editing a member", () => {
  it("changes the name", async () => {
    const s = store();
    const client = clientFor("account-1", s);
    const child = await client.addChild({ displayName: "Isla" });
    const updated = await client.updateMember(child.id, { displayName: "Isla Mae" });
    expect(updated.displayName).toBe("Isla Mae");
  });

  it("changes the colour, within the palette", async () => {
    const s = store();
    const client = clientFor("account-1", s);
    const child = await client.addChild({ displayName: "Isla" });
    const updated = await client.updateMember(child.id, { colour: "teal" });
    expect(updated.colour).toBe("teal");
    await expect(client.updateMember(child.id, { colour: "chartreuse" })).rejects.toThrow(/not a colour/);
  });

  it("leaves what it was not asked to change", async () => {
    const s = store();
    const client = clientFor("account-1", s);
    const child = await client.addChild({ displayName: "Isla", colour: "plum" });
    const updated = await client.updateMember(child.id, { displayName: "Isla Mae" });
    expect(updated.colour).toBe("plum");
  });

  it("refuses a member of another household", async () => {
    // the id is a uuid a caller supplies; without the household scope it is an enumeration away
    // from renaming a stranger's child
    const s = store();
    const theirs = await clientFor("account-2", s).addChild({ displayName: "Theirs" });
    await expect(clientFor("account-1", s).updateMember(theirs.id, { displayName: "Mine" }))
      .rejects.toThrow(/no such member/);
  });
});

describe("removing a member", () => {
  it("takes them off the roster", async () => {
    const s = store();
    const client = clientFor("account-1", s);
    const child = await client.addChild({ displayName: "Isla" });
    await client.removeMember(child.id);

    const left = await client.listMembers();
    expect(left.map((m) => m.id)).not.toContain(child.id);
  });

  it("refuses to remove the caller", async () => {
    /*
     * Leaving a household is a different action with different consequences — who owns it
     * afterwards, what becomes of the recipes. Allowing it here would let somebody delete the
     * only adult and strand the household behind an account that is a member of nothing.
     */
    const s = store();
    const client = clientFor("account-1", s);
    const me = (await client.listMembers()).find((m) => m.accountId === "account-1");
    await expect(client.removeMember(me!.id)).rejects.toThrow(/cannot remove yourself/);
  });

  it("refuses a member of another household", async () => {
    const s = store();
    const theirs = await clientFor("account-2", s).addChild({ displayName: "Theirs" });
    await expect(clientFor("account-1", s).removeMember(theirs.id)).rejects.toThrow(/no such member/);
  });

  it("refuses an id that is nothing at all", async () => {
    await expect(clientFor("account-1").removeMember("00000000-0000-0000-0000-000000000000"))
      .rejects.toThrow(/no such member/);
  });
});

describe("the colours", () => {
  it("are enough for a household", () => {
    // five distinguishable colours was the requirement; eight leaves room
    expect(MEMBER_COLOURS.length).toBeGreaterThanOrEqual(5);
  });

  it("are all distinct, by key and by value", () => {
    expect(new Set(MEMBER_COLOURS.map((c) => c.key)).size).toBe(MEMBER_COLOURS.length);
    expect(new Set(MEMBER_COLOURS.map((c) => c.hex)).size).toBe(MEMBER_COLOURS.length);
  });

  it("hands out an unused one until they run out, then cycles rather than refusing", () => {
    const all = MEMBER_COLOURS.map((c) => c.key);
    expect(all).toContain(nextFreeColour([]));
    expect(nextFreeColour([all[0]!])).not.toBe(all[0]);
    // a ninth child is unusual; refusing to add them over a colour would be absurd
    expect(isMemberColour(nextFreeColour(all))).toBe(true);
  });

  it("stores a word, not a hex value, so a restyle is not a data migration", async () => {
    const child = await clientFor("account-1").addChild({ displayName: "Isla" });
    expect(child.colour).toMatch(/^[a-z]+$/);
  });
});
