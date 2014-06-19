var async = require('async');
var xml2js = require('xml2js');
var _ = require('underscore');

var multivalue = require('./multivalue');
var validator = require('./validator');
var xsd = require('./xsd');

function Parser(options) {
  var self = this;

  options = _.defaults(options, {
    // Should we automatically download, parse and add any found missing schemas?
    // Will do Internet queries and could potentially leak information about what
    // type of documents you are parsing. Will cache schemas, so they will not be
    // redownloaded for every document parsed with the same instance of this module.
    // Consider setting this to false and adding schemas yourself with addSchema.
    downloadSchemas: false,
    outputWithNamespace: false
  });

  // TODO: This might not be really needed
  options.explicitRoot = true;
  // We set this and then clean up unnecessary arrays anyway
  options.explicitArray = true;
  // TODO: We currently hard-code this but then clean it up, what if user wants namespace information, we should not clean it up in that case
  options.xmlns = true;
  // Our own validator which cleans up unnecessary arrays
  // TODO: We could allow chaining of validators
  options.validator = validator.validator;

  options.parser = self;

  xml2js.Parser.call(self, options);

  // A multi-value dict of namespace URLs and schema contents
  self.parsedSchemas = {};
  // A multi-value dict of namespace URLs and schema URLs
  self.downloadedSchemas = {};

  self.namespacePrefixes = _.clone(xsd.BASE_NAMESPACES);
  self.attributes = {};
  self.elements = {};
  self.types = _.clone(xsd.BASE_TYPES);

  return self;
}

Parser.prototype = Object.create(xml2js.Parser.prototype);
Parser.prototype.constructor = Parser;

_.extend(Parser.prototype, validator.ValidatorMixin);
_.extend(Parser.prototype, xsd.XsdMixin);

function populateSchemas(parser, str, cb) {
  parser.findSchemas(str, function (err, foundSchemas) {
    if (err) {
      cb(err);
      return;
    }

    if (parser.options.downloadSchemas) {
      // We do a breadth-first traversal of schemas to prevent possible infinite loops
      async.until(function () {
        return _.isEmpty(foundSchemas);
      }, function (cb) {
        var schemas = foundSchemas;
        foundSchemas = {};
        async.each(_.keys(schemas), function (namespaceUrl, cb) {
          async.each(schemas[namespaceUrl], function (schemaUrl, cb) {
            parser.downloadAndAddSchema(namespaceUrl, schemaUrl, function (err, importsAndIncludes) {
              if (err) {
                cb(err);
                return;
              }

              _.each(importsAndIncludes, function (nextSchemaUrls, nextNamespaceUrl) {
                _.each(nextSchemaUrls, function (nextSchemaUrl) {
                  if (!multivalue.hasValue(parser.downloadedSchemas, nextNamespaceUrl, nextSchemaUrl)) {
                    multivalue.addValue(foundSchemas, nextNamespaceUrl, nextSchemaUrl);
                  }
                });
              });

              cb();
            });
          }, cb);
        }, cb);
      }, cb);
    }
    else {
      for (var namespaceUrl in foundSchemas) {
        if (foundSchemas.hasOwnProperty(namespaceUrl)) {
          // It checks only if any schema files were parsed for a given namespaceUrl, not really if they
          // match parsed files (we would have to fetch content to do that properly, which we cannot do)
          if (!parser.parsedSchemas[namespaceUrl]) {
            cb("Schema " + namespaceUrl + " (" + foundSchemas[namespaceUrl].join(", ") + ") unavailable and automatic downloading not enabled");
            return;
          }
        }
      }
      // All schemas used in the document are available, good (there could still be some imported or included ones missing, though)
      cb();
    }
  });
}

Parser.prototype.parseString = function (str, cb) {
  var self = this;

  populateSchemas(self, str, function (err) {
    if (err) {
      cb(err);
      return;
    }

    xml2js.Parser.prototype.parseString.call(self, str, cb);
  });
};

exports.Parser = Parser;
