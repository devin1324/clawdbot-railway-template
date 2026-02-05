/**
 * Pumble Plugin Main Entry
 *
 * Provides utility functions and exports for the Pumble channel integration.
 */

const PumbleClient = require('./client');
const MessageFormatter = require('./formatter');
const PairingManager = require('./pairing');
const RateLimiter = require('./rate-limiter');
const { WebhookHandler, handleWebhook, getHandler } = require('./webhook-handler');

/**
 * Initialize Pumble plugin with configuration
 * @param {Object} config - Pumble configuration
 * @returns {Object} Plugin instance
 */
function initialize(config) {
  const client = new PumbleClient(config.apiKey, config.webhookUrl);
  const formatter = new MessageFormatter();
  const pairingManager = new PairingManager(config.stateDir);

  return {
    client,
    formatter,
    pairingManager,

    /**
     * Send a message to Pumble
     * @param {Object} message - Message to send
     */
    async sendMessage(message) {
      return client.sendMessage(message);
    },

    /**
     * Get bot user info
     */
    async getBotUser() {
      return client.getBotUser();
    },

    /**
     * Approve a pairing code
     * @param {string} code - Pairing code
     */
    approvePairing(code) {
      return pairingManager.approvePairing(code);
    },

    /**
     * Get pending pairings
     */
    getPendingPairings() {
      return pairingManager.getPendingPairings();
    },

    /**
     * Get approved users
     */
    getApprovedUsers() {
      return pairingManager.getApprovedUsers();
    },

    /**
     * Shutdown plugin
     */
    shutdown() {
      pairingManager.shutdown();
    }
  };
}

/**
 * CLI command handlers for OpenClaw pairing commands
 */
const commands = {
  /**
   * Approve a pairing code
   * @param {string[]} args - Command arguments [code]
   */
  approve(args) {
    if (!args || args.length < 1) {
      return { error: 'Usage: openclaw pairing approve pumble <code>' };
    }

    const handler = getHandler();
    if (!handler.pairingManager) {
      return { error: 'Pumble pairing manager not initialized' };
    }

    const result = handler.pairingManager.approvePairing(args[0]);
    return result;
  },

  /**
   * List pending pairings
   */
  list() {
    const handler = getHandler();
    if (!handler.pairingManager) {
      return { error: 'Pumble pairing manager not initialized' };
    }

    const pending = handler.pairingManager.getPendingPairings();
    return {
      pending,
      message: `${pending.length} pending pairing(s)`
    };
  },

  /**
   * List approved users
   */
  approved() {
    const handler = getHandler();
    if (!handler.pairingManager) {
      return { error: 'Pumble pairing manager not initialized' };
    }

    const approved = handler.pairingManager.getApprovedUsers();
    return {
      approved,
      message: `${approved.length} approved user(s)`
    };
  }
};

module.exports = {
  // Core components
  PumbleClient,
  MessageFormatter,
  PairingManager,
  RateLimiter,
  WebhookHandler,

  // Main functions
  initialize,
  handleWebhook,
  getHandler,

  // CLI commands
  commands
};
