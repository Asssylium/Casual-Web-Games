const mongoose = require("mongoose");

async function connectDatabase(uri = process.env.MONGO_URI) {
  if (!uri) {
    throw new Error("MONGO_URI is required");
  }

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
  });

  console.log("Connected to MongoDB");
  return mongoose.connection;
}

module.exports = connectDatabase;
