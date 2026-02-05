/**
 * DM Pairing Manager
 *
 * Manages pairing codes for DM access control.
 * Users must be approved before they can message the bot.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class PairingManager {
  constructor(stateDir) {
    this.stateDir = stateDir || path.join(process.env.HOME || '/root', '.openclaw');
    this.pairingFile = path.join(this.stateDir, 'pumble-pairing.json');
    this.approvedFile = path.join(this.stateDir, 'pumble-approved.json');

    // In-memory caches
    this.pendingPairings = new Map(); // userId -> { code, expiresAt, userName }
    this.approvedUsers = new Set();

    this.maxPendingPairings = 3;
    this.pairingExpiryMs = 3600000; // 1 hour

    // Load state from disk
    this.load();

    // Auto-cleanup expired pairings every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Load state from disk
   */
  load() {
    try {
      if (fs.existsSync(this.pairingFile)) {
        const data = JSON.parse(fs.readFileSync(this.pairingFile, 'utf8'));
        this.pendingPairings = new Map(Object.entries(data));
      }
    } catch (err) {
      console.error('[pumble-pairing] Failed to load pending pairings:', err.message);
    }

    try {
      if (fs.existsSync(this.approvedFile)) {
        const data = JSON.parse(fs.readFileSync(this.approvedFile, 'utf8'));
        this.approvedUsers = new Set(data);
      }
    } catch (err) {
      console.error('[pumble-pairing] Failed to load approved users:', err.message);
    }
  }

  /**
   * Save state to disk
   */
  save() {
    try {
      // Ensure directory exists
      if (!fs.existsSync(this.stateDir)) {
        fs.mkdirSync(this.stateDir, { recursive: true, mode: 0o700 });
      }

      // Save pending pairings
      const pairingData = Object.fromEntries(this.pendingPairings);
      fs.writeFileSync(this.pairingFile, JSON.stringify(pairingData, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });

      // Save approved users
      const approvedData = Array.from(this.approvedUsers);
      fs.writeFileSync(this.approvedFile, JSON.stringify(approvedData, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
    } catch (err) {
      console.error('[pumble-pairing] Failed to save state:', err.message);
    }
  }

  /**
   * Request pairing for a user
   * @param {string} userId - User ID requesting pairing
   * @param {string} userName - User name
   * @returns {Object} {code, expiresAt} or {error}
   */
  requestPairing(userId, userName) {
    // Check if user is already approved
    if (this.isUserApproved(userId)) {
      return { error: 'User is already approved', alreadyApproved: true };
    }

    // Check if user already has a pending pairing
    if (this.pendingPairings.has(userId)) {
      const existing = this.pendingPairings.get(userId);
      if (Date.now() < existing.expiresAt) {
        return {
          code: existing.code,
          expiresAt: existing.expiresAt,
          message: `Pairing code already exists. Use: openclaw pairing approve pumble ${existing.code}`
        };
      } else {
        // Expired, remove it
        this.pendingPairings.delete(userId);
      }
    }

    // Check max pending pairings limit
    if (this.pendingPairings.size >= this.maxPendingPairings) {
      return { error: 'Maximum pending pairings reached (limit: 3)' };
    }

    // Generate 8-character alphanumeric code
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = Date.now() + this.pairingExpiryMs;

    this.pendingPairings.set(userId, { code, expiresAt, userName });
    this.save();

    return {
      code,
      expiresAt,
      message: `Pairing request from ${userName} (${userId}). Admin should run: openclaw pairing approve pumble ${code}`
    };
  }

  /**
   * Approve a pairing code
   * @param {string} code - Pairing code
   * @returns {Object} {success, userId, userName} or {error}
   */
  approvePairing(code) {
    const normalizedCode = code.toUpperCase().trim();

    for (const [userId, data] of this.pendingPairings) {
      if (data.code === normalizedCode) {
        // Check if expired
        if (Date.now() >= data.expiresAt) {
          this.pendingPairings.delete(userId);
          this.save();
          return { error: 'Pairing code has expired' };
        }

        // Approve user
        this.approvedUsers.add(userId);
        this.pendingPairings.delete(userId);
        this.save();

        return {
          success: true,
          userId,
          userName: data.userName,
          message: `User ${data.userName} (${userId}) has been approved`
        };
      }
    }

    return { error: 'Invalid pairing code' };
  }

  /**
   * Check if user is approved
   * @param {string} userId - User ID
   * @returns {boolean}
   */
  isUserApproved(userId) {
    return this.approvedUsers.has(userId);
  }

  /**
   * Get list of pending pairings
   * @returns {Array}
   */
  getPendingPairings() {
    const pending = [];
    for (const [userId, data] of this.pendingPairings) {
      pending.push({
        userId,
        userName: data.userName,
        code: data.code,
        expiresAt: data.expiresAt,
        expiresIn: Math.max(0, data.expiresAt - Date.now())
      });
    }
    return pending;
  }

  /**
   * Get list of approved users
   * @returns {Array<string>}
   */
  getApprovedUsers() {
    return Array.from(this.approvedUsers);
  }

  /**
   * Remove a user from approved list
   * @param {string} userId - User ID
   * @returns {boolean} True if removed
   */
  removeApprovedUser(userId) {
    const removed = this.approvedUsers.delete(userId);
    if (removed) {
      this.save();
    }
    return removed;
  }

  /**
   * Remove a pending pairing
   * @param {string} codeOrUserId - Pairing code or user ID
   * @returns {boolean} True if removed
   */
  removePendingPairing(codeOrUserId) {
    const normalized = codeOrUserId.toUpperCase().trim();

    // Try as code first
    for (const [userId, data] of this.pendingPairings) {
      if (data.code === normalized) {
        this.pendingPairings.delete(userId);
        this.save();
        return true;
      }
    }

    // Try as user ID
    if (this.pendingPairings.has(codeOrUserId)) {
      this.pendingPairings.delete(codeOrUserId);
      this.save();
      return true;
    }

    return false;
  }

  /**
   * Clean up expired pairings
   */
  cleanup() {
    const now = Date.now();
    let removed = 0;

    for (const [userId, data] of this.pendingPairings) {
      if (now >= data.expiresAt) {
        this.pendingPairings.delete(userId);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[pumble-pairing] Cleaned up ${removed} expired pairing(s)`);
      this.save();
    }
  }

  /**
   * Clear all pairings and approved users (for testing)
   */
  reset() {
    this.pendingPairings.clear();
    this.approvedUsers.clear();
    this.save();
  }

  /**
   * Cleanup on shutdown
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.save();
  }
}

module.exports = PairingManager;
