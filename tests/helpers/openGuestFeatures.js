'use strict';
// Test-only. The owner's guest switches are locked by default, and in memory mode every test player is a guest (there is no
// database to register them). These tests cover table mechanics that registered players use (rejoin, private tables, seats),
// so they open the switches after the server starts, the way the owner would. Guest-specific behaviour is tested in
// tests/guest-play.test.js, which keeps the switches locked.
const guestFeatures = require('../../lib/guestFeatures');

module.exports = function openGuestFeatures(keys = guestFeatures.FEATURES.map((f) => f.key)) {
  for (const key of keys) guestFeatures.setOne(key, true);
};
