/**
 * Rate Limiter for Pumble API
 *
 * Pumble webhooks are limited to 1 request/second.
 * This queue-based rate limiter ensures we respect that limit.
 */

class RateLimiter {
  constructor(minIntervalMs = 1000) {
    this.minInterval = minIntervalMs;
    this.queue = [];
    this.processing = false;
    this.lastExecutionTime = 0;
  }

  /**
   * Enqueue a function to be executed with rate limiting
   * @param {Function} fn - Async function to execute
   * @returns {Promise} - Resolves when the function completes
   */
  async enqueue(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });

      if (!this.processing) {
        this.process();
      }
    });
  }

  /**
   * Process the queue with rate limiting
   */
  async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const { fn, resolve, reject } = this.queue.shift();

      // Calculate time to wait
      const now = Date.now();
      const timeSinceLastExecution = now - this.lastExecutionTime;
      const timeToWait = Math.max(0, this.minInterval - timeSinceLastExecution);

      if (timeToWait > 0) {
        await this.sleep(timeToWait);
      }

      try {
        const result = await fn();
        this.lastExecutionTime = Date.now();
        resolve(result);
      } catch (err) {
        this.lastExecutionTime = Date.now();
        reject(err);
      }
    }

    this.processing = false;
  }

  /**
   * Sleep helper
   * @param {number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current queue size
   */
  getQueueSize() {
    return this.queue.length;
  }

  /**
   * Clear the queue
   */
  clear() {
    this.queue = [];
  }
}

module.exports = RateLimiter;
