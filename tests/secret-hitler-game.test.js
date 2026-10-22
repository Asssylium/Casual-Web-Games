const assert = require("node:assert/strict");
const test = require("node:test");
const SecretHitlerRoom = require("../server/models/SecretHitlerRoom");
const {
  applyAction,
  eligibleChancellors,
  fascistPowerFor,
  initializeGame,
  policyDeck,
  privateState,
  publicState,
  roleDeck,
} = require("../server/games/secret-hitler");

function createRoom(count = 5) {
  return {
    code: "ABCDE",
    hostId: "p1",
    phase: "lobby",
    players: Array.from({ length: count }, (_, index) => ({
      userId: `p${index + 1}`,
      username: `Player ${index + 1}`,
      connected: true,
      alive: true,
    })),
  };
}

test("role distribution has the correct Liberal and Fascist team sizes", () => {
  for (let count = 5; count <= 10; count += 1) {
    const roles = roleDeck(count);
    assert.equal(roles.filter((role) => role === "liberal").length, ({ 5: 3, 6: 4, 7: 4, 8: 5, 9: 5, 10: 6 })[count]);
    assert.equal(roles.filter((role) => role === "fascist").length, ({ 5: 1, 6: 1, 7: 2, 8: 2, 9: 3, 10: 3 })[count]);
    assert.equal(roles.filter((role) => role === "hitler").length, 1);
  }
});

test("the policy deck has six Liberal and eleven Fascist policies", () => {
  const policies = policyDeck();
  assert.equal(policies.length, 17);
  assert.equal(policies.filter((policy) => policy === "liberal").length, 6);
  assert.equal(policies.filter((policy) => policy === "fascist").length, 11);
});

test("private role knowledge follows the 5-6 and 7-10 player rules", () => {
  const smallRoom = createRoom(6);
  initializeGame(smallRoom);
  const hitlerInSmallGame = smallRoom.players.find((player) => player.role === "hitler");
  assert.equal(privateState(smallRoom, hitlerInSmallGame.userId).knownPlayers.length, 2);

  const largeRoom = createRoom(7);
  initializeGame(largeRoom);
  const hitlerInLargeGame = largeRoom.players.find((player) => player.role === "hitler");
  const fascistInLargeGame = largeRoom.players.find((player) => player.role === "fascist");
  assert.equal(privateState(largeRoom, hitlerInLargeGame.userId).knownPlayers.length, 0);
  assert.equal(privateState(largeRoom, fascistInLargeGame.userId).knownPlayers.length, 3);
});

test("public state never exposes roles before the game is over", () => {
  const room = createRoom();
  initializeGame(room);
  const serialized = JSON.stringify(publicState(room));
  assert.equal(serialized.includes('"role":"hitler"'), false);
  assert.equal(serialized.includes('"party":"fascist"'), false);
});

test("term limits exclude both previous officers except the president at five players", () => {
  const room = createRoom(6);
  room.presidentId = "p3";
  room.lastElectedPresidentId = "p1";
  room.lastElectedChancellorId = "p2";
  assert.deepEqual(eligibleChancellors(room).map((player) => player.userId), ["p4", "p5", "p6"]);
  room.players[5].alive = false;
  assert.deepEqual(eligibleChancellors(room).map((player) => player.userId), ["p1", "p4", "p5"]);
});

test("Fascist executive powers match each player-count board", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((count) => fascistPowerFor(5, count)), [null, null, "policy-peek", "execute", "execute"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((count) => fascistPowerFor(6, count)), [null, null, "policy-peek", "execute", "execute"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((count) => fascistPowerFor(7, count)), [null, "investigate", "special-election", "execute", "execute"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((count) => fascistPowerFor(8, count)), [null, "investigate", "special-election", "execute", "execute"]);
  assert.deepEqual([1, 2, 3, 4, 5].map((count) => fascistPowerFor(10, count)), ["investigate", "investigate", "special-election", "execute", "execute"]);
});

test("votes are hidden until every living player has voted and ties fail", () => {
  const room = createRoom(6);
  initializeGame(room);
  room.presidentId = "p1";
  room.phase = "election";
  applyAction(room, "p1", "nominate", { candidateId: "p2" });
  applyAction(room, "p1", "vote", { ja: true });
  assert.equal(privateState(room, "p1").hasVoted, true);
  assert.equal(privateState(room, "p1").ownVote, true);
  assert.equal(privateState(room, "p2").hasVoted, false);
  assert.equal(publicState(room).votesSubmitted, 1);
  assert.equal(publicState(room).ballotResults, null);
  assert.equal(JSON.stringify(publicState(room)).includes('"ja"'), false);
  applyAction(room, "p2", "vote", { ja: true });
  applyAction(room, "p3", "vote", { ja: false });
  applyAction(room, "p4", "vote", { ja: false });
  applyAction(room, "p5", "vote", { ja: false });
  applyAction(room, "p6", "vote", { ja: true });
  assert.equal(room.ballotResults.passed, false);
  assert.deepEqual(room.ballotResults.yesIds, ["p1", "p2", "p6"]);
  assert.equal(room.electionTracker, 1);
});

test("a Chancellor cannot enact Hitler after three Fascist policies", () => {
  const room = createRoom(5);
  initializeGame(room);
  const hitler = room.players.find((player) => player.role === "hitler");
  room.fascistPolicies = 3;
  room.phase = "voting";
  room.presidentId = "p1";
  room.chancellorId = hitler.userId;
  room.ballots = Object.fromEntries(room.players
    .filter((player) => player.userId !== "p1")
    .map((player) => [player.userId, true]));
  applyAction(room, "p1", "vote", { ja: true });
  assert.equal(room.phase, "finished");
  assert.equal(room.winnerTeam, "fascist");
  assert.equal(room.winnerReason, "hitler-elected-chancellor");
});

test("only the elected President receives private policy cards", () => {
  const room = createRoom(5);
  initializeGame(room);
  room.phase = "legislative-president";
  room.presidentId = "p1";
  room.presidentHand = ["liberal", "fascist", "fascist"];
  assert.deepEqual(privateState(room, "p1").policyHand, room.presidentHand);
  assert.deepEqual(privateState(room, "p2").policyHand, []);
  assert.equal(JSON.stringify(publicState(room)).includes('"policyHand"'), false);
});

test("the President privately passes two policies and the Chancellor privately enacts one", () => {
  const room = createRoom(5);
  initializeGame(room);
  room.phase = "legislative-president";
  room.presidentId = "p1";
  room.chancellorId = "p2";
  room.presidentHand = ["liberal", "fascist", "fascist"];

  applyAction(room, "p1", "president-discard", { index: 0 });
  assert.deepEqual(room.discardPile, ["liberal"]);
  assert.equal(privateState(room, "p1").policyHand.length, 0);
  assert.deepEqual(privateState(room, "p2").policyHand, ["fascist", "fascist"]);
  const publicJson = JSON.stringify(publicState(room));
  assert.equal(publicJson.includes('"presidentHand"'), false);
  assert.equal(publicJson.includes('"chancellorHand"'), false);

  applyAction(room, "p2", "chancellor-enact", { index: 1 });
  assert.equal(room.fascistPolicies, 1);
  assert.equal(room.discardPile.length, 2);
  assert.equal(room.phase, "election");
});

test("an agreed veto discards both policies and advances the election tracker", () => {
  const room = createRoom(5);
  initializeGame(room);
  room.phase = "legislative-chancellor";
  room.presidentId = "p1";
  room.chancellorId = "p2";
  room.fascistPolicies = 5;
  room.chancellorHand = ["liberal", "fascist"];

  applyAction(room, "p2", "veto-request");
  applyAction(room, "p1", "veto-response", { agree: true });

  assert.equal(room.discardPile.length, 2);
  assert.equal(room.electionTracker, 1);
  assert.equal(room.phase, "election");
});

test("an investigation reveals party membership only to the President", () => {
  const room = createRoom(5);
  initializeGame(room);
  room.phase = "executive";
  room.power = "investigate";
  room.presidentId = "p1";
  const target = room.players.find((player) => player.userId !== "p1");

  applyAction(room, "p1", "investigate", { targetId: target.userId });

  assert.equal(privateState(room, "p1").privateIntel[0].party, target.party);
  assert.deepEqual(privateState(room, "p2").privateIntel, []);
  assert.equal(JSON.stringify(publicState(room)).includes('"party"'), false);
});

test("a chaos policy advances the Presidential rotation exactly once", () => {
  const room = createRoom(6);
  initializeGame(room);
  room.phase = "voting";
  room.presidentId = "p1";
  room.chancellorId = "p2";
  room.electionTracker = 2;
  room.ballots = Object.fromEntries(room.players
    .filter((player) => player.userId !== "p1")
    .map((player) => [player.userId, false]));

  applyAction(room, "p1", "vote", { ja: false });

  assert.equal(room.phase, "election");
  assert.equal(room.presidentId, "p2");
  assert.equal(room.electionTracker, 0);
  assert.equal(room.liberalPolicies + room.fascistPolicies, 1);
});

test("chaos resets the term limits for the next Chancellor nomination", () => {
  const room = createRoom(6);
  initializeGame(room);
  room.phase = "voting";
  room.presidentId = "p1";
  room.chancellorId = "p3";
  room.lastElectedPresidentId = "p2";
  room.lastElectedChancellorId = "p4";
  room.electionTracker = 2;
  room.ballots = Object.fromEntries(room.players
    .filter((player) => player.userId !== "p1")
    .map((player) => [player.userId, false]));

  applyAction(room, "p1", "vote", { ja: false });

  assert.equal(room.lastElectedPresidentId, null);
  assert.equal(room.lastElectedChancellorId, null);
  assert.equal(room.phase, "election");
});

test("Mongo room documents track nested vote and private-intel updates", () => {
  const room = new SecretHitlerRoom({
    code: "ABCDE",
    hostId: "p1",
    phase: "voting",
    players: Array.from({ length: 5 }, (_, index) => ({
      userId: `p${index + 1}`,
      username: `Player ${index + 1}`,
    })),
    presidentId: "p1",
    chancellorId: "p2",
    ballots: {},
    privateIntel: {},
    drawPile: ["liberal", "fascist", "liberal"],
  });

  applyAction(room, "p1", "vote", { ja: true });
  assert.equal(room.isModified("ballots"), true);

  room.phase = "executive";
  room.power = "investigate";
  room.presidentId = "p1";
  applyAction(room, "p1", "investigate", { targetId: "p2" });
  assert.equal(room.isModified("privateIntel"), true);
});

test("starting a rematch restores every player and deals fresh roles", () => {
  const room = createRoom(5);
  initializeGame(room);
  room.players[0].alive = false;
  initializeGame(room);

  assert.equal(room.players.length, 5);
  assert.ok(room.players.every((player) => player.alive));
  assert.equal(room.players.filter((player) => player.role === "hitler").length, 1);
});
