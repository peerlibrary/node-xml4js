var assertBase = require('assert');
var util = require('util');
var _ = require('underscore');

function assert(condition, message) {
  if (!condition) {
    if (_.isObject(message)) {
      message = util.inspect(message, false, null);
    }
    assertBase(false, message);
  }
}

module.exports = assert;
