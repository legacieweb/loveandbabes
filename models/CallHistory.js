const mongoose = require('mongoose');
const CallHistorySchema = new mongoose.Schema({
  caller: String,
  receiver: String,
  type: String, // 'audio' | 'video'
  timestamp: Date
});
module.exports = mongoose.model('CallHistory', CallHistorySchema);
