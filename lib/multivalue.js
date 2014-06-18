// A simple multi-value dict

var _ = require('underscore');

function hasValue(dict, key, value) {
  if (!dict[key]) {
    return false;
  }
  return _.indexOf(dict[key], value) !== -1;
}

function addValue(dict, key, value) {
  if (!dict[key]) {
    dict[key] = [];
  }
  dict[key] = _.union(dict[key], [value]);
  return dict;
}

function removeValue(dict, key, value) {
  if (!dict[key]) {
    return;
  }
  dict[key] = _.without(dict[key], value);
  if (!dict[key].length) {
    delete dict[key];
  }
  return dict;
}

exports.hasValue = hasValue;
exports.addValue = addValue;
exports.removeValue = removeValue;
