const crypto = require("crypto");
const express = require("express");
const MemoryRoom = require("../models/MemoryRoom");
const requireAuth = require("../middleware/auth");
const { resolveClaim, CARD_CATALOG } = require("../games/memory");
const { getRealtime, publishRoom } = require("../realtime/ably");
const { createBot, coin } = require("../bots");

const router = express.Router();
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const REVEAL_MS = 12_000;
const DRAW_REVEAL_MS = 5_000;
const PLAYER_TIMEOUT_MS = 45_000;
const PENALTY_LIMIT = 3;
const GIFT_DIRECTIONS = ["left", "right", "both"];
const ROOM_CODE_LENGTH = 5;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function roomChannel(code) {
  return `memory:${code}:state`;
}

function handChannel(code, userId) {
  return `memory:${code}:player:${userId}`;
}

function publicState(room) {
  const pending = room.pending?.card
    ? {
        fromId: room.pending.fromId,
        fromName: room.players.find((player) => player.userId === room.pending.fromId)?.username,
        toId: room.pending.toId,
        toName: room.players.find((player) => player.userId === room.pending.toId)?.username,
        claimedName: room.pending.claimedName,
        direction: room.pending.direction,
      }
    : null;

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    round: room.round,
    players: room.players.map((player) => ({
      id: player.userId,
      username: player.username,
      isBot: player.isBot,
      eliminated: player.eliminated,
      connected: player.connected,
      cardCount: player.hand.length,
      penaltyCount: player.penaltyCards?.length || 0,
      giftDirections: player.hand.map((card) => card.direction),
    })),
    currentTurnId: room.currentTurnId,
    giftShopCount: room.drawPile?.length || 0,
    drawnBy: room.drawnBy,
    revealedGift: room.phase === "gift-reveal" ? room.drawnCard : null,
    pending,
    revealEndsAt: room.revealEndsAt,
    revealCards: room.phase === "reveal" ? room.revealCards : null,
    lastReveal: room.lastReveal,
    notice: room.notice,
    winnerId: room.winnerId,
    winnerIds: room.winnerIds,
  };
}

function playerHand(room, userId) {
  const player = room.players.find((item) => item.userId === userId);
  return {
    cards: player && !player.eliminated ? player.hand : [],
    blockedCardId: player?.blockedCardId || null,
    drawnCard: room.drawnBy === userId ? room.drawnCard : null,
  };
}

function resultFor(room, userId) {
  return {
    room: publicState(room),
    hand: playerHand(room, userId),
    objects: CARD_CATALOG.map(({ name, icon, direction }) => ({ name, icon, direction })),
  };
}

function findPlayer(room, userId) {
  return room.players.find((player) => player.userId === userId);
}

function connectedPlayers(room) {
  return room.players.filter((player) => player.connected && !player.eliminated);
}

function markStalePlayers(room, now = Date.now()) {
  let changed = false;
  for (const player of room.players) {
    const lastSeenAt = player.lastSeenAt ? new Date(player.lastSeenAt).getTime() : 0;
    if (!player.isBot && player.connected && now - lastSeenAt > PLAYER_TIMEOUT_MS) {
      player.connected = false;
      changed = true;
    }
  }
  return changed;
}

function playerById(room, userId) {
  return findPlayer(room, userId);
}

function advanceTo(room, userId) {
  const player = playerById(room, userId);
  if (player && !player.eliminated && player.connected && player.hand.length > 0) {
    room.currentTurnId = player.userId;
    return;
  }

  const start = Math.max(0, room.players.findIndex((item) => item.userId === userId));
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(start + offset) % room.players.length];
    if (!candidate.eliminated && candidate.connected && candidate.hand.length > 0) {
      room.currentTurnId = candidate.userId;
      return;
    }
  }

  room.currentTurnId = null;
  room.notice = "Waiting for a connected player to resume.";
}

function findTarget(room, giver, direction) {
  const start = room.players.findIndex((player) => player.userId === giver.userId);
  const step = direction === "left" ? -1 : 1;
  for (let offset = 1; offset < room.players.length; offset += 1) {
    const index = (start + step * offset + room.players.length * 2) % room.players.length;
    const player = room.players[index];
    if (!player.eliminated && player.connected) return player;
  }
  return null;
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function createGift(card, directionIndex = crypto.randomInt(GIFT_DIRECTIONS.length)) {
  return {
    ...card,
    id: crypto.randomUUID(),
    direction: GIFT_DIRECTIONS[directionIndex],
  };
}

function createGiftDeck(cycle = 0) {
  return CARD_CATALOG.map((card) => {
    const variant = cycle === 0
      ? card
      : {
          ...card,
          name: `${card.name} ${cycle + 1}`,
          icon: `${card.icon}${"✨".repeat(Math.min(cycle, 3))}${cycle > 3 ? cycle : ""}`,
        };
    return createGift(variant);
  });
}

function refillGiftShop(room) {
  const usedNames = new Set(room.usedGiftNames || []);
  const unusedCards = CARD_CATALOG.filter((card) => !usedNames.has(card.name));
  if (unusedCards.length) {
    room.drawPile = shuffle(unusedCards.map((card) => createGift(card)));
    return;
  }

  room.giftShopRefills = (room.giftShopRefills || 0) + 1;
  room.drawPile = shuffle(createGiftDeck(room.giftShopRefills));
}

function giftToPass(room, player, userId) {
  if (room.drawnBy === userId && room.drawnCard) {
    return {
      card: room.drawnCard.toObject ? room.drawnCard.toObject() : { ...room.drawnCard },
      isDrawnGift: true,
    };
  }
  if (player.hand.length >= 2) {
    return {
      card: player.hand[0].toObject ? player.hand[0].toObject() : { ...player.hand[0] },
      isDrawnGift: false,
    };
  }
  return null;
}

function resolvePassDirection(card, requestedDirection) {
  if (card.direction !== "both") return card.direction;
  return requestedDirection === "right" ? "right" : "left";
}

function beginMemoryPhase(room, startingPlayerId) {
  const gifts = shuffle(createGiftDeck());
  room.players.forEach((player, index) => {
    player.eliminated = false;
    player.hand = [gifts[index]];
    player.penaltyCards = [];
    player.blockedCardId = null;
    player.lastGiftGiverId = null;
  });
  room.drawPile = gifts.slice(room.players.length);
  room.usedGiftNames = gifts.slice(0, room.players.length).map((gift) => gift.name);
  room.giftShopRefills = 0;
  room.drawnCard = undefined;
  room.drawnBy = null;
  room.startingPlayerId = startingPlayerId;
  room.phase = "reveal";
  room.pending = undefined;
  room.lastReveal = null;
  room.winnerId = null;
  room.winnerIds = [];
  room.currentTurnId = startingPlayerId;
  room.notice = "Memorize everyone's card and its direction.";
  room.revealEndsAt = Date.now() + REVEAL_MS;
  room.revealCards = room.players.map((player) => ({
    playerId: player.userId,
    username: player.username,
    ...(player.hand[0].toObject ? player.hand[0].toObject() : player.hand[0]),
  }));
}

function completeReveal(room) {
  if (room.phase === "gift-reveal" && room.revealEndsAt <= Date.now()) {
    room.phase = "playing";
    room.revealEndsAt = null;
    room.notice = "The gift is ready to pass.";
    return true;
  }
  if (room.phase !== "reveal" || room.revealEndsAt > Date.now()) return false;
  room.phase = "playing";
  room.revealCards = null;
  room.revealEndsAt = null;
  advanceTo(room, room.startingPlayerId);
  room.notice = room.currentTurnId
    ? `${playerById(room, room.currentTurnId)?.username}'s turn.`
    : "Waiting for a player to reconnect.";
  return true;
}

function awardPenalty(room, player, card) {
  player.penaltyCards.push(card);
  if (player.penaltyCards.length < PENALTY_LIMIT) return false;

  const lowestScore = Math.min(...room.players.map((item) => item.penaltyCards.length));
  room.winnerIds = room.players
    .filter((item) => item.penaltyCards.length === lowestScore)
    .map((item) => item.userId);
  room.winnerId = room.winnerIds.length === 1 ? room.winnerIds[0] : null;
  room.phase = "finished";
  room.currentTurnId = null;
  room.drawnCard = undefined;
  room.drawnBy = null;
  room.revealEndsAt = null;
  room.notice = room.winnerIds.length === 1
    ? `${room.players.find((item) => item.userId === room.winnerId)?.username} wins with the fewest penalty points.`
    : "The game is tied for the fewest penalty points.";
  return true;
}

function acceptGift(room, player, pending, giver) {
  const card = pending.card.toObject ? pending.card.toObject() : { ...pending.card };
  const outcome = resolveClaim(card, pending.claimedName);
  if (outcome === "truth") {
    player.hand.push(card);
    player.blockedCardId = card.id;
    room.lastReveal = null;
    room.notice = `${player.username} accepted the correctly named gift.`;
    return outcome;
  }

  room.lastReveal = {
    fromName: giver?.username || "A player",
    toName: player.username,
    claimedName: pending.claimedName,
    card: { name: card.name, icon: card.icon, direction: pending.direction },
    outcome: "accepted-lie",
  };
  awardPenalty(room, player, card);
  room.lastReveal.penaltyPlayerId = player.userId;
  room.lastReveal.penaltyPlayerName = player.username;
  room.lastReveal.penaltyCount = player.penaltyCards.length;
  room.notice = `${player.username} accepted a false claim and receives a penalty point.`;
  return outcome;
}

function runMemoryBots(room) {
  let changed = false;
  for (let step = 0; step < 12; step += 1) {
    completeReveal(room);
    if (room.phase !== "playing") return changed;
    const receiver = room.pending && playerById(room, room.pending.toId);
    if (room.pending && receiver?.isBot) {
      const pending = room.pending;
      const giver = playerById(room, pending.fromId);
      if (coin(0.3)) {
        const outcome = resolveClaim(pending.card, pending.claimedName);
        const penalized = outcome === "lie" ? giver : receiver;
        if (!penalized) return changed;
        awardPenalty(room, penalized, pending.card);
        room.pending = undefined;
        if (room.phase !== "finished") advanceTo(room, outcome === "lie" ? receiver.userId : giver.userId);
      } else {
        acceptGift(room, receiver, pending, giver);
        room.pending = undefined;
        if (room.phase !== "finished") advanceTo(room, receiver.userId);
      }
      changed = true;
      continue;
    }
    const bot = playerById(room, room.currentTurnId);
    if (!bot?.isBot || room.pending) return changed;
    if (bot.hand.length === 1 && !room.drawnCard) {
      if (!room.drawPile.length) refillGiftShop(room);
      room.drawnCard = room.drawPile.shift();
      room.usedGiftNames.push(room.drawnCard.name);
      room.drawnBy = bot.userId;
      room.phase = "gift-reveal";
      room.revealEndsAt = Date.now() + DRAW_REVEAL_MS;
      changed = true;
      return changed;
    }
    const gift = giftToPass(room, bot, bot.userId);
    if (!gift) return changed;
    const direction = resolvePassDirection(gift.card, gift.card.direction === "both" && coin(0.5) ? "right" : "left");
    const target = findTarget(room, bot, direction);
    if (!target) return changed;
    if (gift.isDrawnGift) { room.drawnCard = undefined; room.drawnBy = null; } else bot.hand.shift();
    room.pending = { card: gift.card, fromId: bot.userId, toId: target.userId, claimedName: coin(0.28) ? "Mysterious gift" : gift.card.name, direction };
    changed = true;
  }
  return changed;
}

async function broadcastRoom(room) {
  await publishRoom(roomChannel(room.code), "game:state", publicState(room));
  await Promise.all(room.players.map((player) =>
    publishRoom(
      handChannel(room.code, player.userId),
      "game:hand",
      playerHand(room, player.userId)
    )
  ));
}

function createCode() {
  return Array.from({ length: ROOM_CODE_LENGTH }, () =>
    ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]
  ).join("");
}

function sendFailure(res, status, error) {
  return res.status(status).json({ ok: false, error });
}

async function saveAndReply(room, userId, res) {
  try {
    await room.save();
  } catch (error) {
    if (error.name === "VersionError") {
      return sendFailure(res, 409, "The room changed. Refresh and try again.");
    }
    throw error;
  }
  await broadcastRoom(room);
  return res.json({ ok: true, ...resultFor(room, userId) });
}

router.use(requireAuth);

router.get("/ably-token", async (req, res, next) => {
  try {
    const roomCode = typeof req.query.room === "string" ? req.query.room : "";
    const userId = req.user._id.toString();
    const room = await MemoryRoom.findOne({ code: roomCode, "players.userId": userId })
      .select("code players.userId");
    if (!room) return sendFailure(res, 403, "You are not a player in this room");

    const capability = {
      [roomChannel(room.code)]: ["subscribe"],
      [handChannel(room.code, userId)]: ["subscribe"],
    };
    const token = await getRealtime().auth.requestToken({
      clientId: userId,
      capability: JSON.stringify(capability),
      ttl: 60 * 60 * 1000,
    });
    return res.type("text/plain").send(token.token);
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user._id.toString();
    const room = await MemoryRoom.findOne({ "players.userId": userId });
    if (!room) {
      return res.json({ ok: true, room: null, hand: { cards: [], blockedCardId: null }, objects: CARD_CATALOG });
    }

    const presenceChanged = markStalePlayers(room);
    if (room.players.every((player) => !player.connected)) {
      await MemoryRoom.deleteOne({ _id: room._id });
      return res.json({ ok: true, room: null, hand: { cards: [], blockedCardId: null }, objects: CARD_CATALOG });
    }

    if (completeReveal(room) || runMemoryBots(room) || presenceChanged) await saveAndReply(room, userId, res);
    else res.json({ ok: true, ...resultFor(room, userId) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  const userId = req.user._id.toString();
  const username = req.user.username;
  const { eventName, payload = {} } = req.body || {};

  try {
    let room = await MemoryRoom.findOne({ "players.userId": userId });

    if (eventName === "game:create") {
      if (room) return sendFailure(res, 409, "You are already in a game room");
      room = await MemoryRoom.create({
        code: createCode(),
        hostId: userId,
        players: [{ userId, username }],
        phase: "lobby",
        round: 1,
        notice: "Waiting for players to join.",
      });
      await broadcastRoom(room);
      return res.json({ ok: true, ...resultFor(room, userId) });
    }

    if (eventName === "game:join") {
      if (room) return sendFailure(res, 409, "You are already in a game room");
      const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
      room = await MemoryRoom.findOne({ code });
      if (!room) return sendFailure(res, 404, "Room not found");
      if (room.phase !== "lobby") return sendFailure(res, 409, "This game has already started");
      if (room.players.length >= MAX_PLAYERS) return sendFailure(res, 409, "This room is full");
      room.players.push({ userId, username, connected: true, eliminated: false, hand: [] });
      room.notice = `${username} joined the room.`;
      return saveAndReply(room, userId, res);
    }

    if (!room) return sendFailure(res, 404, "No active room was found for your account");
    if (eventName !== "game:cancel" && eventName !== "game:heartbeat" && eventName !== "game:reconnect" && completeReveal(room)) {
      await room.save();
      await broadcastRoom(room);
    }
    const player = findPlayer(room, userId);
    if (!player) return sendFailure(res, 403, "You are not a player in this room");

    if (eventName === "game:add-bot") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can add bots");
      if (room.phase !== "lobby" && room.phase !== "finished") return sendFailure(res, 409, "Bots can only be added between rounds");
      if (room.players.length >= MAX_PLAYERS) return sendFailure(res, 409, "This room is full");
      const bot = createBot(room.players);
      room.players.push({ ...bot, eliminated: false, hand: [], penaltyCards: [] });
      room.notice = `${bot.username} joined the room.`;
      return saveAndReply(room, userId, res);
    }

    if (eventName === "game:cancel") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can cancel the game");
      const code = room.code;
      await MemoryRoom.deleteOne({ _id: room._id });
      try {
        await publishRoom(roomChannel(code), "game:cancelled", { code, cancelledBy: userId });
      } catch (error) {
        console.error("Room cancellation broadcast failed:", error);
      }
      return res.json({ ok: true, room: null, hand: { cards: [], blockedCardId: null } });
    }

    if (eventName === "game:heartbeat" || eventName === "game:reconnect") {
      if (eventName === "game:reconnect" && player.eliminated) {
        return sendFailure(res, 403, "You are no longer in this game");
      }

      const now = new Date();
      const staleUserIds = room.players
        .filter((item) => item.userId !== userId && item.connected &&
          now.getTime() - new Date(item.lastSeenAt || 0).getTime() > PLAYER_TIMEOUT_MS)
        .map((item) => item.userId);
      const updates = {
        "players.$[active].connected": true,
        "players.$[active].lastSeenAt": now,
      };
      const arrayFilters = [{ "active.userId": userId }];
      if (staleUserIds.length) {
        updates["players.$[stale].connected"] = false;
        arrayFilters.push({ "stale.userId": { $in: staleUserIds } });
      }

      const filter = { _id: room._id, "players.userId": userId };
      if (eventName === "game:reconnect" && room.phase === "playing" && !room.currentTurnId) {
        filter.currentTurnId = null;
        updates.currentTurnId = userId;
      }
      await MemoryRoom.updateOne(filter, { $set: updates }, { arrayFilters });
      const freshRoom = await MemoryRoom.findById(room._id);
      if (!freshRoom) return sendFailure(res, 404, "The game room no longer exists");
      if (eventName === "game:reconnect" || staleUserIds.length) {
        await broadcastRoom(freshRoom);
      }
      return res.json({ ok: true, ...resultFor(freshRoom, userId) });
    }

    const presenceChanged = markStalePlayers(room);
    player.connected = true;
    player.lastSeenAt = new Date();

    if (eventName === "game:draw") {
      if (room.phase !== "playing") return sendFailure(res, 409, "The game is not ready for a gift draw");
      if (room.currentTurnId !== userId) return sendFailure(res, 403, "It is not your turn");
      if (room.pending?.card) return sendFailure(res, 409, "Resolve the current gift before drawing another");
      if (room.drawnCard) return sendFailure(res, 409, "A gift is already waiting to be passed");
      if (player.hand.length !== 1) {
        return sendFailure(res, 409, "Pass your oldest gift before drawing another");
      }
      if (room.drawPile.length === 0) refillGiftShop(room);
      const nextGift = room.drawPile[0].toObject
        ? room.drawPile[0].toObject()
        : { ...room.drawPile[0] };
      room.drawPile.shift();
      room.drawnCard = nextGift;
      room.usedGiftNames.push(nextGift.name);
      room.drawnBy = userId;
      room.phase = "gift-reveal";
      room.revealEndsAt = Date.now() + DRAW_REVEAL_MS;
      room.lastReveal = null;
      room.notice = `${username} drew a new gift.`;
    } else if (eventName === "game:start") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can start");
      if (room.phase !== "lobby" && room.phase !== "finished") {
        return sendFailure(res, 409, "The game is already in progress");
      }
      if (connectedPlayers(room).length < MIN_PLAYERS) {
        return sendFailure(res, 409, `At least ${MIN_PLAYERS} players are needed`);
      }
      const startingPlayerId = typeof payload.startingPlayerId === "string"
        ? payload.startingPlayerId
        : userId;
      if (!connectedPlayers(room).some((item) => item.userId === startingPlayerId)) {
        return sendFailure(res, 400, "Choose a connected starting player");
      }
      if (room.phase === "finished") room.round += 1;
      beginMemoryPhase(room, startingPlayerId);
    } else if (eventName === "game:pass") {
      if (room.phase !== "playing") return sendFailure(res, 409, "The game is not accepting a pass");
      if (room.currentTurnId !== userId) return sendFailure(res, 403, "It is not your turn");
      if (room.pending?.card) return sendFailure(res, 409, "A card is already being considered");
      const { claimedName, direction } = payload;
      const gift = giftToPass(room, player, userId);
      if (!gift) return sendFailure(res, 409, "Draw a gift or pass your oldest gift first");
      const { card } = gift;
      const claim = typeof claimedName === "string" ? claimedName.trim() : "";
      if (!claim || claim.length > 40) {
        return sendFailure(res, 400, "Enter a claim between 1 and 40 characters");
      }
      const passDirection = resolvePassDirection(card, direction);
      const receiver = findTarget(room, player, passDirection);
      if (!receiver) return sendFailure(res, 409, "There is no player in that direction");
      if (gift.isDrawnGift) {
        room.drawnCard = undefined;
        room.drawnBy = null;
      } else {
        player.hand.shift();
      }
      room.pending = { card, fromId: userId, toId: receiver.userId, claimedName: claim, direction: passDirection };
      room.lastReveal = null;
      room.notice = `${player.username} passed a card to ${receiver.username}.`;
    } else if (eventName === "game:accept" || eventName === "game:challenge") {
      if (room.phase !== "playing" || !room.pending?.card) {
        return sendFailure(res, 409, "There is no card to respond to");
      }
      if (room.pending.toId !== userId) {
        return sendFailure(res, 403, "Only the receiver can respond to this card");
      }
      const pending = room.pending;
      const giver = playerById(room, pending.fromId);
      if (eventName === "game:accept") {
        acceptGift(room, player, pending, giver);
        room.pending = undefined;
        if (room.phase !== "finished") advanceTo(room, userId);
      } else {
        const outcome = resolveClaim(pending.card, pending.claimedName);
        room.lastReveal = {
          fromName: giver?.username || "A player",
          toName: player.username,
          claimedName: pending.claimedName,
          card: {
            name: pending.card.name,
            icon: pending.card.icon,
            direction: pending.card.direction,
          },
          outcome,
        };
        const penalizedPlayer = outcome === "lie" ? giver : player;
        if (!penalizedPlayer) return sendFailure(res, 409, "The giver is no longer in this room");
        const penalizedName = penalizedPlayer.username;
        awardPenalty(room, penalizedPlayer, pending.card);
        room.lastReveal.penaltyPlayerId = penalizedPlayer.userId;
        room.lastReveal.penaltyPlayerName = penalizedName;
        room.lastReveal.penaltyCount = penalizedPlayer.penaltyCards.length;
        if (room.phase !== "finished") {
          room.notice = `${penalizedName} receives a penalty point.`;
          advanceTo(room, outcome === "lie" ? userId : giver.userId);
        }
        room.pending = undefined;
      }
    } else if (eventName === "game:leave") {
      if (room.phase !== "lobby" && room.phase !== "finished") {
        return sendFailure(res, 409, "You cannot leave while a round is in progress");
      }
      room.players = room.players.filter((item) => item.userId !== userId);
      if (room.players.length === 0) {
        await MemoryRoom.deleteOne({ _id: room._id, __v: room.__v });
        return res.json({ ok: true, room: null, hand: { cards: [], blockedCardId: null } });
      }
      if (room.hostId === userId) room.hostId = room.players[0].userId;
      room.notice = `${username} left the room.`;
    } else {
      return sendFailure(res, 400, "Unknown game action");
    }

    runMemoryBots(room);
    return saveAndReply(room, userId, res);
  } catch (error) {
    next(error);
  }
});

module.exports = {
  router,
  handChannel,
  roomChannel,
  resultFor,
  publicState,
  playerHand,
  markStalePlayers,
  createGift,
  createGiftDeck,
  refillGiftShop,
  giftToPass,
  resolvePassDirection,
  findTarget,
  beginMemoryPhase,
  awardPenalty,
  acceptGift,
};
