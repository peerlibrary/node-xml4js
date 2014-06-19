#!/usr/bin/env node

var async = require('async');
var fs = require('fs');
var util = require('util');
var xml4js = require('../xml4js');
var _ = require('underscore');

function xml4json(options, schemas) {
  if (!options) {
    options = {};
  }
  if (!schemas) {
    schemas = {};
  }

  var parser = new xml4js.Parser(options);

  async.each(_.keys(schemas), function (namespace, cb) {
    var files = schemas[namespace];
    if (!_.isArray(files)) {
      files = [files];
    }
    async.each(files, function (file, cb) {
      var content = fs.readFileSync(file, {encoding: 'utf-8'});
      parser.addSchema(namespace, content, cb);
    }, cb)
  }, function (err) {
    if (err) {
      console.error('' + err);
      process.exit(2);
      return;
    }

    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    var input = '';
    process.stdin.on('data', function (chunk) {
      input += chunk;
    }).on('end', function () {
      parser.parseString(input, function (err, result) {
        if (err) {
          if (err.stack) {
            console.error(err.stack);
          }
          else {
            console.error('' + err);
          }
          process.exit(1);
        }
        else {
          console.log(JSON.stringify(result, null, 2));
          process.exit(0);
        }
      });
    });
  });
}

module.exports = xml4json;
