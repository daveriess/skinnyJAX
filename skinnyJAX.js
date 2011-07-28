/* 
 * skinnyJAX - an XHR wrapper with failover
 * By Dave Riess http://daveriess.me
 * MIT Licensed
 */
(function() { 
	skinnyJAX = function(args) {
		// skinnyJAX initialization
		this.init = function(args) {
			// format host(s) + sanity check
			if (typeof(args) === 'string') args = {hosts: [args]};
			else if (typeof(args) === 'object' && typeof(args.host) === 'string') args.hosts = [args.host];
			if (!args.hosts.length) return false;
	
			// init host pool
			this.host_pool = [];
			for (var i = 0; i < args.hosts.length; i++) {
				this.host_pool.push( { name: args.hosts[i], live: true } );	
			}
	
			// init a host from pool
			this.promote_host();
			
			// copy in other configs or set defaults
			if (typeof(args) === 'object') {
				this.headers = typeof(args.headers) === 'object' ? args.headers : {};
				this.host_sleep = typeof(args.host_sleep) === 'number' ? args.host_sleep : 15000;
				this.default_timeout = typeof(args.default_timeout) === 'number' ? args.default_timeout : 1500;
				this.default_retry_max = typeof(args.default_retry_max) === 'number' ? args.default_retry_max : 2;
				this.default_params = typeof(args.default_params) === 'object' ? args.default_params : {};
			}
		}

		// request function
		this.req = function(args) {
			var self = this;
			// exit if no live host is available
			if (this.live_host == null) return false;

			// instantiate skinnyREQ object
			var xhr = new skinnyREQ(args.attempt);
			xhr.open(args.method || 'get', this.buildURI(args.endpoint, args.params));
		
			// wire up callbacks
			xhr.success = function(response) { args.success(response); }
			xhr.time_out = function(response) { args.time_out(response); }														// time_out callback has underscore
			xhr.error = function(response) { self.error(response, args); }														// run error callback through failover mechanism

			// set http headers
			for (var header in this.headers) {
				xhr.setRequestHeader(header, this.headers[header]);
			}
		
			// set up request timeout
			if (args.timeout != false) {
				xhr.setTimeout(typeof(args.timeout) === 'number' ?  args.timeout : this.default_timeout);
			}
		
			// send request
			xhr.send();
		}

		// build uri (live host + endpoint + params)
		this.buildURI = function(endpoint, params) {
			var p = [];
			for (var param in params) { p.push( param+'='+encodeURIComponent(params[param]) ) }
			for (var dparam in this.default_params) { p.push( dparam+'='+encodeURIComponent(this.default_params[dparam]) ) }
			return this.live_host+endpoint+'?'+p.join('&');
		}

		// select a new host from pool (called during init and after a failure)
		this.promote_host = function() {
			var rs_pool = [];
			for (var n=0; n<this.host_pool.length; n++) {
				// disable current host (this fn is called on failover)
				if (this.host_pool[n].name == this.live_host) this.disable_host(n);
				// collect live hosts into an array
				else if (this.host_pool[n].live == true) rs_pool.push(this.host_pool[n].name);
			}
			// select a new 'live' host at random
			return this.live_host = rs_pool.length > 0 ? rs_pool[Math.floor(Math.random()*rs_pool.length)] : null;
		}
	
		// enable host after host_sleep has expired (hopefully we've already found a new host that is responding)
		this.enable_host = function(index) {
			this.host_pool[index].live = true;
			if (this.live_host == null) this.promote_host();
		}
	
		// disable host after a failure (host will be inactive for [host_sleep] milliseconds)
		this.disable_host = function(index) {
			var self = this;
			this.host_pool[index].live = false;
			setTimeout(function() { self.enable_host(index) }, self.host_sleep);
		}

		// error callback
		this.error = function(response, args) {
			// if retries is defined, engage failover/retry mechanism
			if (args.retries) {
				// if retry count has not been exceeded, try again - otherwise pass to failover
				var retry_max = typeof(args.retries) === 'number' ? args.retries : this.default_retry_max;
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
			args.attempt = attempt;
			this.req(args);
		}
	
		// failover to new resoruce
		this.failover = function(response, args) {
			// promote host and retry
			if (this.promote_host() != null) this.retry(1, args);
			// if there are no hosts to promote, pass to appropriate callback
			else {
				if (typeof(args.time_out) == 'function' && response.timed_out == true) args.time_out(response);
				else if (typeof(args.error) == 'function') args.error(response);
			}
		}
		
		this.init(args);
	}

	// skinnyREQ is an XHR wrapper that stores some extra request info
	skinnyREQ = function(args) {
		// these callbacks are set externally
		this.success = null, this.time_out = null, this.error = null;
	
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
					if (self.response.timed_out == false) clearTimeout(self.timeout_id);
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
			this.timeout_id = setTimeout( function() {
				if (self.xhr.readyState < 4) {
					self.response.timed_out = true;
					self.xhr.abort();
				}
			}, delay);
		}
		
		this.init(args);
	}
})();
