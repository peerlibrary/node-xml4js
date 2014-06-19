#!/usr/bin/env node

var xml4json = require('../lib/xml4json');

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

xml4json({
  downloadSchemas: false
}, SCHEMAS);
