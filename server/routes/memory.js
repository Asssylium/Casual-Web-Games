const crypto = require("crypto");
const express = require("express");
const MemoryRoom = require("../models/MemoryRoom");
const requireAuth = require("../middleware/auth");
const { canPassCard, resolveClaim, CARD_CATALOG } = require("../games/memory");
const { getRealtime, publishRoom } = require("../realtime/ably");

const router = express.Router();
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const REVEAL_MS = 12_000;
const PLAYER_TIMEOUT_MS = 45_000;
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
      eliminated: player.eliminated,
      connected: player.connected,
      cardCount: player.hand.length,
    })),
    currentTurnId: room.currentTurnId,
    pending,
    revealEndsAt: room.revealEndsAt,
    revealCards: room.phase === "reveal" ? room.revealCards : null,
    lastReveal: room.lastReveal,
    notice: room.notice,
    winnerId: room.winnerId,
  };
}

function playerHand(room, userId) {
  const player = room.players.find((item) => item.userId === userId);
  return {
    cards: player && !player.eliminated ? player.hand : [],
    blockedCardId: player?.blockedCardId || null,
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

function activePlayers(room) {
  return room.players.filter((player) => !player.eliminated);
}

function connectedPlayers(room) {
  return room.players.filter((player) => player.connected && !player.eliminated);
}

function markStalePlayers(room, now = Date.now()) {
  let changed = false;
  for (const player of room.players) {
    const lastSeenAt = player.lastSeenAt ? new Date(player.lastSeenAt).getTime() : 0;
    if (player.connected && now - lastSeenAt > PLAYER_TIMEOUT_MS) {
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
  if (activePlayers(room).length <= 1) {
    room.phase = "finished";
    room.winnerId = activePlayers(room)[0]?.userId || null;
    room.currentTurnId = room.winnerId;
    return;
  }

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

function finishTurnAfterElimination(room, eliminatedId, preferredId) {
  const eliminated = playerById(room, eliminatedId);
  if (eliminated) {
    eliminated.eliminated = true;
    eliminated.hand = [];
  }
  advanceTo(room, preferredId);
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function beginMemoryPhase(room) {
  const dealt = shuffle(CARD_CATALOG).slice(0, room.players.length).map((card) => ({
    ...card,
    id: crypto.randomUUID(),
  }));
  room.players.forEach((player, index) => {
    player.eliminated = false;
    player.hand = [dealt[index]];
    player.blockedCardId = null;
  });
  room.phase = "reveal";
  room.pending = undefined;
  room.lastReveal = null;
  room.winnerId = null;
  room.currentTurnId = null;
  room.notice = "Memorize everyone's card and its direction.";
  room.revealEndsAt = Date.now() + REVEAL_MS;
  room.revealCards = room.players.map((player) => ({
    playerId: player.userId,
    username: player.username,
    ...(player.hand[0].toObject ? player.hand[0].toObject() : player.hand[0]),
  }));
}

function completeReveal(room) {
  if (room.phase !== "reveal" || room.revealEndsAt > Date.now()) return false;
  room.phase = "playing";
  room.revealCards = null;
  room.revealEndsAt = null;
  const eligible = connectedPlayers(room).filter((player) => player.hand.length > 0);
  room.currentTurnId = eligible.length
    ? eligible[crypto.randomInt(eligible.length)].userId
    : null;
  room.notice = eligible.length
    ? "The first player is chosen at random."
    : "Waiting for a player to reconnect.";
  return true;
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

    if (completeReveal(room) || presenceChanged) await saveAndReply(room, userId, res);
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
    if (eventName !== "game:cancel" && completeReveal(room)) {
      await room.save();
      await broadcastRoom(room);
    }
    const player = findPlayer(room, userId);
    if (!player) return sendFailure(res, 403, "You are not a player in this room");
    const presenceChanged = markStalePlayers(room);

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

    player.connected = true;
    player.lastSeenAt = new Date();

    if (eventName === "game:heartbeat") {
      await room.save();
      if (presenceChanged) await broadcastRoom(room);
      return res.json({ ok: true, ...resultFor(room, userId) });
    }

    if (eventName === "game:reconnect") {
      if (player.eliminated) return sendFailure(res, 403, "You are no longer in this game");
      if (room.phase === "playing" && !room.currentTurnId) room.currentTurnId = userId;
      room.notice = `${username} reconnected.`;
    } else if (eventName === "game:start") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can start");
      if (room.phase !== "lobby" && room.phase !== "finished") {
        return sendFailure(res, 409, "The game is already in progress");
      }
      if (connectedPlayers(room).length < MIN_PLAYERS) {
        return sendFailure(res, 409, `At least ${MIN_PLAYERS} players are needed`);
      }
      if (room.phase === "finished") room.round += 1;
      beginMemoryPhase(room);
    } else if (eventName === "game:pass") {
      if (room.phase !== "playing") return sendFailure(res, 409, "The game is not accepting a pass");
      if (room.currentTurnId !== userId) return sendFailure(res, 403, "It is not your turn");
      if (room.pending?.card) return sendFailure(res, 409, "A card is already being considered");
      const { cardId, direction, claimedName } = payload;
      const cardIndex = player.hand.findIndex((card) => card.id === cardId);
      if (cardIndex < 0) return sendFailure(res, 400, "That card is not in your hand");
      if (!canPassCard(player, cardId)) {
        return sendFailure(res, 400, "You must keep the card you just received for this turn");
      }
      const card = player.hand[cardIndex];
      if (card.direction !== "both" && card.direction !== direction) {
        return sendFailure(res, 400, "That card can only pass in its indicated direction");
      }
      const claim = typeof claimedName === "string" ? claimedName.trim() : "";
      if (!claim || claim.length > 40) {
        return sendFailure(res, 400, "Enter a claim between 1 and 40 characters");
      }
      const receiver = findTarget(room, player, direction);
      if (!receiver) return sendFailure(res, 409, "There is no player in that direction");
      player.hand.splice(cardIndex, 1);
      room.pending = { card, fromId: userId, toId: receiver.userId, claimedName: claim, direction };
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
        player.hand.push(pending.card);
        player.blockedCardId = pending.card.id;
        room.lastReveal = null;
        room.pending = undefined;
        room.notice = `${player.username} accepted the card.`;
        advanceTo(room, userId);
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
        if (outcome === "lie") {
          room.notice = `${player.username} caught the lie. ${giver?.username || "The giver"} is out.`;
          player.hand.push(pending.card);
          player.blockedCardId = pending.card.id;
          finishTurnAfterElimination(room, pending.fromId, userId);
        } else {
          room.notice = `${player.username} challenged a truthful claim and is out.`;
          if (giver) giver.hand.push(pending.card);
          finishTurnAfterElimination(room, userId, giver?.userId);
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

    return saveAndReply(room, userId, res);
  } catch (error) {
    next(error);
  }
});

module.exports = { router, handChannel, roomChannel, resultFor, publicState, playerHand, markStalePlayers };