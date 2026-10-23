const crypto = require("crypto");
const express = require("express");
const SecretHitlerRoom = require("../models/SecretHitlerRoom");
const requireAuth = require("../middleware/auth");
const { getRealtime, publishRoom } = require("../realtime/ably");
const { createBot, isBot } = require("../bots");
const {
  MAX_PLAYERS,
  MIN_PLAYERS,
  applyAction,
  completeRoleReveal,
  eligibleChancellors,
  initializeGame,
  privateState,
  publicState,
} = require("../games/secret-hitler");
const { choose, coin } = require("../bots");

const router = express.Router();
const PLAYER_TIMEOUT_MS = 45_000;
const ROOM_CODE_LENGTH = 5;
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const scheduledBotRooms = new Set();

function roomChannel(code) {
  return `secret-hitler:${code}:state`;
}

function playerChannel(code, userId) {
  return `secret-hitler:${code}:player:${userId}`;
}

function findPlayer(room, userId) {
  return room.players.find((player) => player.userId === userId);
}

function roomState(room) {
  return {
    ...publicState(room),
    realtimeAvailable: Boolean(process.env.ABLY_API_KEY),
    chatMessages: (room.chatMessages || []).map((message) => ({
      id: message.id,
      senderId: message.senderId,
      senderName: message.senderName,
      text: message.text,
      createdAt: message.createdAt,
    })),
  };
}

function markStalePlayers(room, now = Date.now()) {
  let changed = false;
  for (const player of room.players) {
    if (!isBot(player) && player.connected && now - new Date(player.lastSeenAt || 0).getTime() > PLAYER_TIMEOUT_MS) {
      player.connected = false;
      changed = true;
    }
  }
  return changed;
}

function resultFor(room, userId) {
  return { room: roomState(room), private: privateState(room, userId) };
}

function runBots(room) {
  for (let step = 0; step < 20; step += 1) {
    completeRoleReveal(room);
    if (room.phase === "finished") return;
    const president = findPlayer(room, room.presidentId);
    const chancellor = findPlayer(room, room.chancellorId);
    try {
      if (room.phase === "election" && isBot(president)) {
        const candidate = choose(eligibleChancellors(room), 0.45);
        if (!candidate) return;
        applyAction(room, president.userId, "nominate", { candidateId: candidate.userId });
      } else if (room.phase === "voting") {
        const bot = room.players.find((player) => player.alive !== false && isBot(player) && !Object.hasOwn(room.ballots, player.userId));
        if (!bot) return;
        applyAction(room, bot.userId, "vote", { ja: coin() });
      } else if (room.phase === "legislative-president" && isBot(president)) {
        applyAction(room, president.userId, "president-discard", { index: choose([0, 1, 2], 0.5) });
      } else if (room.phase === "legislative-chancellor" && isBot(chancellor)) {
        if (room.fascistPolicies >= 5 && coin(0.18)) applyAction(room, chancellor.userId, "veto-request");
        else applyAction(room, chancellor.userId, "chancellor-enact", { index: choose([0, 1], 0.5) });
      } else if (room.phase === "veto-response" && isBot(president)) {
        applyAction(room, president.userId, "veto-response", { agree: coin(0.45) });
      } else if (room.phase === "executive" && isBot(president)) {
        if (room.power === "policy-peek") applyAction(room, president.userId, "policy-peek");
        else {
          const targets = room.players.filter((player) => player.alive !== false && player.userId !== president.userId && (room.power !== "investigate" || !room.investigatedPlayerIds.includes(player.userId)));
          const target = choose(targets, 0.55);
          if (!target) return;
          applyAction(room, president.userId, room.power, { targetId: target.userId });
        }
      } else return;
    } catch { return; }
  }
}

function botNeedsTurn(room) {
  if (room.phase === "role-reveal") return room.players.some((player) => isBot(player));
  if (room.phase === "election") return isBot(findPlayer(room, room.presidentId));
  if (room.phase === "voting") return room.players.some((player) => player.alive !== false && isBot(player) && !Object.hasOwn(room.ballots, player.userId));
  if (room.phase === "legislative-president") return isBot(findPlayer(room, room.presidentId));
  if (room.phase === "legislative-chancellor") return isBot(findPlayer(room, room.chancellorId));
  if (room.phase === "veto-response" || room.phase === "executive") return isBot(findPlayer(room, room.presidentId));
  return false;
}

function scheduleBotTurn(room) {
  if (!botNeedsTurn(room)) return;
  const roomId = room._id.toString();
  if (scheduledBotRooms.has(roomId)) return;
  scheduledBotRooms.add(roomId);
  const thinkingDelay = 3_000 + crypto.randomInt(2_001);
  const delay = room.phase === "role-reveal" && room.phaseEndsAt
    ? Math.max(thinkingDelay, room.phaseEndsAt - Date.now() + thinkingDelay)
    : thinkingDelay;
  setTimeout(async () => {
    scheduledBotRooms.delete(roomId);
    try {
      const freshRoom = await SecretHitlerRoom.findById(roomId);
      if (!freshRoom) return;
      const before = `${freshRoom.phase}:${freshRoom.round}:${freshRoom.liberalPolicies}:${freshRoom.fascistPolicies}:${Object.keys(freshRoom.ballots || {}).length}:${freshRoom.power || ""}`;
      runBots(freshRoom);
      const after = `${freshRoom.phase}:${freshRoom.round}:${freshRoom.liberalPolicies}:${freshRoom.fascistPolicies}:${Object.keys(freshRoom.ballots || {}).length}:${freshRoom.power || ""}`;
      if (before !== after) {
        await freshRoom.save();
        await broadcastRoom(freshRoom);
      }
      scheduleBotTurn(freshRoom);
    } catch (error) {
      console.error("Secret Hitler bot turn failed:", error);
    }
  }, delay);
}

async function broadcastRoom(room) {
  if (!process.env.ABLY_API_KEY) return false;
  await publishRoom(roomChannel(room.code), "game:state", roomState(room));
  await Promise.all(room.players.map((player) => publishRoom(
    playerChannel(room.code, player.userId),
    "game:private",
    privateState(room, player.userId)
  )));
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
  scheduleBotTurn(room);
  return res.json({ ok: true, ...resultFor(room, userId) });
}

async function saveVoteAndReply(room, userId, payload, res) {
  let currentRoom = room;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await currentRoom.save();
      await broadcastRoom(currentRoom);
      scheduleBotTurn(currentRoom);
      return res.json({ ok: true, ...resultFor(currentRoom, userId) });
    } catch (error) {
      if (error.name !== "VersionError" || attempt === 7) {
        if (error.name === "VersionError") {
          return sendFailure(res, 409, "The room changed. Refresh and try again.");
        }
        throw error;
      }
      currentRoom = await SecretHitlerRoom.findById(room._id);
      if (!currentRoom) return sendFailure(res, 404, "The game room no longer exists");
      try {
        applyAction(currentRoom, userId, "vote", payload);
      } catch (actionError) {
        return sendFailure(res, 409, actionError.message);
      }
      await new Promise((resolve) => setTimeout(resolve, crypto.randomInt(5, 25)));
    }
  }
}

function createCode() {
  return Array.from({ length: ROOM_CODE_LENGTH }, () =>
    ROOM_ALPHABET[crypto.randomInt(ROOM_ALPHABET.length)]
  ).join("");
}

router.use(requireAuth);

router.get("/ably-token", async (req, res, next) => {
  try {
    if (!process.env.ABLY_API_KEY) {
      return sendFailure(res, 503, "Ably is not configured; this room is using polling updates.");
    }
    const code = typeof req.query.room === "string" ? req.query.room : "";
    const userId = req.user._id.toString();
    const room = await SecretHitlerRoom.findOne({ code, "players.userId": userId })
      .select("code players.userId");
    if (!room) return sendFailure(res, 403, "You are not a player in this room");

    const capability = {
      [roomChannel(room.code)]: ["subscribe"],
      [playerChannel(room.code, userId)]: ["subscribe"],
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
    const room = await SecretHitlerRoom.findOne({ "players.userId": userId });
    if (!room) return res.json({ ok: true, room: null, private: null });

    const presenceChanged = markStalePlayers(room);
    const phaseChanged = completeRoleReveal(room);
    if (presenceChanged || phaseChanged) return saveAndReply(room, userId, res);
    return res.json({ ok: true, ...resultFor(room, userId) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  const userId = req.user._id.toString();
  const username = req.user.username;
  const { eventName, payload = {} } = req.body || {};

  try {
    let room = await SecretHitlerRoom.findOne({ "players.userId": userId });

    if (eventName === "game:create") {
      if (room) return sendFailure(res, 409, "You are already in a game room");
      let code = createCode();
      while (await SecretHitlerRoom.exists({ code })) code = createCode();
      room = await SecretHitlerRoom.create({
        code,
        hostId: userId,
        players: [{ userId, username }],
        phase: "lobby",
        notice: "Waiting for players to join.",
      });
      await broadcastRoom(room);
      return res.json({ ok: true, ...resultFor(room, userId) });
    }

    if (eventName === "game:join") {
      if (room) return sendFailure(res, 409, "You are already in a game room");
      const code = typeof payload.code === "string" ? payload.code.trim().toUpperCase() : "";
      room = await SecretHitlerRoom.findOne({ code });
      if (!room) return sendFailure(res, 404, "Room not found");
      if (room.phase !== "lobby") return sendFailure(res, 409, "This game has already started");
      if (room.players.length >= MAX_PLAYERS) return sendFailure(res, 409, "This room is full");
      if (room.players.some((player) => player.userId === userId)) {
        return sendFailure(res, 409, "You are already in this room");
      }
      room.players.push({ userId, username, connected: true, alive: true });
      room.notice = `${username} joined the room.`;
      return saveAndReply(room, userId, res);
    }

    if (!room) return sendFailure(res, 404, "No active room was found for your account");
    if (eventName !== "game:heartbeat" && eventName !== "game:reconnect") {
      completeRoleReveal(room);
    }
    const player = findPlayer(room, userId);
    if (!player) return sendFailure(res, 403, "You are not a player in this room");

    if (eventName === "game:add-bot") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can add bots");
      if (room.phase !== "lobby" && room.phase !== "finished") return sendFailure(res, 409, "Bots can only be added between rounds");
      if (room.players.length >= MAX_PLAYERS) return sendFailure(res, 409, "This room is full");
      const bot = createBot(room.players);
      room.players.push({ ...bot, alive: true });
      room.notice = `${bot.username} joined the room.`;
      return saveAndReply(room, userId, res);
    }

    if (eventName === "game:fill-bots") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can add bots");
      if (room.phase !== "lobby") return sendFailure(res, 409, "Bots can only be added in the lobby");
      while (room.players.length < MIN_PLAYERS) room.players.push({ ...createBot(room.players), alive: true });
      room.notice = "The table was filled with bots for a practice game.";
      return saveAndReply(room, userId, res);
    }

    if (eventName === "game:chat") {
      const text = typeof payload.text === "string" ? payload.text.trim().replace(/\s+/g, " ") : "";
      if (!text || text.length > 300) return sendFailure(res, 400, "Messages must be between 1 and 300 characters");
      room.chatMessages.push({
        id: crypto.randomUUID(),
        senderId: userId,
        senderName: player.username,
        text,
        createdAt: Date.now(),
      });
      if (room.chatMessages.length > 100) room.chatMessages = room.chatMessages.slice(-100);
      return saveAndReply(room, userId, res);
    }

    if (eventName === "game:heartbeat" || eventName === "game:reconnect") {
      if (eventName === "game:reconnect" && player.alive === false) {
        return sendFailure(res, 403, "You are no longer active in this game");
      }
      player.connected = true;
      player.lastSeenAt = new Date();
      markStalePlayers(room);
      player.connected = true;
      if (eventName === "game:reconnect" && room.phase === "role-reveal") completeRoleReveal(room);
      return saveAndReply(room, userId, res);
    }

    player.connected = true;
    player.lastSeenAt = new Date();

    if (eventName === "game:start") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can start");
      if (room.phase !== "lobby" && room.phase !== "finished") {
        return sendFailure(res, 409, "The game is already in progress");
      }
      const connectedCount = room.players.filter((candidate) => candidate.connected).length;
      if (connectedCount < MIN_PLAYERS || connectedCount > MAX_PLAYERS || connectedCount !== room.players.length) {
        return sendFailure(res, 409, `The game needs ${MIN_PLAYERS}-${MAX_PLAYERS} connected players`);
      }
      initializeGame(room);
    } else if (eventName === "game:leave") {
      if (room.phase !== "lobby" && room.phase !== "finished") {
        return sendFailure(res, 409, "You cannot leave while a game is in progress");
      }
      room.players = room.players.filter((candidate) => candidate.userId !== userId);
      if (room.players.length === 0) {
        await SecretHitlerRoom.deleteOne({ _id: room._id, __v: room.__v });
        return res.json({ ok: true, room: null, private: null });
      }
      if (room.hostId === userId) room.hostId = room.players[0].userId;
      room.notice = `${username} left the room.`;
    } else if (eventName === "game:cancel") {
      if (room.hostId !== userId) return sendFailure(res, 403, "Only the host can cancel the game");
      const code = room.code;
      await SecretHitlerRoom.deleteOne({ _id: room._id, __v: room.__v });
      if (process.env.ABLY_API_KEY) {
        await publishRoom(roomChannel(code), "game:cancelled", { code, cancelledBy: userId });
      }
      return res.json({ ok: true, room: null, private: null });
    } else {
      const actions = {
        "game:nominate": "nominate",
        "game:vote": "vote",
        "game:president-discard": "president-discard",
        "game:chancellor-enact": "chancellor-enact",
        "game:veto-request": "veto-request",
        "game:veto-response": "veto-response",
        "game:investigate": "investigate",
        "game:special-election": "special-election",
        "game:policy-peek": "policy-peek",
        "game:execute": "execute",
      };
      const action = actions[eventName];
      if (!action) return sendFailure(res, 400, "Unknown game action");
      try {
        applyAction(room, userId, action, payload);
      } catch (error) {
        return sendFailure(res, 409, error.message);
      }
    }

    runBots(room);
    if (eventName === "game:vote") return saveVoteAndReply(room, userId, payload, res);
    return saveAndReply(room, userId, res);
  } catch (error) {
    next(error);
  }
});

module.exports = { router, playerChannel, roomChannel, resultFor, publicState: roomState, privateState };
