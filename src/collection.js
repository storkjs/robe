"use strict";


var _ = require('lodash'),
  compose = require('generator-compose'),
  Class = require('class-extend'),
  Q = require('bluebird'),
  schemaBuilder = require('simple-mongo-schema');


var Cursor = require('./cursor'),
  Document = require('./document'),
  RobeUtils = require('./utils');





/**
 * Represents a collection in the database.
 */
class Collection {
  /**
   * Constructor.
   *
   * @param  {Object} collection The underlying collection.
   * @param  {Object} [options] Additional options.
   * @param  {Object} [options.schema] Database schema.
   * @param  {Array} [options.indexes] Database indexex to setup.
   * @param  {Boolean} [options.raw] Whether to enable raw query mode by default. Default if false.
   * @param  {Object} [options.methods] Convenience methods to make available on this collection instance. Each method is specified as a `name`:`function *` pair.
   * @param  {Object} [options.docMethods] Convenience methods to make available on this collection's `Document` instances. Each method is specified as a `name`:`function *` pair.
   */
  constructor (collection, options = {}) {
    this.options = _.defaults(options, {
      schema: {},
      raw: false,
      docMethods: {},
    });

    this.schema = schemaBuilder(options.schema);
    this.indexes = options.indexes || [];

    this.collection = collection;

    Object.defineProperty(this, '_hooks', {
      value: {
        before: {
          insert: [],
          update: [],
          remove: [],
        },
        after: {
          insert: [],
          update: [],
          remove: [],
        }
      },
      enumerable: false
    });

    // methods
    for (let name in options.methods || {}) {
      this[name] = RobeUtils.bindGen(options.methods[name], this);
    }
  }


  /**
   * Ensure all configured indexes exist in the database.
   *
   * This looks through the indexes supplied during construction and sets them 
   * up.
   */
  * ensureIndexes () {
    var self = this;

    yield Q.map(this.indexes, function(idx) {
      return self.collection.ensureIndex(idx.fields, idx.options || {});
    });
  }


  /**
   * Execute given handler before given event
   *
   * @param {String} eventName Name of event. One of `insert`, `remove`, `update`
   * @param {Function} genFn Generator function which takes a callback as a parameter.
   */
  before (eventName, genFn) {
    this._hooks.before[eventName].push(genFn);
  }

  /**
   * Execute given handler after given event
   *
   * @param {String} eventName Name of event. One of `insert`, `remove`, `update`
   * @param {Function} genFn Generator function which takes a callback as a parameter.
   */
  after (eventName, genFn) {
    this._hooks.after[eventName].push(genFn);
  }



  /**
   * Execute given hook
   * @param  {String} when Hook type.
   * @param  {String} eventName Hook event.
   * @param  {Array} [args] Parameters to pass to hook.
   *
   * @private
   */
  * _runHook (when, eventName, ...args) {
    var fn = compose(this._hooks[when][eventName]);

    yield fn.apply(this, args);
  }


  /**
   * Insert a document.
   * 
   * @param  {Object} attrs The document attributes.
   * @param {Object} [options] Additional options.
   * @param {Boolean} [options.raw] Whether to return the resulting raw document as-is. Overrides the default for the collection.
   * @return {Document} the newly inserted document.
   */
  * insert (attrs, options) {
    yield this._runHook('before', 'insert', attrs);

    // validate against schema
    yield this.schema.validate(attrs);

    var res = yield this.collection.insert(attrs);

    yield this._runHook('after', 'insert', res);

    return RobeUtils.formatMongoDoc(this, res, options);
  }


  /**
   * Update documents.
   * 
   * @param {Object} [search] Filtering query.
   * @param  {Object} update The update to make.
   */
  * update (search = {}, update) {
    yield this._runHook('before', 'update', search, update);

    // validate against schema
    if (update.$set) {
      yield this.schema.validate(update.$set, {
        ignoreMissing: true
      });
    }

    var ret = yield this.collection.update(search, update);

    yield this._runHook('after', 'update', search, update, ret);

    return ret;
  }


  /**
   * Remove documents.
   * 
   * @param {Object} [search] Filtering query.
   */
  * remove (search) {
    yield this._runHook('before', 'remove', search);

    var ret = yield this.collection.remove(search);

    yield this._runHook('after', 'remove', search, ret);

    return ret;
  }


  /**
   * Find documents from this collection.
   *
   * @param {Object} [selector] Filtering query.
   * @param {Object} [options] Query options.
   * @param {Object} [options.sort] Sort filter (Mongo syntax).
   * @param {Number} [options.skip] Number of records to skip at the beginning.
   * @param {Number} [options.limit] Max. no of records to return.
   * @param {Object} [options.fields] Fields to return or exclude (Mongo syntax).
   * @param {Boolean} [options.raw] Whether to return the resulting raw document as-is. Overrides the default for the collection.
   *
   * @return {Array} Results
   */
  * find (selector = {}, options = {}) {
    var self = this;

    var res = yield this.collection.find(selector, _.extend({}, options));

    return res.map( v => RobeUtils.formatMongoDoc(self, v, options) );
  }



  /**
   * Find a single document from this collection.
   *
   * @param {String|Object} selector ObjectId or filtering query.
   * @param {Object} [options] Query options.
   * @param {Object} [options.sort] Sort filter (Mongo syntax).
   * @param {Number} [options.skip] Number of records to skip at the beginning.
   * @param {Object} [options.fields] Fields to return or exclude (Mongo syntax).
   */
  * findOne (selector, options = {}) {
    var self = this;

    options.limit = 1;

    var results = yield this.collection.find(selector, options);

    return results.length ? RobeUtils.formatMongoDoc(self, results.pop(), options) : null;
  }




  /**
   * Stream documents from this collection.
   *
   * @param {Object} [selector] Filtering query.
   * @param {Object} [options] Query options.
   * @param {Object} [options.sort] Sort filter (Mongo syntax).
   * @param {Number} [options.skip] Number of records to skip at the beginning.
   * @param {Number} [options.limit] Max. no of records to return.
   * @param {Object} [options.fields] Fields to return or exclude (Mongo syntax).
   * @param {Boolean} [options.raw] Whether to return the resulting raw document as-is. Overrides the default for the collection.
   *
   * @return {Cursor} cursor object
   */
  * findStream (selector = {}, options = {}) {
    _.extend(options, {
      stream: true
    });

    return new Cursor(
      this.collection,
      this.collection.find(selector, options),
      options
    );
  }
}


Collection.extend = Class.extend;

module.exports = Collection;

