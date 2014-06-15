var assert = require('assert');
var async = require('async');
var crypto = require('crypto');
var moment = require('moment');
var request = require('request');
var util = require('util');
var xml2js = require('xml2js');
var _ = require('underscore');

var schemas = {};
var types = {};
var baseElements = {};

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

exports.validator = function (xpath, currentValue, newValue) {
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

  // TODO: Remove arrays, process instances when parse.length === 0, should we convert [] to empty if not already and no array is specified? Should we convert empty to [] if empty, but array specified?
  // TODO: Do tests with all possible OAI types, download them, cache them
  // TODO: Allow using cached XML Schema files

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

  return newValue;
};

function randomString() {
  return crypto.pseudoRandomBytes(10).toString('hex');
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
      _.each(complexType.sequence[0].choice || [], function (choice) {
        _.each(choice.element || [], function (element) {
          children[element.$.name] = {
            type: element.$.type,
            isArray: element.$.maxOccurs === 'unbounded' || (!!element.$.maxOccurs && parseInt(element.$.maxOccurs) > 1)
          };
          delete choice.element;
          assert(_.isEmpty(choice), util.inspect(choice, false, null));
        });
      });
      delete complexType.sequence[0].choice;
      if (complexType.sequence[0].any) {
        type.anyChildren = true;
      }
      delete complexType.sequence[0].any;
      assert(_.isEmpty(complexType.sequence[0]), util.inspect(complexType.sequence[0], false, null));
      type.children = children;
    }
    delete complexType.sequence;
    if (complexType.choice) {
      var children = {};
      assert.equal(complexType.choice.length, 1, util.inspect(complexType.choice, false, null));
      if (complexType.choice[0].$) {
        // TODO: We do not do anything with minOccurs and maxOccurs attributes on choice element itself, should we? Can this influence isArray of children?
        delete complexType.choice[0].$.minOccurs;
        delete complexType.choice[0].$.maxOccurs;
        assert(_.isEmpty(complexType.choice[0].$), util.inspect(complexType.choice[0].$, false, null));
      }
      delete complexType.choice[0].$;
      _.each(complexType.choice[0].element || [], function (element) {
        children[element.$.name] = {
          type: element.$.type,
          isArray: element.$.maxOccurs === 'unbounded' || (!!element.$.maxOccurs && parseInt(element.$.maxOccurs) > 1)
        };
      });
      delete complexType.choice[0].element;
      assert(_.isEmpty(complexType.choice[0]), util.inspect(complexType.choice[0], false, null));
      type.children = children;
    }
    delete complexType.choice;
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

  // We ignore annotations, imports and top-level attributes
  delete schema.annotation;
  // TODO: Fetch and parse imports as well
  delete schema.import;
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

function findSchemas(obj) {
  var pendingSchemas = {};
  _.each(obj, function (o, tag) {
    if (tag !== '$') {
      if (_.isObject(o)) {
        _.extend(pendingSchemas, findSchemas(o));
      }
    }
    else {
      if (o['xsi:schemaLocation']) {
        var schemaLocation = o['xsi:schemaLocation'].split(/\s+/);
        assert.equal(schemaLocation.length, 2);
        pendingSchemas[schemaLocation[0]] = schemaLocation[1];
      }
    }
  });
  return pendingSchemas;
}

function populateSchemas(str, cb) {
  xml2js.parseString(str, function (err, result) {
    if (err) {
      cb(err);
      return;
    }

    var pendingSchemas = findSchemas(result);

    async.each(_.keys(pendingSchemas), function (pending, cb) {
      if (schemas[pending]) {
        cb();
        return;
      }

      request(pendingSchemas[pending], function (err, response, body) {
        if (err) {
          cb(err);
          return;
        }
        else if (response.statusCode !== 200) {
          cb("Error downloading " + pending + " schema (" + pendingSchemas[pending] + "): " + response.statusCode);
          return;
        }

        xml2js.parseString(body, function (err, result) {
          if (err) {
            cb(err);
            return;
          }

          if (!result || !result.schema || !result.schema.$ || result.schema.$.targetNamespace !== pending) {
            cb("Invalid schema downloaded for " + pending + " (" + pendingSchemas[pending] + ")");
            return;
          }

          var schema = result.schema;

          var namespace = null;
          _.each(schema.$, function (value, attr) {
            if (value === pending && attr.slice(0, 6) === 'xmlns:') {
              namespace = attr.slice(6);
            }
          });

          if (!namespace) {
            cb("Could not determine namespace for schema " + pending + " (" + pendingSchemas[pending] + ")");
            return;
          }

          parseElements(namespace, schema);

          var newTypes = parseTypes(namespace, schema);
          _.extend(types, newTypes);

          // Previous parsing calls are destructive and should consume schema so that it is empty now
          assert(_.isEmpty(schema), util.inspect(schema, false, null));

          schemas[pending] = true;

          cb();
        });
      });
    }, cb);
  });
}

exports.parseString = function (str, a, b) {
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
  populateSchemas(str, function (err) {
    if (err) {
      cb(err);
      return;
    }

    options.explicitRoot = true;
    options.explicitArray = true;
    options.validator = exports.validator;
    parser = new xml2js.Parser(options);
    parser.parseString(str, cb);
  });
};
