const mongoose = require("mongoose");
let connectionPromise;

async function connectDatabase(uri = process.env.MONGO_URI) {
  if (!uri) {
    throw new Error("MONGO_URI is required");
  }

  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connectionPromise) {
    connectionPromise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000,
    });
  }

  try {
    await connectionPromise;
    console.log("Connected to MongoDB");
    return mongoose.connection;
  } finally {
    connectionPromise = null;
  }
}

module.exports = connectDatabase;
