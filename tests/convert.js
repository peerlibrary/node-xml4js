#!/usr/bin/env node

var async = require('async');
var fs = require('fs');
var util = require('util');
var xmlxsd2js = require('../xmlxsd2js');
var _ = require('underscore');

var SCHEMAS = {
  'http://www.openarchives.org/OAI/2.0/': './data/OAI-PMH.xsd',
  'http://www.openarchives.org/OAI/1.1/eprints': './data/eprints.xsd',
  'http://www.openarchives.org/OAI/2.0/branding/': './data/branding.xsd',
  'http://www.openarchives.org/OAI/2.0/oai_dc/': './data/oai_dc.xsd',
  'http://purl.org/dc/elements/1.1/': './data/simpledc20021212.xsd',
  'http://www.w3.org/XML/1998/namespace': './data/xml.xsd',
  'http://arxiv.org/OAI/arXiv/': './data/arXiv.xsd',
  'http://arxiv.org/OAI/arXivOld/': './data/arXivOld.xsd',
  'http://arxiv.org/OAI/arXivRaw/': './data/arXivRaw.xsd'
};

async.each(_.keys(SCHEMAS), function (namespace, cb) {
  var content = fs.readFileSync(SCHEMAS[namespace], {encoding: 'utf-8'});
  xmlxsd2js.addSchema(namespace, content, cb);
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
