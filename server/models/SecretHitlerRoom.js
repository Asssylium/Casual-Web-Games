const mongoose = require("mongoose");

const playerSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true },
    username: { type: String, required: true },
    isBot: { type: Boolean, default: false },
    connected: { type: Boolean, default: true },
    lastSeenAt: { type: Date, default: Date.now },
    alive: { type: Boolean, default: true },
    role: { type: String, enum: ["liberal", "fascist", "hitler"], default: undefined },
    party: { type: String, enum: ["liberal", "fascist"], default: undefined },
  },
  { _id: false }
);

const roomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true },
    hostId: { type: String, required: true },
    players: { type: [playerSchema], default: [] },
    phase: {
      type: String,
      enum: [
        "lobby",
        "role-reveal",
        "election",
        "voting",
        "legislative-president",
        "legislative-chancellor",
        "veto-response",
        "executive",
        "finished",
      ],
      required: true,
    },
    phaseEndsAt: { type: Number, default: null },
    initialPlayerCount: { type: Number, default: null },
    round: { type: Number, default: 0 },
    nextPresidentId: { type: String, default: null },
    presidentId: { type: String, default: null },
    chancellorId: { type: String, default: null },
    lastElectedPresidentId: { type: String, default: null },
    lastElectedChancellorId: { type: String, default: null },
    specialElectionAnchorId: { type: String, default: null },
    electionTracker: { type: Number, default: 0 },
    liberalPolicies: { type: Number, default: 0 },
    fascistPolicies: { type: Number, default: 0 },
    drawPile: { type: [String], default: [] },
    discardPile: { type: [String], default: [] },
    presidentHand: { type: [String], default: [] },
    chancellorHand: { type: [String], default: [] },
    ballots: { type: mongoose.Schema.Types.Mixed, default: {} },
    ballotResults: { type: mongoose.Schema.Types.Mixed, default: null },
    investigatedPlayerIds: { type: [String], default: [] },
    privateIntel: { type: mongoose.Schema.Types.Mixed, default: {} },
    power: { type: String, default: null },
    winnerTeam: { type: String, enum: ["liberal", "fascist"], default: null },
    winnerReason: { type: String, default: null },
    lastEnactedPolicy: { type: String, enum: ["liberal", "fascist"], default: null },
    notice: { type: String, default: "" },
  },
  { timestamps: true, optimisticConcurrency: true }
);

roomSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 3600 });

module.exports = mongoose.models.SecretHitlerRoom || mongoose.model("SecretHitlerRoom", roomSchema);
