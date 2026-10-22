const crypto = require("crypto");

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 10;
const ROLE_COUNTS = {
  5: { liberal: 3, fascist: 1 },
  6: { liberal: 4, fascist: 1 },
  7: { liberal: 4, fascist: 2 },
  8: { liberal: 5, fascist: 2 },
  9: { liberal: 5, fascist: 3 },
  10: { liberal: 6, fascist: 3 },
};

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function activePlayers(room) {
  return room.players.filter((player) => player.alive !== false);
}

function playerById(room, userId) {
  return room.players.find((player) => player.userId === userId);
}

function markModified(room, path) {
  room.markModified?.(path);
}

function roleDeck(playerCount) {
  const counts = ROLE_COUNTS[playerCount];
  if (!counts) throw new Error(`Games require ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  return shuffle([
    ...Array(counts.liberal).fill("liberal"),
    ...Array(counts.fascist).fill("fascist"),
    "hitler",
  ]);
}

function policyDeck() {
  return shuffle([...Array(6).fill("liberal"), ...Array(11).fill("fascist")]);
}

function nextLivingPlayerId(room, userId) {
  const start = room.players.findIndex((player) => player.userId === userId);
  if (start < 0) return activePlayers(room)[0]?.userId || null;
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(start + offset) % room.players.length];
    if (candidate.alive !== false) return candidate.userId;
  }
  return null;
}

function initializeGame(room) {
  const players = room.players;
  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new Error(`Games require ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
  }

  const roles = roleDeck(players.length);
  players.forEach((player, index) => {
    player.role = roles[index];
    player.party = roles[index] === "liberal" ? "liberal" : "fascist";
    player.alive = true;
  });

  room.initialPlayerCount = players.length;
  room.phase = "role-reveal";
  room.phaseEndsAt = Date.now() + 20_000;
  room.nextPresidentId = players[crypto.randomInt(players.length)].userId;
  room.presidentId = null;
  room.chancellorId = null;
  room.lastElectedPresidentId = null;
  room.lastElectedChancellorId = null;
  room.specialElectionAnchorId = null;
  room.round = 0;
  room.electionTracker = 0;
  room.liberalPolicies = 0;
  room.fascistPolicies = 0;
  room.drawPile = policyDeck();
  room.discardPile = [];
  room.presidentHand = [];
  room.chancellorHand = [];
  room.ballots = {};
  room.ballotResults = null;
  room.investigatedPlayerIds = [];
  room.privateIntel = Object.fromEntries(players.map((player) => [player.userId, []]));
  room.power = null;
  room.winnerTeam = null;
  room.winnerReason = null;
  room.lastEnactedPolicy = null;
  room.notice = "Privately review your role. The first President will be chosen at random.";
}

function beginElection(room) {
  if (room.phase === "finished") return;
  let presidentId = room.nextPresidentId;
  if (!playerById(room, presidentId) || playerById(room, presidentId).alive === false) {
    presidentId = nextLivingPlayerId(room, room.presidentId || room.players.at(-1)?.userId);
  }
  room.phase = "election";
  room.phaseEndsAt = null;
  room.round += 1;
  room.presidentId = presidentId;
  room.chancellorId = null;
  room.ballots = {};
  room.presidentHand = [];
  room.chancellorHand = [];
  room.power = null;
  room.notice = `${playerById(room, presidentId)?.username || "The President"} is the Presidential Candidate.`;
}

function completeRoleReveal(room, now = Date.now()) {
  if (room.phase !== "role-reveal" || room.phaseEndsAt > now) return false;
  beginElection(room);
  return true;
}

function eligibleChancellors(room) {
  const active = activePlayers(room);
  const fiveOrFewerRemain = active.length <= 5;
  return active.filter((player) => {
    if (player.userId === room.presidentId) return false;
    if (player.userId === room.lastElectedChancellorId) return false;
    if (!fiveOrFewerRemain && player.userId === room.lastElectedPresidentId) return false;
    return true;
  });
}

function fascistPowerFor(playerCount, fascistPolicyCount) {
  const tracks = {
    5: [null, null, "policy-peek", "execute", "execute"],
    6: [null, null, "policy-peek", "execute", "execute"],
    7: [null, "investigate", "special-election", "execute", "execute"],
    8: [null, "investigate", "special-election", "execute", "execute"],
    9: ["investigate", "investigate", "special-election", "execute", "execute"],
    10: ["investigate", "investigate", "special-election", "execute", "execute"],
  };
  return tracks[playerCount]?.[fascistPolicyCount - 1] || null;
}

function finishGame(room, team, reason) {
  room.phase = "finished";
  room.phaseEndsAt = null;
  room.winnerTeam = team;
  room.winnerReason = reason;
  room.power = null;
  room.notice = team === "liberal" ? "The Liberals win." : "The Fascists win.";
}

function refillPolicyDeck(room) {
  if (room.drawPile.length >= 3) return;
  room.drawPile = shuffle([...room.drawPile, ...room.discardPile]);
  room.discardPile = [];
}

function nextElection(room) {
  if (room.phase === "finished") return;
  const rotationAnchor = room.specialElectionAnchorId || room.presidentId;
  room.nextPresidentId = nextLivingPlayerId(room, rotationAnchor);
  room.specialElectionAnchorId = null;
  beginElection(room);
}

function winIfPoliciesComplete(room) {
  if (room.liberalPolicies >= 5) {
    finishGame(room, "liberal", "five-liberal-policies");
    return true;
  }
  if (room.fascistPolicies >= 6) {
    finishGame(room, "fascist", "six-fascist-policies");
    return true;
  }
  return false;
}

function enactPolicy(room, policy, { ignorePower = false, deferElection = false } = {}) {
  room.lastEnactedPolicy = policy;
  if (policy === "liberal") room.liberalPolicies += 1;
  else room.fascistPolicies += 1;
  room.electionTracker = 0;
  room.presidentHand = [];
  room.chancellorHand = [];
  if (winIfPoliciesComplete(room)) return;

  room.power = !ignorePower && policy === "fascist"
    ? fascistPowerFor(room.initialPlayerCount, room.fascistPolicies)
    : null;
  if (room.power) {
    room.phase = "executive";
    room.notice = `The President must use the ${room.power} power.`;
    return;
  }
  if (deferElection) return;
  nextElection(room);
}

function chaosPolicy(room) {
  if (!room.drawPile.length) refillPolicyDeck(room);
  const policy = room.drawPile.shift();
  if (!policy) throw new Error("No policy is available to enact");
  room.lastElectedPresidentId = null;
  room.lastElectedChancellorId = null;
  room.notice = "Three governments failed. The top policy is enacted without a power.";
  enactPolicy(room, policy, { ignorePower: true, deferElection: true });
  if (room.phase !== "finished") nextElection(room);
}

function resolveBallot(room) {
  const voters = activePlayers(room);
  if (voters.some((player) => typeof room.ballots[player.userId] !== "boolean")) return;

  const yesIds = voters.filter((player) => room.ballots[player.userId]).map((player) => player.userId);
  const noIds = voters.filter((player) => !room.ballots[player.userId]).map((player) => player.userId);
  room.ballotResults = { yesIds, noIds, passed: yesIds.length > voters.length / 2 };
  room.ballots = {};

  if (!room.ballotResults.passed) {
    room.electionTracker += 1;
    room.notice = "The government was rejected.";
    if (room.electionTracker >= 3) {
      room.electionTracker = 0;
      chaosPolicy(room);
    } else {
      nextElection(room);
    }
    return;
  }

  room.electionTracker = 0;
  room.lastElectedPresidentId = room.presidentId;
  room.lastElectedChancellorId = room.chancellorId;
  const chancellor = playerById(room, room.chancellorId);
  if (room.fascistPolicies >= 3 && chancellor?.role === "hitler") {
    finishGame(room, "fascist", "hitler-elected-chancellor");
    return;
  }

  refillPolicyDeck(room);
  room.presidentHand = room.drawPile.splice(0, 3);
  room.phase = "legislative-president";
  room.notice = "The President is reviewing three policies in private.";
}

function requirePhase(room, phase) {
  if (room.phase !== phase) throw new Error("That action is not available right now");
}

function requirePresident(room, userId) {
  if (room.presidentId !== userId) throw new Error("Only the President can do that");
}

function requireChancellor(room, userId) {
  if (room.chancellorId !== userId) throw new Error("Only the Chancellor can do that");
}

function requireIndex(hand, index) {
  if (!Number.isInteger(index) || index < 0 || index >= hand.length) {
    throw new Error("Choose a policy in your hand");
  }
}

function discardAndPass(room, index) {
  requireIndex(room.presidentHand, index);
  room.discardPile.push(...room.presidentHand.splice(index, 1));
  room.chancellorHand = room.presidentHand;
  room.presidentHand = [];
  room.phase = "legislative-chancellor";
  room.notice = "The Chancellor is reviewing two policies in private.";
}

function recordIntel(room, userId, intel) {
  room.privateIntel[userId] ||= [];
  room.privateIntel[userId].push({ ...intel, at: Date.now() });
  markModified(room, "privateIntel");
}

function applyAction(room, userId, action, payload = {}) {
  completeRoleReveal(room);
  const actor = playerById(room, userId);
  if (!actor || actor.alive === false) throw new Error("You are not an active player in this game");

  if (action === "nominate") {
    requirePhase(room, "election");
    requirePresident(room, userId);
    if (!eligibleChancellors(room).some((player) => player.userId === payload.candidateId)) {
      throw new Error("That player is not eligible to be Chancellor");
    }
    room.chancellorId = payload.candidateId;
    room.ballots = {};
    room.ballotResults = null;
    room.phase = "voting";
    room.notice = `${actor.username} nominated ${playerById(room, room.chancellorId).username}. Vote Ja or Nein.`;
  } else if (action === "vote") {
    requirePhase(room, "voting");
    if (typeof payload.ja !== "boolean") throw new Error("Cast a Ja or Nein vote");
    if (Object.hasOwn(room.ballots, userId)) throw new Error("You have already voted");
    room.ballots[userId] = payload.ja;
    markModified(room, "ballots");
    resolveBallot(room);
  } else if (action === "president-discard") {
    requirePhase(room, "legislative-president");
    requirePresident(room, userId);
    discardAndPass(room, payload.index);
  } else if (action === "chancellor-enact") {
    requirePhase(room, "legislative-chancellor");
    requireChancellor(room, userId);
    requireIndex(room.chancellorHand, payload.index);
    const [policy] = room.chancellorHand.splice(payload.index, 1);
    room.discardPile.push(...room.chancellorHand);
    room.chancellorHand = [];
    enactPolicy(room, policy);
  } else if (action === "veto-request") {
    requirePhase(room, "legislative-chancellor");
    requireChancellor(room, userId);
    if (room.fascistPolicies < 5) throw new Error("Veto power is not unlocked yet");
    room.phase = "veto-response";
    room.notice = "The Chancellor requested a veto. The President must respond.";
  } else if (action === "veto-response") {
    requirePhase(room, "veto-response");
    requirePresident(room, userId);
    if (typeof payload.agree !== "boolean") throw new Error("Choose whether to approve the veto");
    if (!payload.agree) {
      room.phase = "legislative-chancellor";
      room.notice = "The President denied the veto. The Chancellor must enact a policy.";
    } else {
      room.discardPile.push(...room.chancellorHand);
      room.chancellorHand = [];
      room.electionTracker += 1;
      room.notice = "The agenda was vetoed.";
      if (room.electionTracker >= 3) {
        room.electionTracker = 0;
        chaosPolicy(room);
      } else {
        nextElection(room);
      }
    }
  } else if (action === "investigate") {
    requirePhase(room, "executive");
    requirePresident(room, userId);
    if (room.power !== "investigate") throw new Error("Investigate power is not active");
    const target = playerById(room, payload.targetId);
    if (!target || target.alive === false || target.userId === userId) {
      throw new Error("Choose another active player");
    }
    if (room.investigatedPlayerIds.includes(target.userId)) {
      throw new Error("That player has already been investigated");
    }
    room.investigatedPlayerIds.push(target.userId);
    recordIntel(room, userId, {
      type: "investigation",
      playerId: target.userId,
      username: target.username,
      party: target.party,
    });
    room.power = null;
    nextElection(room);
  } else if (action === "special-election") {
    requirePhase(room, "executive");
    requirePresident(room, userId);
    if (room.power !== "special-election") throw new Error("Special election power is not active");
    const target = playerById(room, payload.targetId);
    if (!target || target.alive === false || target.userId === userId) {
      throw new Error("Choose another active player");
    }
    room.specialElectionAnchorId = room.presidentId;
    room.nextPresidentId = target.userId;
    room.power = null;
    beginElection(room);
  } else if (action === "policy-peek") {
    requirePhase(room, "executive");
    requirePresident(room, userId);
    if (room.power !== "policy-peek") throw new Error("Policy peek power is not active");
    refillPolicyDeck(room);
    recordIntel(room, userId, { type: "policy-peek", policies: room.drawPile.slice(0, 3) });
    room.power = null;
    nextElection(room);
  } else if (action === "execute") {
    requirePhase(room, "executive");
    requirePresident(room, userId);
    if (room.power !== "execute") throw new Error("Execution power is not active");
    const target = playerById(room, payload.targetId);
    if (!target || target.alive === false || target.userId === userId) {
      throw new Error("Choose another active player");
    }
    target.alive = false;
    room.power = null;
    if (target.role === "hitler") {
      finishGame(room, "liberal", "hitler-executed");
    } else {
      room.notice = `${target.username} was executed. Their party remains secret.`;
      nextElection(room);
    }
  } else {
    throw new Error("Unknown game action");
  }
}

function publicState(room) {
  const voting = room.phase === "voting";
  const finished = room.phase === "finished";
  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    round: room.round,
    initialPlayerCount: room.initialPlayerCount || room.players.length,
    players: room.players.map((player) => ({
      id: player.userId,
      username: player.username,
      isBot: player.isBot,
      alive: player.alive !== false,
      connected: player.connected,
      role: finished ? player.role : undefined,
      party: finished ? player.party : undefined,
    })),
    presidentId: room.presidentId,
    chancellorId: room.chancellorId,
    eligibleChancellorIds: room.phase === "election"
      ? eligibleChancellors(room).map((player) => player.userId)
      : [],
    votesSubmitted: voting ? Object.keys(room.ballots).length : null,
    ballotResults: room.ballotResults,
    electionTracker: room.electionTracker,
    liberalPolicies: room.liberalPolicies,
    fascistPolicies: room.fascistPolicies,
    drawPileCount: room.drawPile.length,
    discardPileCount: room.discardPile.length,
    investigatedPlayerIds: room.investigatedPlayerIds,
    power: room.phase === "executive" ? room.power : null,
    lastEnactedPolicy: room.lastEnactedPolicy,
    phaseEndsAt: room.phaseEndsAt,
    winnerTeam: room.winnerTeam,
    winnerReason: room.winnerReason,
    notice: room.notice,
  };
}

function privateState(room, userId) {
  const player = playerById(room, userId);
  if (!player) return null;
  const knowsFaction = player.role !== "hitler" || room.initialPlayerCount <= 6;
  const knownPlayers = player.party === "fascist" && knowsFaction
    ? room.players
      .filter((other) => other.party === "fascist")
      .map((other) => ({ id: other.userId, username: other.username, role: other.role }))
    : [];

  return {
    role: player.role,
    party: player.party,
    knownPlayers,
    hasVoted: Object.hasOwn(room.ballots || {}, userId),
    ownVote: Object.hasOwn(room.ballots || {}, userId) ? room.ballots[userId] : null,
    privateIntel: room.privateIntel?.[userId] || [],
    policyHand: room.phase === "legislative-president" && room.presidentId === userId
      ? room.presidentHand
      : room.phase === "legislative-chancellor" && room.chancellorId === userId
        ? room.chancellorHand
        : [],
  };
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  ROLE_COUNTS,
  activePlayers,
  applyAction,
  beginElection,
  completeRoleReveal,
  eligibleChancellors,
  fascistPowerFor,
  initializeGame,
  policyDeck,
  privateState,
  publicState,
  roleDeck,
};
