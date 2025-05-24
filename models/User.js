const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  profileName: String,
  fullName: String,
  email: { type: String, unique: true },
    password: { type: String, required: true }, // ✅ Add this
  gender: String,
  interestedIn: String,
  relationshipType: String,
  orientation: String,
  sexualPreference: String,
  smoke: String,
  drink: String,
  loveLanguage: String,
  country: String,
  state: String,
  userId: { type: String, unique: true, sparse: true },

  district: String,
  image: String,
  bio: String,

  birthDate: Date,          // 🆕 Full date of birth
  year: Number,             // 🆕 Extracted year for age calculation

  verified: { type: Boolean, default: false },

  accountType: { type: String, enum: ['free', 'premium'], default: 'free' },

  gallery: {
    type: [String], // List of image URLs or base64 strings
    default: []
  },

  likes: {
    type: [String], // Emails or user IDs this user liked
    default: []
  },

  likedBy: {
    type: [String], // Emails or user IDs who liked this user
    default: []
  },

  matches: {
    type: [String], // List of mutual matches
    default: []
  }
});

module.exports = mongoose.model("User", userSchema);
