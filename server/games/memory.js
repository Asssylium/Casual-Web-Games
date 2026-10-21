const crypto = require("crypto");

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const MEMORY_REVEAL_MS = 12_000;
const ROOM_CODE_LENGTH = 5;
const CARD_CATALOG = [
  { name: "Cat", icon: "🐈", direction: "left" },
  { name: "Chair", icon: "🪑", direction: "right" },
  { name: "Basket", icon: "🧺", direction: "both" },
  { name: "Apple", icon: "🍎", direction: "left" },
  { name: "Key", icon: "🔑", direction: "right" },
  { name: "Lamp", icon: "💡", direction: "both" },
  { name: "Shoe", icon: "👟", direction: "left" },
  { name: "Clock", icon: "🕰️", direction: "right" },
  { name: "Book", icon: "📕", direction: "both" },
  { name: "Fish", icon: "🐟", direction: "left" },
  { name: "Mug", icon: "☕", direction: "right" },
  { name: "Camera", icon: "📷", direction: "both" },
  { name: "Bicycle", icon: "🚲", direction: "left" },
  { name: "Umbrella", icon: "☂️", direction: "right" },
  { name: "Guitar", icon: "🎸", direction: "both" },
  { name: "Plant", icon: "🪴", direction: "left" },
  { name: "Glasses", icon: "👓", direction: "right" },
  { name: "Radio", icon: "📻", direction: "both" },
  { name: "Balloon", icon: "🎈", direction: "left" },
  { name: "Toaster", icon: "🍞", direction: "right" },
];

const rooms = new Map();

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function resolveClaim(card, claimedName) {
  return card.name.toLocaleLowerCase() === claimedName.trim().toLocaleLowerCase()
    ? "truth"
    : "lie";
}

function canPassCard(player, cardId) {
  return player.blockedCardId !== cardId && player.hand.some((card) => card.id === cardId);
}

function channel(code) {
  return `memory:${code}`;
}

function publicPlayer(player) {
  return {
    id: player.id,
    username: player.username,
    eliminated: player.eliminated,
    connected: player.connected,
    cardCount: player.hand.length,
  };
}

function publicState(room) {
  const pending = room.pending
    ? {
        fromId: room.pending.fromId,
        fromName: room.players.find((player) => player.id === room.pending.fromId)?.username,
        toId: room.pending.toId,
        toName: room.players.find((player) => player.id === room.pending.toId)?.username,
        claimedName: room.pending.claimedName,
        direction: room.pending.direction,
      }
    : null;

  return {
    code: room.code,
    phase: room.phase,
    hostId: room.hostId,
    round: room.round,
    players: room.players.map(publicPlayer),
    currentTurnId: room.currentTurnId,
    pending,
    revealEndsAt: room.revealEndsAt,
    revealCards: room.phase === "reveal" ? room.revealCards : null,
    lastReveal: room.lastReveal,
    notice: room.notice,
    winnerId: room.winnerId,
  };
}

function emitRoom(io, room) {
  io.to(channel(room.code)).emit("game:state", publicState(room));
  for (const player of room.players) {
    if (!player.socketId) continue;
    io.to(player.socketId).emit("game:hand", {
      cards: player.eliminated
        ? []
        : player.hand.map(({ id, name, icon, direction }) => ({ id, name, icon, direction })),
      blockedCardId: player.blockedCardId,
    });
  }
}

function findRoomForUser(userId) {
  return [...rooms.values()].find((room) =>
    room.players.some((player) => player.id === userId)
  );
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: ROOM_CODE_LENGTH }, () =>
      alphabet[crypto.randomInt(alphabet.length)]
    ).join("");
  } while (rooms.has(code));
  return code;
}

function shuffleCards(count) {
  return shuffle(CARD_CATALOG).slice(0, count).map((card) => ({
    ...card,
    id: crypto.randomUUID(),
  }));
}

function activePlayers(room) {
  return room.players.filter((player) => !player.eliminated);
}

function connectedPlayers(room) {
  return room.players.filter((player) => !player.eliminated && player.connected);
}

function playerById(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function advanceTo(room, playerId) {
  if (activePlayers(room).length <= 1) {
    room.phase = "finished";
    room.winnerId = activePlayers(room)[0]?.id || null;
    room.currentTurnId = room.winnerId;
    return;
  }

  const player = playerById(room, playerId);
  if (player && !player.eliminated && player.connected && player.hand.length > 0) {
    room.currentTurnId = player.id;
    return;
  }

  const start = Math.max(0, room.players.findIndex((item) => item.id === playerId));
  for (let offset = 1; offset <= room.players.length; offset += 1) {
    const candidate = room.players[(start + offset) % room.players.length];
    if (!candidate.eliminated && candidate.connected && candidate.hand.length > 0) {
      room.currentTurnId = candidate.id;
      return;
    }
  }

  room.currentTurnId = null;
  room.notice = "Waiting for a connected player to resume.";
}

function findTarget(room, giver, direction) {
  const start = room.players.findIndex((player) => player.id === giver.id);
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

function attachMemoryGame(io) {
  function fail(socket, ack, error) {
    const result = { ok: false, error };
    if (typeof ack === "function") ack(result);
    else socket.emit("game:error", result);
  }

  function success(ack, data = {}) {
    if (typeof ack === "function") ack({ ok: true, ...data });
  }

  function findSocketRoom(socket) {
    const userId = socket.data.user.id;
    return findRoomForUser(userId);
  }

  function getRoomPlayer(socket, room) {
    const player = playerById(room, socket.data.user.id);
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
    }
    return player;
  }

  function beginMemoryPhase(room, io) {
    if (room.timer) clearTimeout(room.timer);
    const dealt = shuffleCards(room.players.length);
    room.players.forEach((player, index) => {
      player.eliminated = false;
      player.hand = [dealt[index]];
      player.blockedCardId = null;
    });
    room.phase = "reveal";
    room.pending = null;
    room.lastReveal = null;
    room.winnerId = null;
    room.currentTurnId = null;
    room.notice = "Memorize everyone's card and its direction.";
    room.revealEndsAt = Date.now() + MEMORY_REVEAL_MS;
    room.revealCards = room.players.map((player) => ({
      playerId: player.id,
      username: player.username,
      ...player.hand[0],
    }));
    emitRoom(io, room);

    room.timer = setTimeout(() => {
      if (room.phase !== "reveal") return;
      room.phase = "playing";
      room.revealCards = null;
      room.revealEndsAt = null;
      const eligible = connectedPlayers(room).filter((player) => player.hand.length > 0);
      room.currentTurnId = eligible.length
        ? eligible[crypto.randomInt(eligible.length)].id
        : null;
      room.notice = eligible.length
        ? "The first player is chosen at random."
        : "Waiting for a player to reconnect.";
      emitRoom(io, room);
    }, MEMORY_REVEAL_MS);
    room.timer.unref?.();
  }

  io.on("connection", (socket) => {
    socket.emit("game:catalog", {
      objects: CARD_CATALOG.map(({ name, icon, direction }) => ({ name, icon, direction })),
    });

    socket.on("game:create", (_payload, ack) => {
      const user = socket.data.user;
      if (findSocketRoom(socket)) return fail(socket, ack, "You are already in a game room");

      const code = generateRoomCode();
      const player = {
        id: user.id,
        username: user.username,
        socketId: socket.id,
        connected: true,
        eliminated: false,
        hand: [],
        blockedCardId: null,
      };
      const room = {
        code,
        hostId: user.id,
        players: [player],
        phase: "lobby",
        round: 1,
        currentTurnId: null,
        pending: null,
        revealCards: null,
        revealEndsAt: null,
        lastReveal: null,
        notice: "Waiting for players to join.",
        winnerId: null,
        timer: null,
      };
      rooms.set(code, room);
      socket.join(channel(code));
      emitRoom(io, room);
      success(ack, { code });
    });

    socket.on("game:join", ({ code } = {}, ack) => {
      const user = socket.data.user;
      if (findSocketRoom(socket)) return fail(socket, ack, "You are already in a game room");
      const normalizedCode = typeof code === "string" ? code.trim().toUpperCase() : "";
      const room = rooms.get(normalizedCode);
      if (!room) return fail(socket, ack, "Room not found");
      if (room.phase !== "lobby") return fail(socket, ack, "This game has already started");
      if (room.players.length >= MAX_PLAYERS) return fail(socket, ack, "This room is full");
      if (room.players.some((player) => player.id === user.id)) {
        return fail(socket, ack, "You are already in this room");
      }

      room.players.push({
        id: user.id,
        username: user.username,
        socketId: socket.id,
        connected: true,
        eliminated: false,
        hand: [],
        blockedCardId: null,
      });
      socket.join(channel(room.code));
      room.notice = `${user.username} joined the room.`;
      emitRoom(io, room);
      success(ack, { code: room.code });
    });

    socket.on("game:start", (_payload, ack) => {
      const room = findSocketRoom(socket);
      if (!room) return fail(socket, ack, "Join a room first");
      if (room.hostId !== socket.data.user.id) return fail(socket, ack, "Only the host can start");
      if (room.phase !== "lobby" && room.phase !== "finished") {
        return fail(socket, ack, "The game is already in progress");
      }
      if (connectedPlayers(room).length < MIN_PLAYERS) {
        return fail(socket, ack, `At least ${MIN_PLAYERS} players are needed`);
      }

      room.round += room.phase === "finished" ? 1 : 0;
      beginMemoryPhase(room, io);
      success(ack);
    });

    socket.on("game:pass", ({ cardId, direction, claimedName } = {}, ack) => {
      const room = findSocketRoom(socket);
      if (!room || room.phase !== "playing") return fail(socket, ack, "The game is not accepting a pass");
      const giver = getRoomPlayer(socket, room);
      if (room.currentTurnId !== giver.id) return fail(socket, ack, "It is not your turn");
      if (room.pending) return fail(socket, ack, "A card is already being considered");

      const cardIndex = giver.hand.findIndex((card) => card.id === cardId);
      if (cardIndex < 0) return fail(socket, ack, "That card is not in your hand");
      if (!canPassCard(giver, cardId)) {
        return fail(socket, ack, "You must keep the card you just received for this turn");
      }
      const card = giver.hand[cardIndex];
      if (card.direction !== "both" && card.direction !== direction) {
        return fail(socket, ack, "That card can only pass in its indicated direction");
      }
      if (!CARD_CATALOG.some((item) => item.name === claimedName)) {
        return fail(socket, ack, "Choose a valid object name to claim");
      }

      const receiver = findTarget(room, giver, direction);
      if (!receiver) return fail(socket, ack, "There is no player in that direction");

      giver.hand.splice(cardIndex, 1);
      room.pending = {
        card,
        fromId: giver.id,
        toId: receiver.id,
        claimedName,
        direction,
      };
      room.lastReveal = null;
      room.notice = `${giver.username} passed a card to ${receiver.username}.`;
      emitRoom(io, room);
      success(ack);
    });

    socket.on("game:accept", (_payload, ack) => {
      const room = findSocketRoom(socket);
      if (!room || room.phase !== "playing" || !room.pending) {
        return fail(socket, ack, "There is no card to accept");
      }
      const receiver = getRoomPlayer(socket, room);
      if (room.pending.toId !== receiver.id) {
        return fail(socket, ack, "Only the receiver can accept this card");
      }

      const pending = room.pending;
      receiver.hand.push(pending.card);
      receiver.blockedCardId = pending.card.id;
      room.lastReveal = null;
      room.pending = null;
      room.notice = `${receiver.username} accepted the card.`;
      advanceTo(room, receiver.id);
      emitRoom(io, room);
      success(ack);
    });

    socket.on("game:challenge", (_payload, ack) => {
      const room = findSocketRoom(socket);
      if (!room || room.phase !== "playing" || !room.pending) {
        return fail(socket, ack, "There is no claim to challenge");
      }
      const receiver = getRoomPlayer(socket, room);
      if (room.pending.toId !== receiver.id) {
        return fail(socket, ack, "Only the receiver can challenge this claim");
      }

      const pending = room.pending;
      const giver = playerById(room, pending.fromId);
      const result = resolveClaim(pending.card, pending.claimedName);
      room.lastReveal = {
        fromName: giver?.username || "A player",
        toName: receiver.username,
        claimedName: pending.claimedName,
        card: {
          name: pending.card.name,
          icon: pending.card.icon,
          direction: pending.card.direction,
        },
        outcome: result,
      };
      room.pending = null;

      if (result === "lie") {
        room.notice = `${receiver.username} caught the lie. ${giver?.username || "The giver"} is out.`;
        receiver.hand.push(pending.card);
        receiver.blockedCardId = pending.card.id;
        finishTurnAfterElimination(room, pending.fromId, receiver.id);
      } else {
        room.notice = `${receiver.username} challenged a truthful claim and is out.`;
        if (giver) giver.hand.push(pending.card);
        finishTurnAfterElimination(room, receiver.id, giver?.id);
      }

      emitRoom(io, room);
      success(ack);
    });

    socket.on("game:reconnect", (_payload, ack) => {
      const room = findSocketRoom(socket);
      if (!room) return fail(socket, ack, "No active room was found for your account");
      const player = getRoomPlayer(socket, room);
      if (!player || player.eliminated) return fail(socket, ack, "You are no longer in this game");

      socket.join(channel(room.code));
      if (room.phase === "playing" && !room.currentTurnId) room.currentTurnId = player.id;
      room.notice = `${player.username} reconnected.`;
      emitRoom(io, room);
      success(ack, { code: room.code });
    });

    socket.on("game:leave", (_payload, ack) => {
      const room = findSocketRoom(socket);
      if (!room) return fail(socket, ack, "You are not in an active room");
      if (room.phase !== "lobby" && room.phase !== "finished") {
        return fail(socket, ack, "You cannot leave while a round is in progress");
      }

      room.players = room.players.filter((player) => player.id !== socket.data.user.id);
      socket.leave(channel(room.code));
      if (room.players.length === 0) {
        if (room.timer) clearTimeout(room.timer);
        rooms.delete(room.code);
        return success(ack);
      }
      if (room.hostId === socket.data.user.id) {
        room.hostId = room.players.find((player) => player.connected)?.id || room.players[0].id;
      }
      room.notice = `${socket.data.user.username} left the room.`;
      emitRoom(io, room);
      success(ack);
    });

    socket.on("disconnect", () => {
      const room = findSocketRoom(socket);
      if (!room) return;
      const player = playerById(room, socket.data.user.id);
      if (!player || player.socketId !== socket.id) return;
      player.connected = false;
      if (room.phase === "lobby" && room.hostId === player.id) {
        const nextHost = room.players.find((item) => item.connected && !item.eliminated);
        if (nextHost) room.hostId = nextHost.id;
      }
      room.notice = `${player.username} disconnected. Their turn will wait for reconnection.`;
      emitRoom(io, room);
    });
  });
}

module.exports = attachMemoryGame;
module.exports.resolveClaim = resolveClaim;
module.exports.canPassCard = canPassCard;