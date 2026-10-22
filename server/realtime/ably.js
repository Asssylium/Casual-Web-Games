const Ably = require("ably");

let realtime;

function getRealtime() {
  if (!process.env.ABLY_API_KEY) throw new Error("ABLY_API_KEY is required for multiplayer");
  if (!realtime) realtime = new Ably.Rest({ key: process.env.ABLY_API_KEY });
  return realtime;
}

async function publishRoom(channelName, eventName, data) {
  await getRealtime().channels.get(channelName).publish(eventName, data);
}

module.exports = { getRealtime, publishRoom };