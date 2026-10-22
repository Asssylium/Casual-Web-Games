const assert = require("node:assert/strict");
const test = require("node:test");
const { canPassCard, resolveClaim, CARD_CATALOG } = require("../server/games/memory");
const {
  playerHand,
  publicState,
  markStalePlayers,
  beginMemoryPhase,
  refillGiftShop,
  giftToPass,
  awardPenalty,
} = require("../server/routes/memory");

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

test("a custom typed claim is judged against the actual card", () => {
  assert.equal(resolveClaim({ name: "Radio" }, "a very convincing toaster"), "lie");
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

test("a player with only the newly received card can pass it", () => {
  const player = {
    hand: [{ id: "new-card" }],
    blockedCardId: "new-card",
  };

  assert.equal(canPassCard(player, "new-card"), true);
});

test("a player cannot pass a card they do not have", () => {
  const player = {
    hand: [{ id: "new-card" }],
    blockedCardId: "new-card",
  };

  assert.equal(canPassCard(player, "missing-card"), false);
});

test("stale players are marked disconnected while recent heartbeats stay connected", () => {
  const now = Date.now();
  const room = {
    players: [
      { connected: true, lastSeenAt: new Date(now - 60_000) },
      { connected: true, lastSeenAt: new Date(now - 10_000) },
    ],
  };

  assert.equal(markStalePlayers(room, now), true);
  assert.deepEqual(room.players.map((player) => player.connected), [false, true]);
});

test("a new game gives every player one gift and fills the gift shop", () => {
  const room = {
    players: [
      { userId: "p1", username: "One", hand: [], penaltyCards: [] },
      { userId: "p2", username: "Two", hand: [], penaltyCards: [] },
    ],
  };

  beginMemoryPhase(room, "p2");

  assert.deepEqual(room.players.map((player) => player.hand.length), [1, 1]);
  assert.equal(room.drawPile.length, CARD_CATALOG.length - 2);
  assert.equal(room.currentTurnId, "p2");
  assert.ok(room.players.flatMap((player) => player.hand).every((gift) => ["left", "right"].includes(gift.direction)));
});

test("an empty gift shop refills with fresh uniquely identified gifts", () => {
  const room = { drawPile: [] };

  refillGiftShop(room);

  assert.equal(room.drawPile.length, CARD_CATALOG.length);
  assert.equal(new Set(room.drawPile.map((gift) => gift.id)).size, CARD_CATALOG.length);
});

test("a player with two gifts must pass the oldest gift", () => {
  const oldest = { id: "oldest", direction: "left" };
  const newest = { id: "newest", direction: "right" };
  const result = giftToPass({ drawnBy: null, drawnCard: null }, { hand: [oldest, newest] }, "p1");

  assert.equal(result.card.id, "oldest");
  assert.equal(result.isDrawnGift, false);
});

test("a player with one gift must draw before passing", () => {
  const result = giftToPass({ drawnBy: null, drawnCard: null }, { hand: [{ id: "only" }] }, "p1");

  assert.equal(result, null);
});

test("three penalty points end the game and retain tied lowest scorers", () => {
  const room = {
    phase: "playing",
    players: [
      { userId: "p1", username: "One", penaltyCards: [{ id: "a" }, { id: "b" }] },
      { userId: "p2", username: "Two", penaltyCards: [{ id: "c" }] },
      { userId: "p3", username: "Three", penaltyCards: [{ id: "d" }] },
    ],
  };

  assert.equal(awardPenalty(room, room.players[0], { id: "e" }), true);
  assert.equal(room.phase, "finished");
  assert.equal(room.players[0].penaltyCards.length, 3);
  assert.deepEqual(room.winnerIds, ["p2", "p3"]);
  assert.equal(room.winnerId, null);
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