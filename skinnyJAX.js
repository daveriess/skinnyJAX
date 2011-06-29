/* 
 * SkinnyJAX - an XHR wrapper with failover
 * By Dave Riess http://daveriess.me
 * MIT Licensed
 */

(function() { 
	skinnyJAX = function(args) {
		// resource sleep is the length of time (ms) a resource is inactive after a failover
		this.default_timeout = 1500, this.default_retry_max = 2, this.live_resource = null, this.resource_pool = null, this.resource_sleep = 15000, this.headers = null;

		// skinnyJAX initialization
		this.init = function(args) {
			// ensure hosts are present
			if (!(args.resources instanceof Array)) return false;
	
			// initialize resource pool
			this.resource_pool = [];
			for (var i = 0; i < args.resources.length; i++) {
				this.resource_pool.push( { name: args.resources[i], live: true } );	
			}
	
			// init a resource from pool
			this.promote_resource();

			// copy in any headers
			if (args.headers instanceof Object) this.headers = args.headers;
		}

		// request function
		this.req = function(args) {
			var self = this;
			// exit if no live resource is available
			if (this.live_resource == null) return false;

			// instantiate skinnyREQ object
			var xhr = new skinnyREQ(args.attempt);
			xhr.open(args.method, this.buildURI(args.endpoint, args.params));
		
			// wire up callbacks
			xhr.success = function(response) { args.success(response); }
			xhr.time_out = function(response) { args.time_out(response); }
			xhr.error = function(response) { self.error(response, args); }														// run error callback through failover mechanism

			// set http headers
			for (var header in this.headers) {
				xhr.setRequestHeader(header, this.headers[header]);
			}
		
			// set up request timeout
			if (args.timeout) {
				xhr.setTimeout(isNaN(args.timeout) ? this.default_timeout : args.timeout);
			}
		
			// send request
			xhr.send();
		}

		// build uri (live resource + endpoint + params)
		this.buildURI = function(endpoint, params) {
			var p = [];
			for (var param in params) {
				p.push( encodeURI(param+'='+params[param]) )
			}
			return this.live_resource+endpoint+'?'+p.join('&');
		}

		// select a new resource from pool (called during init and after a failure)
		this.promote_resource = function() {
			var rs_pool = [];
			for (var n=0; n<this.resource_pool.length; n++) {
				// disable current resource (this fn is called on failover)
				if (this.resource_pool[n].name == this.live_resource) this.disable_resource(n);
				// collect live resources into an array
				else if (this.resource_pool[n].live == true) rs_pool.push(this.resource_pool[n].name);
			}
			// select a new 'live' resource at random
			return this.live_resource = rs_pool.length > 0 ? rs_pool[Math.floor(Math.random()*rs_pool.length)] : null;
		}
	
		// enable resource after resource_sleep has expired (hopefully we've already found a new resource that is responding)
		this.enable_resource = function(index) {
			this.resource_pool[index].live = true;
			if (this.live_resource == null) this.promote_resource();
		}
	
		// disable resource after a failure (resource will be inactive for [resource_sleep] milliseconds)
		this.disable_resource = function(index) {
			var self = this;
			this.resource_pool[index].live = false;
			setTimeout(function() { self.enable_resource(index) }, self.resource_sleep);
		}

		// error callback
		this.error = function(response, args) {
			// if retries is defined, engage failover/retry mechanism
			if (args.retries) {
				// if retry count has not been exceeded, try again - otherwise pass to failover
				var retry_max = isNaN(args.retries) ? this.default_retry_max : args.retries;
				response.attempt >= retry_max ? this.failover(response, args) : this.retry(response.attempt+1, args);
			}
			// if retries is not defined pass to appropriate callback
			else {
				if (typeof(args.time_out) == 'function' && response.timed_out == true) args.time_out(response);
				else if (typeof(args.error) == 'function') args.error(response);
			}
		}
	
		// retry request
		this.retry = function(attempt, args) {
			console.info('resource unavailable - retrying: '+this.live_resource+' - '+attempt)
			args.attempt = attempt;
			this.req(args);
		}
	
		// failover to new resoruce
		this.failover = function(response, args) {
			// promote resource and retry
			if (this.promote_resource() != null) this.retry(1, args);
			// if there are no resources to promote, pass to appropriate callback
			else {
				if (typeof(args.time_out) == 'function' && response.timed_out == true) args.time_out(response);
				else if (typeof(args.error) == 'function') args.error(response);
			}
		}
		
		this.init(args);
	}

	// skinnyREQ is an XHR wrapper that stores some extra request info
	skinnyREQ = function(args) {
		this.xhr = null, this.time_out_id = null, this.attempt = null, this.success = null, this.time_out = null, this.error = null, this.response = null;
	
		// initialize new skinnyREQ
		this.init = function(attempt) {
			var self = this;
			
			this.xhr = new XMLHttpRequest();

			// the response object will ultimately contain these key value pairs: uri, method, time, http_code, timed_out, data
			// it is what gets passed up to the callbacks you define in your skinnyJAX.req
			this.response = {};
			this.response.data = null;
			this.response.attempt = typeof(attempt) === 'number' ? attempt : 1;
			this.response.timed_out = false;
	
			this.xhr.onreadystatechange = function() {
				if (this.readyState == 1) {
					self.response.time = (new Date()).getTime();
				}
				else if (this.readyState == 4) {
					if (self.response.timed_out == false) clearTimeout(self.time_out_id);
					self.response.time = (new Date()).getTime() - self.response.time;
					self.response.http_code = this.status;
				}
	
				// this only considers 200's successful!
				if (this.readyState == 4 && this.status == 200 ) {
					self.response.data = JSON.parse(this.responseText);
					if (typeof(self.success) == 'function') self.success(self.response);
				}
				else if (this.readyState == 4) {
					if (typeof(self.error) == 'function') self.error(self.response);
				}
			}
		}
		
		this.open = function(method, uri) {
			this.response.uri = uri;
			this.response.method = method;
			this.xhr.open(method, uri, true);
		}
		
		this.setRequestHeader = function(key, val) {
			this.xhr.setRequestHeader(key, val);
		}
		
		this.send = function() {
			this.xhr.send();
		}
		
		this.setTimeout = function(delay) {
			var self = this;
			this.response.timed_out = false;
			this.time_out_id = setTimeout( function() {
				if (self.xhr.readyState < 4) {
					self.response.timed_out = true;
					self.xhr.abort();
				}
			}, delay);
		}
		
		this.init(args);
	}
})();
