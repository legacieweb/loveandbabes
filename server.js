require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const cors = require("cors");
const bodyParser = require("body-parser");
const User = require("./models/User");
const crypto = require("crypto");
const http = require("http");
const { Server } = require("socket.io");
const Message = require("./models/Message"); // ⬅️ Import Message model
const CallHistory = require("./models/CallHistory");


const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "5mb" }));

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!MONGO_URI || !EMAIL_USER || !EMAIL_PASS) {
  console.error("❌ Missing required environment variables in .env");
  process.exit(1);
}

mongoose.connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  });

// In-memory code stores
let verificationCodes = new Map();
let idVerificationCodes = new Map();

// Mail transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// 🔐 Signup: Send verification code
app.post("/send-verification", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email is required" });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  verificationCodes.set(email, code);

  try {
    await transporter.sendMail({
      from: `LoveConnect <${EMAIL_USER}>`,
      to: email,
      subject: "Your Verification Code",
      text: `Your LoveConnect verification code is: ${code}`
    });

    res.json({ success: true });
  } catch (error) {
    console.error("❌ Email failed:", error);
    res.status(500).json({ success: false, message: "Failed to send email" });
  }
});

// 🔐 Signup: Verify code and create user
app.post("/verify-code", async (req, res) => {
  const { code, userData } = req.body;
  if (!userData?.email || code !== verificationCodes.get(userData.email)) {
    return res.status(401).json({ success: false, message: "Invalid code" });
  }

  try {
    if (await User.findOne({ email: userData.email })) {
      return res.status(409).json({ success: false, message: "User already exists" });
    }

    const newUser = new User({ ...userData, verified: true });
    await newUser.save();

    verificationCodes.delete(userData.email);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ success: false });
  }
});

// 🧑 Get all users with filters
app.get("/users", async (req, res) => {
  try {
    const {
      location, minAge, maxAge, gender, exclude,
      relationshipType, orientation, sexualPreference,
      smoke, drink, loveLanguage
    } = req.query;

    const query = {};

    if (location) {
      const regex = new RegExp(location, "i");
      query.$or = [
        { district: regex },
        { state: regex },
        { country: regex }
      ];
    }

    if (gender) query.gender = gender;

    if (minAge || maxAge) {
      const currentYear = new Date().getFullYear();
      query.year = {};
      if (minAge) query.year.$lte = currentYear - parseInt(minAge);
      if (maxAge) query.year.$gte = currentYear - parseInt(maxAge);
    }

    if (exclude) query.email = { $ne: exclude };

    if (relationshipType) query.relationshipType = relationshipType;
    if (orientation) query.orientation = orientation;
    if (sexualPreference) query.sexualPreference = sexualPreference;
    if (smoke) query.smoke = smoke;
    if (drink) query.drink = drink;
    if (loveLanguage) query.loveLanguage = loveLanguage;

    const users = await User.find(query).select("-password -verificationCode");
    res.json(users);
  } catch (err) {
    console.error("❌ User filter error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✏️ Profile update
app.post("/user/update", async (req, res) => {
  try {
    const { email, ...updates } = req.body;
    if (!email) return res.status(400).json({ success: false });

    const user = await User.findOneAndUpdate({ email }, updates, { new: true });
    if (!user) return res.status(404).json({ success: false });

    res.json({ success: true, message: "Profile updated." });
  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ success: false });
  }
});

// 💖 Like another user
app.post("/user/like", async (req, res) => {
  const { liker, liked } = req.body;
  if (!liker || !liked) return res.status(400).json({ message: "Missing emails" });

  try {
    const user1 = await User.findOne({ email: liker });
    const user2 = await User.findOne({ email: liked });
    if (!user1 || !user2) return res.status(404).json({ message: "User not found" });

    let match = false;

    // Prevent duplicate likes
    if (!user1.likes.includes(liked)) user1.likes.push(liked);
    if (!user2.likedBy.includes(liker)) user2.likedBy.push(liker);

    // Check for mutual match
    if (user2.likes.includes(liker)) {
      if (!user1.matches.includes(liked)) user1.matches.push(liked);
      if (!user2.matches.includes(liker)) user2.matches.push(liker);
      match = true;
    }

    await user1.save();
    await user2.save();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });

    // Notify liked user even if not matched
    if (!match) {
      await transporter.sendMail({
        from: `LoveConnect <${EMAIL_USER}>`,
        to: liked,
        subject: "💘 Someone liked your profile!",
        text: `${user1.profileName || 'Someone'} just liked your profile on LoveConnect. Visit the app to see who!`
      });
    }

    // If match, notify both
    if (match) {
      const usersToNotify = [liker, liked];
      for (const email of usersToNotify) {
        await transporter.sendMail({
          from: `LoveConnect <${EMAIL_USER}>`,
          to: email,
          subject: "🎉 It's a Match!",
          text: `You and ${email === liker ? user2.profileName : user1.profileName} liked each other on LoveConnect! Start chatting now!`
        });
      }
    }

    res.json({ success: true, match });
  } catch (err) {
    console.error("❌ Like error:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// 👫 Get matches
app.get("/user/matches/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user.matches || []);
  } catch (err) {
    console.error("❌ Matches error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 📸 Upload images
app.post("/user/gallery/upload", async (req, res) => {
  const { email, images } = req.body;
  if (!email || !Array.isArray(images)) {
    return res.status(400).json({ message: "Invalid request" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    user.gallery.push(...images);
    await user.save();
    res.json({ message: "Gallery updated", gallery: user.gallery });
  } catch (err) {
    console.error("❌ Gallery upload error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 📂 Get gallery by email
app.get("/user/gallery/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user.gallery || []);
  } catch (err) {
    console.error("❌ Gallery fetch error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// 📧 Send ID code
app.post("/send-id-code", async (req, res) => {
  const { email } = req.body;
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  idVerificationCodes.set(email, code);

  try {
    await transporter.sendMail({
      from: `LoveConnect <${EMAIL_USER}>`,
      to: email,
      subject: "🎫 Your User ID Code",
      text: `Use this code to claim your LoveConnect ID: ${code}`
    });

    res.json({ success: true });
  } catch (err) {
    console.error("❌ ID code email error:", err);
    res.status(500).json({ success: false });
  }
});

// 🔐 Verify ID code & assign userId
app.post("/verify-id-code", async (req, res) => {
  const { email, code } = req.body;
  if (code !== idVerificationCodes.get(email)) {
    return res.status(401).json({ success: false, message: "Invalid code" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false });

    if (user.userId) {
      return res.status(409).json({ success: false, message: "ID already assigned" });
    }

    let userId;
    do {
      userId = crypto.randomBytes(4).toString("hex");
    } while (await User.findOne({ userId }));

    user.userId = userId;
    await user.save();
    idVerificationCodes.delete(email);

    res.json({ success: true, userId });
  } catch (err) {
    console.error("❌ ID generation error:", err);
    res.status(500).json({ success: false });
  }
});

// 👤 Get user by ID
app.get("/user/by-id/:userId", async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// 🖼️ Get gallery by userId
app.get("/user/gallery/by-id/:userId", async (req, res) => {
  try {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user.gallery || []);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// 📧 Fallback - fetch user by email
app.get("/user/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // Replace with your frontend domain in production
    methods: ["GET", "POST"]
  }
});

const onlineUsers = {}; // Track online users by email

io.on("connection", (socket) => {
  // ✅ Register user to socket
  socket.on("register", (email) => {
    const normalizedEmail = email.toLowerCase();
    onlineUsers[normalizedEmail] = socket.id;
    console.log(`Registered ${normalizedEmail} with socket ID: ${socket.id}`);
  });

  // 💬 Private messaging
  socket.on("private_message", async ({ to, from, message }) => {
    const recipientSocket = onlineUsers[to.toLowerCase()];
    try {
      await Message.create({ from, to, message });
      if (recipientSocket) {
        io.to(recipientSocket).emit("private_message", { from, message });
      }
    } catch (err) {
      console.error("❌ DB save failed:", err);
    }
  });

  // 🎥 Call Offer
// 🎥 Call Offer
socket.on("call-offer", async ({ to, offer, from, type }) => {
  const recipientSocket = onlineUsers[to.toLowerCase()];
  const caller = await User.findOne({ email: from });

  if (recipientSocket && caller) {
    io.to(recipientSocket).emit("call-offer", {
      from,
      offer,
      type,
      callerName: caller.profileName || caller.fullName || "Unknown",
      callerImage: caller.image || "https://placehold.co/80"
    });
  }
});


  // ✅ Call Answer
  socket.on("call-answer", ({ to, answer }) => {
    const recipientSocket = onlineUsers[to.toLowerCase()];
    if (recipientSocket) {
      io.to(recipientSocket).emit("call-answer", { answer });
      console.log(`📞 Call answered by ${to}`);
    }
  });

  // ❄️ ICE Candidate
  socket.on("ice-candidate", ({ to, candidate }) => {
    const recipientSocket = onlineUsers[to.toLowerCase()];
    if (recipientSocket) {
      io.to(recipientSocket).emit("ice-candidate", { candidate });
    }
  });

  // ❌ Call Rejected
  socket.on("call-rejected", ({ to }) => {
    const recipientSocket = onlineUsers[to.toLowerCase()];
    if (recipientSocket) {
      io.to(recipientSocket).emit("call-rejected");
    }
  });


  // 🔴 Handle call-ended
socket.on("call-ended", ({ to }) => {
  if (!to || typeof to !== "string") {
    console.warn("❌ call-ended event missing 'to' or it's invalid");
    return;
  }

  const recipientSocket = onlineUsers[to.toLowerCase()];
  if (recipientSocket) {
    io.to(recipientSocket).emit("call-ended");
    console.log(`🔴 Call ended by ${to}`);
  } else {
    console.warn(`⚠️ No recipient socket found for ${to}`);
  }
});


// ❌ Handle call-cancelled (caller cancels before answer)
socket.on("call-cancelled", ({ to }) => {
  const recipientSocket = onlineUsers[to.toLowerCase()];
  if (recipientSocket) {
    io.to(recipientSocket).emit("call-cancelled");
    console.log(`❌ Call cancelled to ${to}`);
  }
});

  // 🚪 Clean up on disconnect
  socket.on("disconnect", () => {
    for (const email in onlineUsers) {
      if (onlineUsers[email] === socket.id) {
        console.log(`👋 ${email} disconnected`);
        delete onlineUsers[email];
        break;
      }
    }
  });
});


// 🔐 Login User
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // 👇 Plain-text password match
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

let resetCodes = new Map();

app.post("/send-reset-code", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false });

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ success: false, message: "Email not found." });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  resetCodes.set(email, code);

  try {
    await transporter.sendMail({
      from: `LoveConnect <${EMAIL_USER}>`,
      to: email,
      subject: "Reset Your Password",
      text: `Your password reset code is: ${code}`
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Reset email error:", err);
    res.status(500).json({ success: false });
  }
});

app.post("/verify-reset-code", async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (resetCodes.get(email) !== code) {
    return res.status(401).json({ success: false, message: "Invalid code." });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false });

    user.password = newPassword;
    await user.save();

    resetCodes.delete(email);
    res.json({ success: true });
  } catch (err) {
    console.error("Password reset failed:", err);
    res.status(500).json({ success: false });
  }
});


// Example Express route (server.js or routes/message.js)
app.get("/messages/:user1/:user2", async (req, res) => {
  const { user1, user2 } = req.params;
  try {
    const messages = await Message.find({
      $or: [
        { from: user1, to: user2 },
        { from: user2, to: user1 }
      ]
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (err) {
    console.error("❌ Error fetching messages:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});


// 🚀 Start server
server.listen(PORT, () => {
  console.log(`🚀 Server with Socket.IO running at http://localhost:${PORT}`);
});

