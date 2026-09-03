'use strict';

function log(event, data = {}) {
  console.log(`[sales-v5] ${event}`, {
    ...data,
    at: new Date().toISOString()
  });
}

module.exports = { log };
