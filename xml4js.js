var assertBase = require('assert');
var async = require('async');
var crypto = require('crypto');
var moment = require('moment');
var request = require('request');
var util = require('util');
var xml2js = require('xml2js');
var _ = require('underscore');

// Multi-value dict of namespace URLs and schema contents
var parsedSchemas = {};
// Multi-value dict of namespace URLs and schema URLs
var downloadedSchemas = {};

var types = {};
var baseAttributes = {};
var baseElements = {};
var namespacePrefixes = {
  // Bound by definition
  'http://www.w3.org/XML/1998/namespace': 'xml'
};

// We store XML Schema names without a prefix

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

var XS_TYPES = _.keys(types);

function assert(condition, message) {
  if (!condition) {
    if (_.isObject(message)) {
      message = util.inspect(message, false, null);
    }
    assertBase(false, message);
  }
}

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

function resolveType(xpath, typeName) {
  if (!types[typeName]) {
    throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath + ", known types: " + util.inspect(types, false, null));
  }
  else if (types[typeName].base) {
    var bases = types[typeName].base;
    var other = _.omit(types[typeName], 'base');
    if (!_.isArray(bases)) {
      bases = [bases];
    }
    var resolved = [];
    _.each(bases, function (base) {
      resolved = resolved.concat(_.map(resolveType(xpath, base), function (res) {
        // Make sure we do not override some other type by accident
        var otherClone = _.clone(other);
        var resClone = _.clone(res);
        if (otherClone.children && resClone.children) {
          otherClone.children = _.extend({}, otherClone.children, resClone.children);
          delete resClone.children;
        }
        if (otherClone.attributes && resClone.attributes) {
          otherClone.attributes = _.extend({}, otherClone.attributes, resClone.attributes);
          delete resClone.attributes;
        }
        return _.extend(otherClone, resClone);
      }));
    });
    return resolved;
  }
  else {
    return [types[typeName]];
  }
}

function resolveAttributeType(xpath, typeName) {
  while (_.isObject(typeName)) {
    assert(typeName.ref, typeName);
    if (!baseAttributes[typeName.ref]) {
      throw new xml2js.ValidationError("Referenced attribute " + typeName.ref + " not found, xpath: " + xpath + ", known attributes: " + util.inspect(baseAttributes, false, null));
    }
    typeName = baseAttributes[typeName.ref];
  }
  return typeName;
}

function resolveElement(xpath, element) {
  var isArrayDefault = null;
  while (element.ref) {
    if (!baseElements[element.ref]) {
      throw new xml2js.ValidationError("Referenced element " + element.ref + " not found, xpath: " + xpath + ", known attributes: " + util.inspect(baseElements, false, null));
    }
    if (_.has(element, 'isArrayDefault')) {
      isArrayDefault = element.isArrayDefault;
    }
    element = baseElements[element.ref];
  }
  if (_.has(element, 'isArray')) {
    assert(_.isBoolean(element.isArray), element);
  }
  else if (_.isBoolean(isArrayDefault)) {
    element = _.clone(element);
    element.isArray = isArrayDefault;
  }
  return element;
}

function resolveElementTypeName(xpath, nodeAttributes, element) {
  // TODO: xsi prefix should probably not be hard-coded
  if (nodeAttributes && nodeAttributes['xsi:type']) {
    if (_.isString(nodeAttributes['xsi:type'])) {
      return nodeAttributes['xsi:type'];
    }
    else if (nodeAttributes['xsi:type'].value) {
      return nodeAttributes['xsi:type'].value;
    }
    else {
      throw new xml2js.ValidationError("Invalid attribute xsi:type value, xpath: " + xpath + ": " + util.inspect(nodeAttributes['xsi:type'], false, null));
    }
  }
  return resolveElement(xpath, element).type;
}

function resolveToParse(xpath, typeName) {
  if (!types[typeName]) {
    throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath + ", known types: " + util.inspect(types, false, null));
  }
  else if (types[typeName].parse) {
    return [types[typeName].parse];
  }
  else if (types[typeName].base) {
    if (_.isArray(types[typeName].base)) {
      var res = [];
      _.each(types[typeName].base, function (base) {
        res = res.concat(resolveToParse(xpath, base));
      });
      return res;
    }
    else {
      return resolveToParse(xpath, types[typeName].base);
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

function tryRemoveArrays(xpath, attrkey, charkey, xmlnskey, namespace, type, newValue) {
  var exception = null;
  for (var i = 0; i < type.length; i++) {
    var value = _.clone(newValue);
    try {
      if (type[i].anyChildren) {
        // TODO: Currently we support only one "any" element at the time (it can have multiple entries, but they have to be same "any" tag). Can there be multiple "any" elements defined?
        assert(_.size(value) === 1, value);
        _.each(value, function (child, name) {
          if (name === attrkey || name === charkey || name === xmlnskey) {
            // Attribute, character content, and namespace keys are not part of the schema
            return;
          }
          if (!type[i].isArray) {
            assert(child.length === 1, child);
            value[name] = child[0];
          }
        });
      }
      else if (type[i].children) {
        _.each(value, function (child, name) {
          if (name === attrkey || name === charkey || name === xmlnskey) {
            // Attribute, character content, and namespace keys are not part of the schema
            return;
          }
          var childName = namespacedName(namespace, null, name);
          if (!type[i].children[childName]) {
            throw new xml2js.ValidationError("Element (" + childName + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(type[i].children, false, null));
          }
          else if (!resolveElement(xpath, type[i].children[childName]).isArray) {
            assert(child.length === 1, child);
            value[name] = child[0];
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
    throw new xml2js.ValidationError("Type " + typeName + " not found, xpath: " + xpath + ", known types: " + util.inspect(types, false, null));
  }
  else if (types[typeName].attributes) {
    return types[typeName].attributes;
  }
  else {
    return {};
  }
}

function nodeNamespace(xmlnskey, node) {
  if (!node[xmlnskey].uri) {
    throw new xml2js.ValidationError("Namespace information missing, element: " + util.inspect(node, false, null));
  }
  if (!namespacePrefixes[node[xmlnskey].uri]) {
    throw new xml2js.ValidationError("Unknown namespace " + node[xmlnskey].uri + ", element: " + util.inspect(node, false, null));
  }
  return namespacePrefixes[node[xmlnskey].uri];
}

function createNamespacedPath(xmlnskey, stack, xpath, newValue) {
  var path = [];
  _.each(stack, function (node) {
    var namespace = nodeNamespace(xmlnskey, node);
    path.push(namespacedName(namespace, null, node['#name']));
  });
  // We get the name of the last node from the last element of the xpath
  var splitXpath = xpath.split('/');
  path.push(namespacedName(nodeNamespace(xmlnskey, newValue), null, splitXpath[splitXpath.length - 1]));
  return path;
}

function validator(xpath, currentValue, newValue, stack) {
  var attrkey = this.attrkey;
  var charkey = this.charkey;
  var xmlnskey = this.xmlnskey;

  // TODO: Make configurable
  var outputWithNamespace = false;

  var path = createNamespacedPath(xmlnskey, stack, xpath, newValue);
  // We override given xpath with namespaced xpath
  xpath = '/' + path.join('/');

  var namespace = nodeNamespace(xmlnskey, newValue);

  var currentElementSet = baseElements;

  _.each(path.slice(0, path.length - 1), function (segment, i) {
    if (!currentElementSet[segment]) {
      throw new xml2js.ValidationError("Element (" + segment + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(currentElementSet, false, null));
    }
    else if (!resolveElementTypeName(xpath, stack[i][attrkey], currentElementSet[segment])) {
      throw new xml2js.ValidationError("Element (" + segment + ") does not match schema, type not specified, xpath: " + xpath + ", element: " + util.inspect(currentElementSet[segment], false, null));
    }
    else {
      var type = resolveType(xpath, resolveElementTypeName(xpath, stack[i][attrkey], currentElementSet[segment]));
      currentElementSet = tryChildren(xpath, type);
    }
  });

  var lastSegment = path[path.length - 1];

  // TODO: Do tests with all possible OAI types and XML examples, download them, cache them
  // TODO: Move nested array inside single document outside

  if (!currentElementSet[lastSegment]) {
    throw new xml2js.ValidationError("Element (" + lastSegment + ") does not match schema, xpath: " + xpath + ", allowed elements: " + util.inspect(currentElementSet, false, null));
  }

  var lastSegmentTypeName = resolveElementTypeName(xpath, newValue[attrkey], currentElementSet[lastSegment]);

  if (newValue[attrkey]) {
    var attributes = resolveToAttributes(xpath, lastSegmentTypeName);
    _.each(newValue[attrkey], function (value, attribute) {
      var attributeName = namespacedName(namespace, null, attribute);
      if (attribute.slice(0, 5) === 'xmlns') {
        delete newValue[attrkey][attribute];
      }
      // TODO: xsi prefix should probably not be hard-coded
      else if (attribute.slice(0, 4) === 'xsi:') {
        delete newValue[attrkey][attribute];
      }
      else if (!attributes[attributeName]) {
        throw new xml2js.ValidationError("Unexpected attribute " + attributeName + ", xpath: " + xpath + ", allowed attributes: " + util.inspect(attributes, false, null))
      }
      else {
        var parse = resolveToParse(xpath, resolveAttributeType(xpath,attributes[attributeName]));
        if (_.isString(value)) {
          delete newValue[attrkey][attribute];
          newValue[attrkey][namespacedOrNotName(namespace, attribute, outputWithNamespace)] = tryParse(parse, value);
        }
        else if (value.value) {
          // TODO: What if user wants namespace information, we should not replace with only the value in that case
          delete newValue[attrkey][attribute];
          newValue[attrkey][namespacedOrNotName(namespace, attribute, outputWithNamespace)] = tryParse(parse, value.value);
        }
        else {
          throw new xml2js.ValidationError("Invalid attribute " + attributeName + " value, xpath: " + xpath + ": " + util.inspect(value, false, null))
        }
      }
    });
    if (_.isEmpty(newValue[attrkey])) {
      delete newValue[attrkey];
    }
  }

  // Delete namespace key
  // TODO: What if user wants it? We should make this optional (code below already supports it)
  delete newValue[xmlnskey];

  var parse = resolveToParse(xpath, lastSegmentTypeName);
  if (parse.length !== 0) {
    // If it is string, we can try to parse it
    if (_.isString(newValue)) {
      newValue = tryParse(parse, newValue);
    }
    // If there is object with only character value, we can parse it and replace whole value with it
    else if (_.isEmpty(_.without(_.keys(newValue), charkey)) && newValue[charkey]) {
      newValue = tryParse(parse, newValue[charkey]);
    }
    // It might be an object with some attributes together with character value, then we just parse the value itself
    else if (_.isEmpty(_.without(_.keys(newValue), charkey, attrkey, xmlnskey)) && newValue[charkey]) {
      newValue[charkey] = tryParse(parse, newValue[charkey]);
    }
    // But any additional keys should not be there
    else {
      throw new xml2js.ValidationError("Element (" + lastSegment + ") does not match schema, xpath: " + xpath + ", expected value, got : " + util.inspect(newValue, false, null));
    }
  }
  else {
    var type = resolveType(xpath, lastSegmentTypeName);
    newValue = tryRemoveArrays(xpath, attrkey, charkey, xmlnskey, namespace, type, newValue);
    normalizeNamespaces(attrkey, charkey, xmlnskey, namespace, newValue, outputWithNamespace);
  }

  return newValue;
}

function randomString() {
  return crypto.pseudoRandomBytes(10).toString('hex');
}

function namespacedName(namespace, xsPrefix, name) {
  assert(namespace);
  assert(name);
  var xsPrefixRegex = new RegExp('^' + xsPrefix);
  // XML Schema names are the only one we process without a prefix, so we remove everywhere the prefix
  if (xsPrefix && xsPrefixRegex.test(name)) {
    return name.replace(xsPrefixRegex, '');
  }
  else if (/:/.test(name)) {
    return name;
  }
  else {
    return namespace + ':' + name;
  }
}

function namespacedOrNotName(namespace, name, namespaced) {
  if (namespaced) {
    return namespacedName(namespace, null, name);
  }
  else {
    return name.replace(/^[^:]+:/, '');
  }
}

function normalizeNamespaces(attrkey, charkey, xmlnskey, namespace, value, namespaced) {
  _.each(value, function (val, key) {
    if (key === attrkey || key === charkey || key === xmlnskey) {
      // Ignoring attribute, character content, and namespace keys
      return;
    }
    delete value[key];
    value[namespacedOrNotName(namespace, key, namespaced)] = val;
  });
}

function namespacedTypeName(namespace, xsPrefix, name) {
  assert(namespace);
  assert(name);
  // We do not prefix XML Schema defined types
  if (_.indexOf(XS_TYPES, name) !== -1) {
    return name
  }
  else {
    return namespacedName(namespace, xsPrefix, name);
  }
}

function parseTypesChoice(namespace, xsPrefix, input) {
  assert(input[xsPrefix + 'choice'], input);
  var children = {};
  assert(input[xsPrefix + 'choice'].length === 1, input[xsPrefix + 'choice']);
  var isArrayDefault = null;
  if (input[xsPrefix + 'choice'][0].$) {
    if (input[xsPrefix + 'choice'][0].$.maxOccurs) {
      isArrayDefault = input[xsPrefix + 'choice'][0].$.maxOccurs === 'unbounded' || parseInt(input[xsPrefix + 'choice'][0].$.maxOccurs) > 1;
    }
    delete input[xsPrefix + 'choice'][0].$.minOccurs;
    delete input[xsPrefix + 'choice'][0].$.maxOccurs;
    assert(_.isEmpty(input[xsPrefix + 'choice'][0].$), input[xsPrefix + 'choice'][0].$);
  }
  delete input[xsPrefix + 'choice'][0].$;
  if (input[xsPrefix + 'choice'][0][xsPrefix + 'element']) {
    _.extend(children, parseElements(namespace, xsPrefix, input[xsPrefix + 'choice'][0], isArrayDefault));
  }
  assert(_.isEmpty(input[xsPrefix + 'choice'][0]), input[xsPrefix + 'choice'][0]);
  delete input[xsPrefix + 'choice'];
  return children;
}

function parseTypesSequence(namespace, xsPrefix, input) {
  assert(input[xsPrefix + 'sequence'], input);
  var type = {};
  var children = {};
  assert(input[xsPrefix + 'sequence'].length === 1, input[xsPrefix + 'sequence']);
  var isArrayDefault = null;
  if (input[xsPrefix + 'sequence'][0].$) {
    if (input[xsPrefix + 'sequence'][0].$.maxOccurs) {
      isArrayDefault = input[xsPrefix + 'sequence'][0].$.maxOccurs === 'unbounded' || parseInt(input[xsPrefix + 'sequence'][0].$.maxOccurs) > 1;
    }
    delete input[xsPrefix + 'sequence'][0].$.minOccurs;
    delete input[xsPrefix + 'sequence'][0].$.maxOccurs;
    assert(_.isEmpty(input[xsPrefix + 'sequence'][0].$), input[xsPrefix + 'sequence'][0].$);
  }
  delete input[xsPrefix + 'sequence'][0].$;
  if (input[xsPrefix + 'sequence'][0][xsPrefix + 'element']) {
    _.extend(children, parseElements(namespace, xsPrefix, input[xsPrefix + 'sequence'][0], isArrayDefault));
  }
  if (input[xsPrefix + 'sequence'][0][xsPrefix + 'choice']) {
    _.extend(children, parseTypesChoice(namespace, xsPrefix, input[xsPrefix + 'sequence'][0]));
  }
  if (input[xsPrefix + 'sequence'][0][xsPrefix + 'any']) {
    assert(input[xsPrefix + 'sequence'][0][xsPrefix + 'any'].length === 1, input[xsPrefix + 'sequence'][0][xsPrefix + 'any']);
    type.anyChildren = true;
    var isArray = isArrayDefault;
    if (input[xsPrefix + 'sequence'][0][xsPrefix + 'any'][0].$.maxOccurs) {
      isArray = input[xsPrefix + 'sequence'][0][xsPrefix + 'any'][0].$.maxOccurs === 'unbounded' || parseInt(input[xsPrefix + 'sequence'][0][xsPrefix + 'any'][0].$.maxOccurs) > 1;
    }
    if (_.isBoolean(isArray)) {
      type.isArray = isArray;
    }
  }
  delete input[xsPrefix + 'sequence'][0][xsPrefix + 'any'];
  assert(_.isEmpty(input[xsPrefix + 'sequence'][0]), input[xsPrefix + 'sequence'][0]);
  delete input[xsPrefix + 'sequence'];
  type.children = children;
  return type;
}

function parseSimpleType(namespace, xsPrefix, input) {
  var result = {};
  _.each(input[xsPrefix + 'simpleType'] || [], function (simpleType) {
    var type = {};
    assert(!(simpleType[xsPrefix + 'restriction'] && simpleType[xsPrefix + 'union']), simpleType);
    if (simpleType[xsPrefix + 'restriction']) {
      assert(simpleType[xsPrefix + 'restriction'].length === 1, simpleType[xsPrefix + 'restriction']);
      type.base = namespacedTypeName(namespace, xsPrefix, simpleType[xsPrefix + 'restriction'][0].$.base);
      delete simpleType[xsPrefix + 'restriction'][0].$.base;
      assert(_.isEmpty(simpleType[xsPrefix + 'restriction'][0].$), simpleType[xsPrefix + 'restriction'][0].$);
      delete simpleType[xsPrefix + 'restriction'][0].$;
      // We ignore the rest of the restriction
    }
    delete simpleType[xsPrefix + 'restriction'];
    if (simpleType[xsPrefix + 'union']) {
      assert(simpleType[xsPrefix + 'union'].length === 1, simpleType[xsPrefix + 'union']);
      type.base = _.map(simpleType[xsPrefix + 'union'][0].$.memberTypes.split(/\s+/), function (base) {
        return namespacedTypeName(namespace, xsPrefix, base);
      });
      delete simpleType[xsPrefix + 'union'][0].$.memberTypes;
      assert(_.isEmpty(simpleType[xsPrefix + 'union'][0].$), simpleType[xsPrefix + 'union'][0].$);
      delete simpleType[xsPrefix + 'union'][0].$;
      assert(_.isEmpty(simpleType[xsPrefix + 'union'][0]), simpleType[xsPrefix + 'union'][0]);
    }
    delete simpleType[xsPrefix + 'union'];

    assert(simpleType.$.name, simpleType.$);
    var typeName = namespacedName(namespace, xsPrefix, simpleType.$.name);
    delete simpleType.$.name;
    assert(_.isEmpty(simpleType.$), simpleType.$);
    result[typeName] = type;
  });
  delete input[xsPrefix + 'simpleType'];
  return result;
}

function parseTypes(namespace, xsPrefix, input) {
  var newTypes = {};
  _.each(input[xsPrefix + 'complexType'] || [], function (complexType) {
    var type = {};
    if (complexType[xsPrefix + 'sequence']) {
      _.extend(type, parseTypesSequence(namespace, xsPrefix, complexType));
    }
    if (complexType[xsPrefix + 'choice']) {
      type.children = parseTypesChoice(namespace, xsPrefix, complexType);
    }
    assert(!(complexType[xsPrefix + 'simpleContent'] && complexType[xsPrefix + 'complexContent']), complexType);
    _.each(['simpleContent', 'complexContent'], function (anyContent) {
      if (complexType[xsPrefix + anyContent]) {
        assert(complexType[xsPrefix + anyContent].length === 1, complexType[xsPrefix + anyContent]);
        assert(complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'].length === 1, complexType[xsPrefix + anyContent][0][xsPrefix + 'extension']);
        type.base = namespacedTypeName(namespace, xsPrefix, complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0].$.base);
        delete complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0].$.base;
        assert(_.isEmpty(complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0].$), complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0].$);
        delete complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0].$;
        if (complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0][xsPrefix + 'attribute']) {
          type.attributes = parseAttributes(namespace, xsPrefix, complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0]);
        }
        if (complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0].sequence) {
          _.extend(type, parseTypesSequence(namespace, xsPrefix, complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0]));
        }
        assert(_.isEmpty(complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0]), complexType[xsPrefix + anyContent][0][xsPrefix + 'extension'][0]);
      }
      delete complexType[xsPrefix + anyContent];
    });
    if (complexType[xsPrefix + 'attribute']) {
      type.attributes = parseAttributes(namespace, xsPrefix, complexType);
    }

    assert(complexType.$.name, complexType.$);
    var typeName = namespacedName(namespace, xsPrefix, complexType.$.name);
    delete complexType.$.name;
    assert(_.isEmpty(complexType.$), complexType.$);
    delete complexType.$;
    newTypes[typeName] = type;

    // We ignore annotations
    delete complexType[xsPrefix + 'annotation'];
  });
  delete input[xsPrefix + 'complexType'];

  _.extend(newTypes, parseSimpleType(namespace, xsPrefix, input));

  // We ignore annotations and top-level attributes
  delete input[xsPrefix + 'annotation'];
  delete input.$;

  return newTypes;
}

function parseElements(namespace, xsPrefix, input, isArrayDefault) {
  var newElements = {};
  _.each(input[xsPrefix + 'element'] || [], function (element) {
    if (element.$.ref) {
      var elementReference = namespacedName(namespace, xsPrefix, element.$.ref);
      newElements[elementReference] = {
        ref: elementReference
      };
      if (_.isBoolean(isArrayDefault)) {
        newElements[elementReference].isArrayDefault = isArrayDefault;
      }
    }
    else {
      assert(element.$.name, element.$);
      var elementName = namespacedName(namespace, xsPrefix, element.$.name);
      var isArray = isArrayDefault;
      if (element.$.maxOccurs) {
        isArray = element.$.maxOccurs === 'unbounded' || parseInt(element.$.maxOccurs) > 1;
      }
      if (element.$.type) {
        newElements[elementName] = {
          type: namespacedTypeName(namespace, xsPrefix, element.$.type)
        };
      }
      else {
        assert(element[xsPrefix + 'complexType'] || element[xsPrefix + 'simpleType'], element);
        assert(!(element[xsPrefix + 'complexType'] && element[xsPrefix + 'simpleType']), element);

        // Type is nested inside the element, so we create out own name for it
        var typeName = elementName + '-type-' + randomString();

        // Then we pretend that it is defined with out own name
        _.each(element[xsPrefix + 'complexType'] || [], function (complexType) {
          if (!complexType.$) complexType.$ = {};
          complexType.$.name = typeName;
        });
        _.each(element[xsPrefix + 'simpleType'] || [], function (simpleType) {
          if (!simpleType.$) simpleType.$ = {};
          simpleType.$.name = typeName;
        });

        // Parse it and store it
        var newTypes = parseTypes(namespace, xsPrefix, element);
        _.extend(types, newTypes);

        newElements[elementName] = {
          type: typeName
        };
      }
      if (_.isBoolean(isArray)) {
        newElements[elementName].isArray = isArray;
      }
    }
  });
  delete input[xsPrefix + 'element'];
  return newElements;
}

function parseAttributes(namespace, xsPrefix, input) {
  var newAttributes = {};
  _.each(input[xsPrefix + 'attribute'] || [], function (attribute) {
    if (attribute.$.ref) {
      var attributeReference = namespacedName(namespace, xsPrefix, attribute.$.ref);
      newAttributes[attributeReference] = {
        ref: attributeReference
      };
    }
    else {
      assert(attribute.$.name, attribute.$);
      var attributeName = namespacedName(namespace, xsPrefix, attribute.$.name);
      assert(!newAttributes[attributeName], newAttributes[attributeName]);
      if (attribute.$.type) {
        newAttributes[attributeName] = namespacedTypeName(namespace, xsPrefix, attribute.$.type);
      }
      else if (attribute[xsPrefix + 'simpleType']) {
        // Type is nested inside the attribute, so we create out own name for it
        var typeName = attributeName + '-type-' + randomString();

        _.each(attribute[xsPrefix + 'simpleType'] || [], function (simpleType) {
          if (!simpleType.$) simpleType.$ = {};
          simpleType.$.name = typeName;
        });

        // Parse it and store it
        var newTypes = parseSimpleType(namespace, xsPrefix, attribute);
        _.extend(types, newTypes);

        newAttributes[attributeName] = typeName;
      }
      else {
        // Only simple types are allowed for attributes
        assert(false, attribute);
      }
      delete attribute.$;
      // We ignore annotations
      delete attribute[xsPrefix + 'annotation'];
      assert(_.isEmpty(attribute), attribute);
    }
  });
  delete input[xsPrefix + 'attribute'];
  return newAttributes;
}

function parseImportsAndIncludes(xsPrefix, currentNamespaceUrl, schema) {
  var imports = {};
  _.each(schema[xsPrefix + 'import'] || [], function (schemaImport) {
    addValue(imports, schemaImport.$.namespace, schemaImport.$.schemaLocation);
  });
  delete schema[xsPrefix + 'import'];
  _.each(schema[xsPrefix + 'include'] || [], function (schemaInclude) {
    addValue(imports, currentNamespaceUrl, schemaInclude.$.schemaLocation);
  });
  delete schema[xsPrefix + 'include'];
  return imports;
}

function parseNamespacePrefixes(input, cb) {
  var xsPrefix = '';
  for (var element in input) {
    if (input.hasOwnProperty(element)) {
      var schema = input[element];
      if (schema.$) {
        for (var attr in schema.$) {
          if (schema.$.hasOwnProperty(attr)) {
            if (attr.slice(0, 6) === 'xmlns:') {
              var value = schema.$[attr];
              var namespace = attr.slice(6);
              if (!namespace) {
                cb("Invalid namespace declaration: " + attr + ", for schema: " + util.inspect(schema, false, null));
                return;
              }
              // We process XML Schema namespace specially because we normalize it by removing any prefix
              else if (value === 'http://www.w3.org/2001/XMLSchema') {
                assert(xsPrefix === '', xsPrefix);
                // We add : and call it "prefix" so that we can use it by simple string concatenation
                xsPrefix = namespace + ':';
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
      }
    }
  }
  cb(null, xsPrefix);
}

// Returns imports (and includes) object in a callback. You have assure that
// all those schemas are added as well for all necessary types to be satisfied.
function addSchema(namespaceUrl, schemaContent, cb) {
  if (hasValue(parsedSchemas, namespaceUrl, schemaContent)) {
    cb(null, {});
    return;
  }

  xml2js.parseString(schemaContent, function (err, result) {
    if (err) {
      cb(err);
      return;
    }

    // Only one root element expected
    if (!result || _.size(result) !== 1) {
      cb("Invalid schema for " + namespaceUrl + ": " + util.inspect(result, false, null));
      return;
    }

    parseNamespacePrefixes(result, function (err, xsPrefix) {
      if (err) {
        cb(err);
        return;
      }

      assert(result[xsPrefix + 'schema'], result);

      var schema = result[xsPrefix + 'schema'];

      if (!schema.$ || schema.$.targetNamespace !== namespaceUrl) {
        cb("Invalid schema for " + namespaceUrl + ": " + util.inspect(result, false, null));
        return;
      }

      var namespace = namespacePrefixes[namespaceUrl];
      if (!namespace) {
        cb("Could not determine namespace for schema " + namespaceUrl + ", known namespace prefixes: " + util.inspect(namespacePrefixes, false, null));
        return;
      }

      var importsAndIncludes = parseImportsAndIncludes(xsPrefix, namespaceUrl, schema);

      var newElements = parseElements(namespace, xsPrefix, schema, null);
      // TODO: Check if we are overriding anything
      _.extend(baseElements, newElements);

      var newAttributes = parseAttributes(namespace, xsPrefix, schema);
      // TODO: Check if we are overriding anything
      _.extend(baseAttributes, newAttributes);

      var newTypes = parseTypes(namespace, xsPrefix, schema);
      // TODO: Check if we are overriding anything
      _.extend(types, newTypes);

      // TODO: Add support for element and attribute groups
      delete schema[xsPrefix + 'group'];
      delete schema[xsPrefix + 'attributeGroup'];

      // Previous parsing calls are destructive and should consume schema so that it is empty now
      assert(_.isEmpty(schema), schema);

      addValue(parsedSchemas, namespaceUrl, schemaContent);

      cb(null, importsAndIncludes);
    });
  });
}

// Returns imports (and includes) object in a callback. You have assure that
// all those schemas are added as well for all necessary types to be satisfied.
function downloadAndAddSchema(namespaceUrl, schemaUrl, cb) {
  if (hasValue(downloadedSchemas, namespaceUrl, schemaUrl)) {
    cb(null, {});
    return;
  }

  request(schemaUrl, function (err, response, body) {
    if (err) {
      cb("Error downloading " + namespaceUrl + " schema (" + schemaUrl + "): " + err);
      return;
    }
    else if (response.statusCode !== 200) {
      cb("Error downloading " + namespaceUrl + " schema (" + schemaUrl + "): HTTP status code " + response.statusCode);
      return;
    }

    addSchema(namespaceUrl, body, function (err, importsAndIncludes) {
      if (err) {
        cb(err);
        return;
      }

      addValue(downloadedSchemas, namespaceUrl, schemaUrl);

      cb(null, importsAndIncludes);
    });
  });
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
      // TODO: xsi prefix should probably not be hard-coded
      if (o['xsi:schemaLocation']) {
        var schemaLocation = o['xsi:schemaLocation'].split(/\s+/);
        assert(schemaLocation.length === 2, schemaLocation);
        addValue(foundSchemas, schemaLocation[0], schemaLocation[1]);
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
      // We do a breadth-first traversal of schemas to prevent possible infinite loops
      async.until(function () {
        return _.isEmpty(foundSchemas);
      }, function (cb) {
        var schemas = foundSchemas;
        foundSchemas = {};
        async.each(_.keys(schemas), function (namespaceUrl, cb) {
          async.each(schemas[namespaceUrl], function (schemaUrl, cb) {
            downloadAndAddSchema(namespaceUrl, schemaUrl, function (err, importsAndIncludes) {
              if (err) {
                cb(err);
                return;
              }

              _.each(importsAndIncludes, function (nextSchemaUrls, nextNamespaceUrl) {
                _.each(nextSchemaUrls, function (nextSchemaUrl) {
                  if (!hasValue(downloadedSchemas, nextNamespaceUrl, nextSchemaUrl)) {
                    addValue(foundSchemas, nextNamespaceUrl, nextSchemaUrl);
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
          if (!parsedSchemas[namespaceUrl]) {
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
    options.xmlns = true;
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
