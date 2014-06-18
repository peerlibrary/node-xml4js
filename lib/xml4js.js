var parser = require('./parser');
var _ = require('underscore');

function parseString(str, a, b) {
  var cb, options;
  // We want != here
  if (b != null) {
    if (_.isFunction(b)) {
      cb = b;
    }
    if (_.isObject(a)) {
      options = a;
    }
  }
  else {
    if (_.isFunction(a)) {
      cb = a;
    }
    options = {};
  }
  new parser.Parser(options).parseString(str, cb);
}

exports.parseString = parseString;
exports.Parser = parser.Parser;
