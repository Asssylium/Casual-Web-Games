const assert = require("node:assert/strict");
const test = require("node:test");
const { canPassCard, resolveClaim, CARD_CATALOG } = require("../server/games/memory");
const { playerHand, publicState } = require("../server/routes/memory");

test("the route's card catalog is exported", () => {
  assert.ok(Array.isArray(CARD_CATALOG));
  assert.ok(CARD_CATALOG.length > 0);
});

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

test("public room state does not expose private hands", () => {
  const room = {
    code: "ABCDE",
    phase: "playing",
    hostId: "player-1",
    round: 1,
    players: [
      { userId: "player-1", username: "One", hand: [{ id: "secret", name: "Cat" }] },
      { userId: "player-2", username: "Two", hand: [{ id: "private", name: "Lamp" }] },
    ],
    currentTurnId: "player-1",
    pending: null,
    revealEndsAt: null,
    revealCards: null,
    lastReveal: null,
    notice: "Playing",
    winnerId: null,
  };

  const state = publicState(room);
  assert.equal(JSON.stringify(state).includes("secret"), false);
  assert.equal(JSON.stringify(state).includes("Cat"), false);
  assert.deepEqual(playerHand(room, "player-1").cards, room.players[0].hand);
  assert.deepEqual(playerHand(room, "player-2").cards, room.players[1].hand);
});