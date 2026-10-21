const assert = require("node:assert/strict");
const test = require("node:test");
const { canPassCard, resolveClaim } = require("../server/games/memory");

test("a matching card name is truthful regardless of capitalization", () => {
  assert.equal(resolveClaim({ name: "Chair" }, "chair"), "truth");
});

test("a different card name is a lie", () => {
  assert.equal(resolveClaim({ name: "Radio" }, "Cat"), "lie");
});

test("surrounding whitespace does not change a claim", () => {
  assert.equal(resolveClaim({ name: "Lamp" }, "  Lamp  "), "truth");
});

test("a player can pass an older card while holding a newly received card", () => {
  const player = {
    hand: [{ id: "old-card" }, { id: "new-card" }],
    blockedCardId: "new-card",
  };

  assert.equal(canPassCard(player, "old-card"), true);
});

test("a player cannot pass the card they just received", () => {
  const player = {
    hand: [{ id: "old-card" }, { id: "new-card" }],
    blockedCardId: "new-card",
  };

  assert.equal(canPassCard(player, "new-card"), false);
});