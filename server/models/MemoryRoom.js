const mongoose = require("mongoose");

const cardSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    icon: { type: String, required: true },
    direction: { type: String, enum: ["left", "right", "both"], required: true },
  },
  { _id: false }
);

const playerSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
    connected: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
    eliminated: { type: Boolean, default: false },
    hand: { type: [cardSchema], default: [] },
    penaltyCards: { type: [cardSchema], default: [] },
    blockedCardId: { type: String, default: null },
  },
  { _id: false }
);

const gameLogEntrySchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    type: { type: String, default: "event" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const memoryRoomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    hostId: { type: String, required: true },
    players: { type: [playerSchema], default: [] },
    phase: { type: String, enum: ["lobby", "reveal", "gift-reveal", "playing", "finished"], required: true },
    round: { type: Number, default: 1 },
    drawPile: { type: [cardSchema], default: [] },
    drawnCard: { type: cardSchema, default: undefined },
    drawnBy: { type: String, default: null },
    startingPlayerId: { type: String, default: null },
    currentTurnId: { type: String, default: null },
    pending: {
      card: { type: cardSchema, default: undefined },
      fromId: { type: String, default: null },
      toId: { type: String, default: null },
      claimedName: { type: String, default: null },
      direction: { type: String, default: null },
    },
    revealCards: { type: [mongoose.Schema.Types.Mixed], default: null },
    revealEndsAt: { type: Number, default: null },
    lastReveal: { type: mongoose.Schema.Types.Mixed, default: null },
    notice: { type: String, default: "" },
    gameLog: { type: [gameLogEntrySchema], default: [] },
    winnerId: { type: String, default: null },
    winnerIds: { type: [String], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true }
);

memoryRoomSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 120 });

module.exports = mongoose.models.MemoryRoom || mongoose.model("MemoryRoom", memoryRoomSchema);