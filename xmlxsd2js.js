var assert = require('assert');
var async = require('async');
var crypto = require('crypto');
var moment = require('moment');
var request = require('request');
var util = require('util');
var xml2js = require('xml2js');
var _ = require('underscore');

var parsedSchemas = {};
var downloadedSchemas = {};
var types = {};
var baseElements = {};
var namespacePrefixes = {
  // Bound by definition
  'http://www.w3.org/XML/1998/namespace': 'xml'
};

types.string = types.normalizedString = types.token = types.language = types.NMTOKEN = types.Name = types.NCName = types.ID = types.IDREF = types.ENTITY = {
  parse: function (value) {
    return value;
  }
};

types.NMTOKENS = types.IDREFS = types.ENTITIES = {
  parse: function (value) {
    return value.split(/\s+/);
  }
};

types.boolean = {
  parse: function (value) {
    return _.contains(['true', 'false', '0', '1'], value.toLowerCase());
  }
};

types.integer = types.nonPositiveInteger = types.negativeInteger = types.long = types.int = types.short = types.byte = types.nonNegativeInteger = types.unsignedLong = types.unsignedInt = types.unsignedShort = types.unsignedByte = types.positiveInteger = {
  parse: function (value) {
    return parseInt(value);
  }
};

types.decimal = {
  parse: function (value) {
    return parseFloat(value);
  }
};

types.double = types.float = {
  parse: function (value) {
    if (value.toLowerCase() === 'inf') {
      value = 'Infinity';
    }
    else if (value.toLowerCase() === '-inf') {
      value = '-Infinity';
    }
    return parseFloat(value);
  }
};

// duration not implemented

types.dateTime = types.date = {
  parse: function (value) {
    return moment.utc(value).toDate();
  }
};

// time not implemented

// gYearMonth, gYear, gMonthDay, gDay, gMonth not implemented

types.hexBinary = {
  parse: function (value) {
    return new Buffer(value, 'hex');
  }
};

types.base64Binary = {
  parse: function (value) {
    return new Buffer(value, 'base64');
  }
};

types.anyURI = {
  parse: function (value) {
    return value;
  }
};

// QName, NOTATION not implemented

function resolveType(xpath, typeName) {
  if (!types[typeName]) {
    throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath);
  }
  else if (types[typeName].content && types[typeName].content.base) {
    if (_.isArray(types[typeName].content.base)) {
      var res = [];
      _.each(types[typeName].content.base, function (base) {
        res = res.concat(resolveType(xpath, base));
      });
      return res;
    }
    else {
      return resolveType(xpath, types[typeName].content.base);
    }
  }
  else {
    return [types[typeName]];
  }
}

function resolveToParse(xpath, typeName) {
  if (!types[typeName]) {
    throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath);
  }
  else if (types[typeName].parse) {
    return [types[typeName].parse];
  }
  else if (types[typeName].content && types[typeName].content.base) {
    if (_.isArray(types[typeName].content.base)) {
      var res = [];
      _.each(types[typeName].content.base, function (base) {
        res = res.concat(resolveToParse(xpath, base));
      });
      return res;
    }
    else {
      return resolveToParse(xpath, types[typeName].content.base);
    }
  }
  else {
    return [];
  }
}

function tryParse(parse, value) {
  var exception = null;
  for (var i = 0; i < parse.length; i++) {
    try {
      return parse[0](value);
    }
    catch (e) {
      exception = e;
    }
  }
  assert(exception);
  throw exception;
}

function tryChildren(xpath, type) {
  for (var i = 0; i < type.length; i++) {
    if (type[i].anyChildren) {
      return baseElements;
    }
    else if (type[i].children) {
      return type[i].children;
    }
  }
  throw new xml2js.ValidationError("Type does not expect children, xpath: " + xpath + ", type: " + util.inspect(type, false, null));
}

function tryRemoveArrays(xpath, attrkey, charkey, type, newValue) {
  var exception = null;
  for (var i = 0; i < type.length; i++) {
    var value = _.clone(newValue);
    try {
      if (type[i].anyChildren) {
        // TODO: Currently we support only one "any" element at the time (it can have multiple entries, but they have to be same "any" tag). Can there be multiple "any" elements defined?
        assert(_.size(value), 1, util.inspect(value, false, null));
        _.each(value, function (child, name) {
          assert(_.has(type[i], 'isArray'), util.inspect(type[i], false, null));
          if (!type[i].isArray) {
            assert.equal(child.length, 1, util.inspect(child, false, null));
            value[name] = child[0];
          }
        });
      }
      else if (type[i].children) {
        _.each(value, function (child, name) {
          if (name === attrkey || name === charkey) {
            // Attribute and character content keys are not part of the schema
            return;
          }
          if (type[i].children[name]) {
            assert(_.has(type[i].children[name], 'isArray'), util.inspect(type[i].children[name], false, null));
            if (!type[i].children[name].isArray) {
              assert.equal(child.length, 1, util.inspect(child, false, null));
              value[name] = child[0];
            }
          }
          else {
            throw new xml2js.ValidationError("Element (" + name + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(type[i].children, false, null));
          }
        });
      }
      else {
        throw new xml2js.ValidationError("Type does not expect children, xpath: " + xpath + ", type: " + util.inspect(type[i], false, null));
      }
      return value;
    }
    catch (e) {
      exception = e;
    }
  }
  assert(exception);
  throw exception;
}

function resolveToAttributes(xpath, typeName) {
  if (!types[typeName]) {
    throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath);
  }
  else if (types[typeName].content && types[typeName].content.attributes) {
    return types[typeName].content.attributes;
  }
  else {
    return {};
  }
}

function validator(xpath, currentValue, newValue) {
  var attrkey = this.attrkey;
  var charkey = this.charkey;

  var path = xpath.split('/');
  var currentElementSet = baseElements;

  // We skip initial /
  _.each(path.slice(1, path.length - 1), function (segment) {
    if (!currentElementSet[segment]) {
      throw new xml2js.ValidationError("Element (" + segment + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(currentElementSet, false, null));
    }
    else if (!currentElementSet[segment].type) {
      throw new xml2js.ValidationError("Element (" + segment + ") does not match schema, type not specified, xpath: " + xpath + ", element: " + util.inspect(currentElementSet[segment], false, null));
    }
    else {
      var type = resolveType(xpath, currentElementSet[segment].type);
      currentElementSet = tryChildren(xpath, type);
    }
  });

  var lastSegment = path[path.length - 1];

  // TODO: Do tests with all possible OAI types, download them, cache them

  if (!currentElementSet[lastSegment]) {
    throw new xml2js.ValidationError("Element (" + lastSegment + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(currentElementSet, false, null));
  }

  if (newValue[attrkey]) {
    var attributes = resolveToAttributes(xpath, currentElementSet[lastSegment].type);
    _.each(newValue[attrkey], function (value, attribute) {
      if (attribute.slice(0, 5) === 'xmlns') {
        delete newValue[attrkey][attribute];
      }
      else if (attribute.slice(0, 4) === 'xsi:') {
        delete newValue[attrkey][attribute];
      }
      else if (!attributes[attribute]) {
        throw new xml2js.ValidationError("Unexpected attribute " + attribute + ", xpath: " + xpath + ", allowed attributes: " + util.inspect(attributes, false, null))
      }
      else {
        var parse = resolveToParse(xpath, attributes[attribute]);
        if (_.isString(value)) {
          newValue[attrkey][attribute] = tryParse(parse, value);
        }
        else if (value.value) {
          newValue[attrkey][attribute] = tryParse(parse, value.value);
        }
        else {
          throw new xml2js.ValidationError("Invalid attribute " + attribute + " value, xpath: " + xpath + ": " + util.inspect(value, false, null))
        }
      }
    });
    if (_.isEmpty(newValue[attrkey])) {
      delete newValue[attrkey];
    }
  }

  var parse = resolveToParse(xpath, currentElementSet[lastSegment].type);
  if (parse.length !== 0) {
    // If it is string, we can try to parse it
    if (_.isString(newValue)) {
      newValue = tryParse(parse, newValue);
    }
    // If there is object with only character value, we can parse it and replace whole value with it
    else if (_.size(newValue) === 1 && newValue[charkey]) {
      newValue = tryParse(parse, newValue[charkey]);
    }
    // It might be an object with some attributes together with character value, then we just parse the value itself
    else if (_.without(_.keys(newValue), charkey, attrkey).length === 0) {
      newValue[charkey] = tryParse(parse, newValue[charkey]);
    }
    else {
      throw new xml2js.ValidationError("Element (" + lastSegment + ") does not match schema, xpath: " + xpath + ", expected value, got : " + util.inspect(newValue, false, null));
    }
  }
  else {
    var type = resolveType(xpath, currentElementSet[lastSegment].type);
    newValue = tryRemoveArrays(xpath, attrkey, charkey, type, newValue);
  }

  return newValue;
}

function randomString() {
  return crypto.pseudoRandomBytes(10).toString('hex');
}

function parseTypesChoice(input) {
  assert(input.choice, util.inspect(input, false, null));
  var children = {};
  assert.equal(input.choice.length, 1, util.inspect(input.choice, false, null));
  if (input.choice[0].$) {
    // TODO: We do not do anything with minOccurs and maxOccurs attributes on choice element itself, should we? Can this influence isArray of children?
    delete input.choice[0].$.minOccurs;
    delete input.choice[0].$.maxOccurs;
    assert(_.isEmpty(input.choice[0].$), util.inspect(input.choice[0].$, false, null));
  }
  delete input.choice[0].$;
  _.each(input.choice[0].element || [], function (element) {
    children[element.$.name] = {
      type: element.$.type,
      isArray: element.$.maxOccurs === 'unbounded' || (!!element.$.maxOccurs && parseInt(element.$.maxOccurs) > 1)
    };
  });
  delete input.choice[0].element;
  assert(_.isEmpty(input.choice[0]), util.inspect(input.choice[0], false, null));
  delete input.choice;
  return children;
}

function parseTypes(namespace, schema) {
  var newTypes = {};
  _.each(schema.complexType || [], function (complexType) {
    var type = {};
    if (complexType.sequence) {
      var children = {};
      assert.equal(complexType.sequence.length, 1, util.inspect(complexType.sequence, false, null));
      _.each(complexType.sequence[0].element || [], function (element) {
        children[element.$.name] = {
          type: element.$.type,
          isArray: element.$.maxOccurs === 'unbounded' || (!!element.$.maxOccurs && parseInt(element.$.maxOccurs) > 1)
        };
      });
      delete complexType.sequence[0].element;
      if (complexType.sequence[0].choice) {
        _.extend(children, parseTypesChoice(complexType.sequence[0]));
      }
      if (complexType.sequence[0].any) {
        assert.equal(complexType.sequence[0].any.length, 1, util.inspect(complexType.sequence[0].any, false, null));
        type.anyChildren = true;
        type.isArray = complexType.sequence[0].any[0].$.maxOccurs === 'unbounded' || (!!complexType.sequence[0].any[0].$.maxOccurs && parseInt(complexType.sequence[0].any[0].$.maxOccurs) > 1)
      }
      delete complexType.sequence[0].any;
      assert(_.isEmpty(complexType.sequence[0]), util.inspect(complexType.sequence[0], false, null));
      type.children = children;
    }
    delete complexType.sequence;
    if (complexType.choice) {
      type.children = parseTypesChoice(complexType);
    }
    assert(!(complexType.simpleContent && complexType.complexContent), util.inspect(complexType, false, null));
    _.each(['simpleContent', 'complexContent'], function (anyContent) {
      if (complexType[anyContent]) {
        var content = {};
        assert.equal(complexType[anyContent].length, 1, util.inspect(complexType[anyContent], false, null));
        assert.equal(complexType[anyContent][0].extension.length, 1, util.inspect(complexType[anyContent][0].extension, false, null));
        content.base = complexType[anyContent][0].extension[0].$.base;
        delete complexType[anyContent][0].extension[0].$.base;
        assert(_.isEmpty(complexType[anyContent][0].extension[0].$), util.inspect(complexType[anyContent][0].extension[0].$, false, null));
        delete complexType[anyContent][0].extension[0].$;
        if (complexType[anyContent][0].extension[0].attribute) {
          var attributes = {};
          _.each(complexType[anyContent][0].extension[0].attribute, function (attribute) {
            attributes[attribute.$.name] = attribute.$.type;
          });
          content.attributes = attributes;
        }
        delete complexType[anyContent][0].extension[0].attribute;
        assert(_.isEmpty(complexType[anyContent][0].extension[0]), util.inspect(complexType[anyContent][0].extension[0], false, null));
        type.content = content;
      }
      delete complexType[anyContent];
    });
    if (complexType.attribute) {
      var attributes = {};
      _.each(complexType.attribute, function (attribute) {
        attributes[attribute.$.name] = attribute.$.type;
      });
      type.attributes = attributes;
    }
    delete complexType.attribute;

    var typeName = namespace + ':' + complexType.$.name;
    delete complexType.$.name;
    assert(_.isEmpty(complexType.$), util.inspect(complexType.$, false, null));
    delete complexType.$;
    newTypes[typeName] = type;

    // We ignore annotations
    delete complexType.annotation;
  });
  delete schema.complexType;

  _.each(schema.simpleType || [], function (simpleType) {
    var type = {};
    assert(!(simpleType.restriction && simpleType.union), util.inspect(simpleType, false, null));
    if (simpleType.restriction) {
      var content = {};
      assert.equal(simpleType.restriction.length, 1, util.inspect(simpleType.restriction, false, null));
      content.base = simpleType.restriction[0].$.base;
      delete simpleType.restriction[0].$.base;
      assert(_.isEmpty(simpleType.restriction[0].$), util.inspect(simpleType.restriction[0].$, false, null));
      delete simpleType.restriction[0].$;
      // We ignore the pattern and enumeration
      delete simpleType.restriction[0].pattern;
      delete simpleType.restriction[0].enumeration;
      assert(_.isEmpty(simpleType.restriction[0]), util.inspect(simpleType.restriction[0], false, null));
      type.content = content;
    }
    delete simpleType.restriction;
    if (simpleType.union) {
      var content = {};
      assert.equal(simpleType.union.length, 1, util.inspect(simpleType.union, false, null));
      content.base = simpleType.union[0].$.memberTypes.split(/\s+/);
      delete simpleType.union[0].$.memberTypes;
      assert(_.isEmpty(simpleType.union[0].$), util.inspect(simpleType.union[0].$, false, null));
      delete simpleType.union[0].$;
      assert(_.isEmpty(simpleType.union[0]), util.inspect(simpleType.union[0], false, null));
      type.content = content;
    }
    var typeName = namespace + ':' + simpleType.$.name;
    delete simpleType.$.name;
    assert(_.isEmpty(simpleType.$), util.inspect(simpleType.$, false, null));
    newTypes[typeName] = type;
  });
  delete schema.simpleType;

  // We ignore annotations and top-level attributes
  delete schema.annotation;
  delete schema.$;

  return newTypes;
}

function parseElements(namespace, schema) {
  _.each(schema.element || [], function (element) {
    if (element.$.type) {
      baseElements[element.$.name] = {
        type: element.$.type,
        isArray: false
      };
    }
    else {
      // Type is nested inside the element, so we create out own name for it
      var name = element.$.name;
      var randomName = name + '-' + randomString();
      var typeName = namespace + ':' + randomName;

      // Then we pretend that it is defined with that name
      _.each(element.complexType || [], function (complexType) {
        if (!complexType.$) complexType.$ = {};
        complexType.$.name = randomName;
      });
      _.each(element.simpleType || [], function (simpleType) {
        if (!simpleType.$) simpleType.$ = {};
        simpleType.$.name = randomName;
      });

      // Parse it and store it
      var newTypes = parseTypes(namespace, element);
      _.extend(types, newTypes);

      // And assign it to the element
      baseElements[name] = {
        type: typeName,
        isArray: false
      };
    }
  });
  delete schema.element;
}

function parseImports(schema) {
  var pendingImports = {};
  _.each(schema.import || [], function (schemaImport) {
    if (!parsedSchemas[schemaImport.$.namespace]) {
      pendingImports[schemaImport.$.namespace] = schemaImport.$.schemaLocation;
    }
  });
  delete schema.import;
  return pendingImports;
}

function parseNamespacePrefixes(schema, cb) {
  for (attr in schema.$) {
    if (schema.$.hasOwnProperty(attr)) {
      if (attr.slice(0, 6) === 'xmlns:') {
        var value = schema.$[attr];
        var namespace = attr.slice(6);
        if (!namespace) {
          cb("Invalid namespace declaration: " + attr + ", for schema: " + util.inspect(schema, false, null));
          return;
        }
        else if (namespacePrefixes[value] && namespacePrefixes[value] !== namespace) {
          cb("Conflicting namespace declaration: " + namespacePrefixes[value] + " vs. " + namespace + ", for schema: " + util.inspect(schema, false, null));
          return;
        }
        else {
          namespacePrefixes[value] = namespace;
        }
      }
    }
  }
  cb();
}

// Returns pending imports object in a callback. Those schemas have
// to be added as well for all necessary types to be satisfied.
function addSchema(namespaceUrl, schemaContent, cb) {
  if (parsedSchemas[namespaceUrl]) {
    cb();
    return;
  }

  xml2js.parseString(schemaContent, {
    tagNameProcessors: [function(str) {
      // Strip XML Schema prefix, if it exists
      return str.replace(/^xs:/, '');
    }]
  }, function (err, result) {
    if (err) {
      cb(err);
      return;
    }

    if (!result || !result.schema || !result.schema.$ || result.schema.$.targetNamespace !== namespaceUrl) {
      cb("Invalid schema downloaded for " + namespaceUrl + ": " + util.inspect(result, false, null));
      return;
    }

    var schema = result.schema;

    parseNamespacePrefixes(schema, function (err) {
      if (err) {
        cb(err);
        return;
      }

      var namespace = namespacePrefixes[namespaceUrl];
      if (!namespace) {
        cb("Could not determine namespace for schema " + namespaceUrl + ", known namespace prefixes: " + util.inspect(namespacePrefixes, false, null));
        return;
      }

      var pendingImports = parseImports(schema);

      parseElements(namespace, schema);

      var newTypes = parseTypes(namespace, schema);
      _.extend(types, newTypes);

      // Previous parsing calls are destructive and should consume schema so that it is empty now
      assert(_.isEmpty(schema), util.inspect(schema, false, null));

      parsedSchemas[namespaceUrl] = schemaContent;
      // We set it again, just to assure we are in sync
      downloadedSchemas[namespaceUrl] = schemaContent;

      cb(null, pendingImports);
    });
  });
}

// Returns pending imports object in a callback. Those schemas have
// to be added as well for all necessary types to be satisfied.
function downloadAndAddSchema(namespaceUrl, schemaUrl, cb) {
  if (parsedSchemas[namespaceUrl]) {
    cb();
    return;
  }

  if (downloadedSchemas[namespaceUrl]) {
    addSchema(namespaceUrl, downloadedSchemas[namespaceUrl], cb);
  }
  else {
    request(schemaUrl, function (err, response, body) {
      if (err) {
        cb(err);
        return;
      }
      else if (response.statusCode !== 200) {
        cb("Error downloading " + namespaceUrl + " schema (" + schemaUrl + "): " + response.statusCode);
        return;
      }

      downloadedSchemas[namespaceUrl] = body;

      addSchema(namespaceUrl, body, cb);
    });
  }
}

function traverseFindSchemas(obj) {
  var foundSchemas = {};
  _.each(obj, function (o, tag) {
    if (tag !== '$') {
      if (_.isObject(o)) {
        _.extend(foundSchemas, traverseFindSchemas(o));
      }
    }
    else {
      if (o['xsi:schemaLocation']) {
        var schemaLocation = o['xsi:schemaLocation'].split(/\s+/);
        assert.equal(schemaLocation.length, 2);
        foundSchemas[schemaLocation[0]] = schemaLocation[1];
      }
    }
  });
  return foundSchemas;
}

// Does not search recursively inside schemas for imported other
// schemas, so there might still be types missing when parsing,
// even if you satisfy all found schemas. You have to inspect
// pending imports returned in a callback of addSchema (or
// downloadAndAddSchema) and satisfy those schemas as well.
function findSchemas(str, cb) {
  xml2js.parseString(str, function (err, result) {
    if (err) {
      cb(err);
      return;
    }

    var foundSchemas = traverseFindSchemas(result);
    cb(null, foundSchemas);
  });
}

function populateSchemas(str, options, cb) {
  findSchemas(str, function (err, foundSchemas) {
    if (err) {
      cb(err);
      return;
    }

    if (options.downloadSchemas) {
      // We do breadth-first traversal of schemas to prevent possible infinite loops
      async.until(function () {
        return _.isEmpty(foundSchemas);
      }, function (cb) {
        async.each(_.keys(foundSchemas), function (namespaceUrl, cb) {
          downloadAndAddSchema(namespaceUrl, foundSchemas[namespaceUrl], function (err, pendingImports) {
            if (err) {
              cb(err);
              return;
            }

            _.each(pendingImports, function (pendingSchemaUrl, pendingNamespaceUrl) {
              if (foundSchemas[pendingNamespaceUrl]) {
                if (foundSchemas[pendingNamespaceUrl] !== pendingSchemaUrl) {
                  throw new Error("Mismatched schema locations for " + pendingNamespaceUrl + ": " + foundSchemas[pendingNamespaceUrl] + " vs. " + pendingSchemaUrl);
                }
              }
              else {
                foundSchemas[pendingNamespaceUrl] = pendingSchemaUrl;
              }
            });

            // We just processed this one, so we can remove it
            delete foundSchemas[namespaceUrl];

            cb();
          });
        }, cb);
      }, cb);
    }
    else {
      for (var namespaceUrl in foundSchemas) {
        if (foundSchemas.hasOwnProperty(namespaceUrl)) {
          if (!parsedSchemas[namespaceUrl]) {
            cb("Schema " + namespaceUrl + " (" + foundSchemas[namespaceUrl] + ") unavailable and automatic downloading not enabled");
            return;
          }
        }
      }
      // All schemas used in the document are available, good (there could still be some imported ones missing)
      cb();
    }
  });
}

function knownSchemas() {
  return _.clone(parsedSchemas);
}

function parseString(str, a, b) {
  var cb, options, parser;
  if (b != null) {
    if (typeof b === 'function') {
      cb = b;
    }
    if (typeof a === 'object') {
      options = a;
    }
  }
  else {
    if (typeof a === 'function') {
      cb = a;
    }
    options = {};
  }
  options = _.defaults(options, {
    // Should we automatically download, parse and add any found missing schemas?
    // Will do Internet queries and could potentially leak information about what
    // type of documents you are parsing. Will cache schemas, so they will not be
    // redownloaded for every document parsed with the same instance of this module.
    // Consider setting this to false and adding schemas yourself with addSchema.
    downloadSchemas: false
  });
  populateSchemas(str, options, function (err) {
    if (err) {
      cb(err);
      return;
    }

    options.explicitRoot = true;
    options.explicitArray = true;
    options.validator = validator;
    parser = new xml2js.Parser(options);
    parser.parseString(str, cb);
  });
}

exports.validator = validator;
exports.addSchema = addSchema;
exports.downloadAndAddSchema = downloadAndAddSchema;
exports.findSchemas = findSchemas;
exports.knownSchemas = knownSchemas;
exports.parseString = parseString;
