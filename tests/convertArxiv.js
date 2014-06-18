#!/usr/bin/env node

var async = require('async');
var fs = require('fs');
var util = require('util');
var xmlxsd2js = require('../xmlxsd2js');
var _ = require('underscore');

var SCHEMAS = {
  'http://www.openarchives.org/OAI/2.0/': './arxiv/OAI-PMH.xsd',
  'http://www.openarchives.org/OAI/1.1/eprints': './arxiv/eprints.xsd',
  'http://www.openarchives.org/OAI/2.0/branding/': './arxiv/branding.xsd',
  'http://www.openarchives.org/OAI/2.0/oai_dc/': './arxiv/oai_dc.xsd',
  'http://purl.org/dc/elements/1.1/': './arxiv/simpledc20021212.xsd',
  'http://www.w3.org/XML/1998/namespace': './arxiv/xml.xsd',
  'http://arxiv.org/OAI/arXiv/': './arxiv/arXiv.xsd',
  'http://arxiv.org/OAI/arXivOld/': './arxiv/arXivOld.xsd',
  'http://arxiv.org/OAI/arXivRaw/': './arxiv/arXivRaw.xsd'
};

async.each(_.keys(SCHEMAS), function (namespace, cb) {
  var files = SCHEMAS[namespace];
  if (!_.isArray(files)) {
    files = [files];
  }
  async.each(files, function (file, cb) {
    var content = fs.readFileSync(file, {encoding: 'utf-8'});
    xmlxsd2js.addSchema(namespace, content, cb);
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
    xmlxsd2js.parseString(input, {
      downloadSchemas: false
    }, function (err, result) {
      if (err) {
        console.error('' + err);
        process.exit(1);
      }
      else {
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
      }
    });
  });
});
