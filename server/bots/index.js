const crypto = require("crypto");

const BOT_NAMES = ["Ada", "Beau", "Cleo", "Dex", "Ember", "Finn", "Gigi", "Hugo"];

function createBot(existingPlayers) {
  const usedNames = new Set(existingPlayers.map((player) => player.username));
  const name = BOT_NAMES.find((candidate) => !usedNames.has(`${candidate} Bot`)) || `Bot ${existingPlayers.length + 1}`;
  return {
    userId: `bot:${crypto.randomUUID()}`,
    username: `${name} Bot`,
    isBot: true,
    connected: true,
    lastSeenAt: new Date(),
  };
}

function isBot(player) {
  return Boolean(player?.isBot || player?.userId?.startsWith("bot:"));
}

function choose(items, mistakeRate = 0.2) {
  if (!items.length) return null;
  // Bots usually prefer the first sensible choice, but regularly make a fallible random choice.
  return items[Math.random() < mistakeRate ? crypto.randomInt(items.length) : 0];
}

function coin(yesChance = 0.55) {
  return Math.random() < yesChance;
}

module.exports = { createBot, isBot, choose, coin };
