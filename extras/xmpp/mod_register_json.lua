-- Expose a simple token based servlet to handle user registrations from web pages
-- through Base64 encoded JSON.

-- Updated for use with matrix-appservice-purple by removing some restrictions
-- from the plugin like verifying an email address.

-- Copyright (C) 2010 - 2013, Marco Cirillo (LW.Org)
-- Copyright (C) 2018, New Vector Ltd

local datamanager = require "util.datamanager";
local usermanager = require "core.usermanager";
local http = require "net.http";
local b64_decode = require "util.encodings".base64.decode
local b64_encode = require "util.encodings".base64.encode
local http_event = require "net.http.server".fire_event
local jid_prep = require "util.jid".prep
local jid_split = require "util.jid".split
local json_decode = require "util.json".decode
local nodeprep = require "util.encodings".stringprep.nodeprep
local open, os_time, setmt, type = io.open, os.time, setmetatable, type
local sha1 = require "util.hashes".sha1
local urldecode = http.urldecode
local uuid_gen = require "util.uuid".generate
local timer = require "util.timer"

module:depends"http";

-- Pick up configuration and setup stores/variables.

local auth_token = module:get_option_string("reg_servlet_auth_token")
local secure = module:get_option_boolean("reg_servlet_secure", true)
local base_path = module:get_option_string("reg_servlet_base", "/register_account/")
local throttle_time = module:get_option_number("reg_servlet_ttime", nil)
local whitelist = module:get_option_set("reg_servlet_wl", {})
local blacklist = module:get_option_set("reg_servlet_bl", {})
local fm_patterns = module:get_option("reg_servlet_filtered_mails", {})
if type(fm_patterns) ~= "table" then fm_patterns = {} end

local files_base = module.path:gsub("/[^/]+$","") .. "/template/"

local recent_ips = {}
local pending = {}
local pending_node = {}

-- Setup hashes data structure

hashes = { _index = {} }
local hashes_mt = {} ; hashes_mt.__index = hashes_mt
function hashes_mt:add(node, mail)
	local _hash = b64_encode(sha1(mail))
	if not self:exists(_hash) then
		self[_hash] = node ; self._index[node] = _hash ; self:save()
		return true
	else
		return false
	end
end
function hashes_mt:exists(hash)
	if hashes[hash] then return true else return false end
end
function hashes_mt:remove(node)
	local _hash = self._index[node]
	if _hash then
		self[_hash] = nil ; self._index[node] = nil ; self:save()
	end
end
function hashes_mt:save()
	if not datamanager.store("register_json", module.host, "hashes", hashes) then
		module:log("error", "Failed to save the mail addresses' hashes store.")
	end
end

local function check_mail(address)
	for _, pattern in ipairs(fm_patterns) do
		if address:match(pattern) then return false end
	end
	return true
end

-- Begin

local function handle(code, message) return http_event("http-error", { code = code, message = message }) end
local function http_response(event, code, message, headers)
	local response = event.response

	if headers then
		for header, data in pairs(headers) do response.headers[header] = data end
	end

	response.status_code = code
	response:send(handle(code, message))
end

local function handle_req(event)
	module:log("info", "Got Request")
	local request = event.request
	if secure and not request.secure then return nil end

	if request.method ~= "POST" then
		return http_response(event, 405, "Bad method.", {["Allow"] = "POST"})
	end

	local req_body
	-- We check that what we have is valid JSON wise else we throw an error...
	if not pcall(function() req_body = json_decode(request.body) end) or req_body == nil then
		module:log("debug", "Data submitted for user registration by %s failed to Decode.", user)
		return http_response(event, 400, "Decoding failed.")
	else
		-- Decode JSON data and check that all bits are there else throw an error
		if req_body["username"] == nil or req_body["password"] == nil or req_body["ip"] == nil or
		   req_body["auth_token"] == nil then
			module:log("debug", "%s supplied an insufficent number of elements or wrong elements for the JSON registration", user)
			return http_response(event, 400, "Invalid syntax.")
		end
		-- Set up variables
		local username, password, ip, mail, token = req_body.username, req_body.password, req_body.ip, req_body.mail, req_body.auth_token
		local nick = req_body.nick
		-- Check if user is an admin of said host
		if token ~= auth_token then
			module:log("warn", "%s tried to retrieve a registration token for %s@%s", request.ip, username, module.host)
			return http_response(event, 401, "Auth token is invalid! The attempt has been logged.")
		else
			-- Blacklist can be checked here.
			if blacklist:contains(ip) then
				module:log("warn", "Attempt of reg. submission to the JSON servlet from blacklisted address: %s", ip)
				return http_response(event, 403, "The specified address is blacklisted, sorry.")
			end

			--if not check_mail(mail) then
			--	module:log("warn", "%s attempted to use a mail address (%s) matching one of the forbidden patterns.", ip, mail)
			--	return http_response(event, 403, "Requesting to register using this E-Mail address is forbidden, sorry.")
			--end

			-- We first check if the supplied username for registration is already there.
			-- And nodeprep the username
			username = nodeprep(username)
			if not username then
				module:log("debug", "An username containing invalid characters was supplied: %s", req_body["username"])
				return http_response(event, 406, "Supplied username contains invalid characters, see RFC 6122.")
			else
				if pending_node[username] then
					module:log("warn", "%s attempted to submit a registration request but another request for that user (%s) is pending", ip, username)
					return http_response(event, 401, "Another user registration by that username is pending.")
				end

				if not usermanager.user_exists(username, module.host) then
					-- if username fails to register successive requests shouldn't be throttled until one is successful.
					if throttle_time and not whitelist:contains(ip) then
						if not recent_ips[ip] then
							recent_ips[ip] = os_time()
						else
							if os_time() - recent_ips[ip] < throttle_time then
								recent_ips[ip] = os_time()
								module:log("warn", "JSON Registration request from %s has been throttled.", req_body["ip"])
								return http_response(event, 503, "Request throttled, wait a bit and try again.")
							end
							recent_ips[ip] = os_time()
						end
					end

					--local uuid = uuid_gen()
					--if not hashes:add(username, mail) then
					--	module:log("warn", "%s (%s) attempted to register to the server with an E-Mail address we already possess the hash of.", username, ip)
					--	return http_response(event, 409, "The E-Mail Address provided matches the hash associated to an existing account.")
					--end
					--pending[uuid] = { node = username, password = password, ip = ip }
					--pending_node[username] = uuid

					--timer.add_task(300, function()
					--	if pending[uuid] then
					--		pending[uuid] = nil
					--		pending_node[username] = nil
					--		hashes:remove(username)
					--	end
					--end)
					module:log("info", "%s submitted a registration request", username)
					local ok, error = usermanager.create_user(username, password, module.host)
					if ok then
						jid = username.."@"..module.host
						if nick ~= nil then
							local extra_data = {}
							extra_data["nick"] = nick
							datamanager.store(prepped_username, module.host, "account_details", extra_data)
						end
						module:fire_event(
							"user-registered",
							{ username = username, host = module.host, source = "mod_register_json", session = { ip = ip } }
						)
						module:log("info", "Account %s@%s is successfully verified and activated", username, module.host)
						return jid
					else
						module:log("error", "User creation failed: "..error)
						return http_response(event, 500, "Encountered server error while creating the user: "..error)
					end
				else
					module:log("debug", "%s registration data submission failed (user already exists)", username)
					return http_response(event, 409, "User already exists.")
				end
			end
		end
	end
end

local function open_file(file)
	local f, err = open(file, "rb");
	if not f then return nil end

	local data = f:read("*a") ; f:close()
	return data
end

local function r_template(event, type)
	local data = open_file(files_base..type.."_t.html")
	if data then
		data = data:gsub("%%REG%-URL", base_path.."verify/")
		return data
	else return http_response(event, 500, "Failed to obtain template.") end
end


local function handle_user_deletion(event)
	local user, hostname = event.username, event.host
	if hostname == module.host then hashes:remove(user) end
end

-- Set it up!

hashes = datamanager.load("register_json", module.host, "hashes") or hashes ; setmt(hashes, hashes_mt)

module:provides("http", {
	default_path = base_path,
        route = {
				GET = handle_req,
                ["GET /"] = handle_req,
				POST = handle_req,
				["POST /"] = handle_req
        }
})

module:hook_global("user-deleted", handle_user_deletion, 10);

-- Reloadability

module.save = function() return { hashes = hashes } end
module.restore = function(data) hashes = data.hashes or { _index = {} } ; setmt(hashes, hashes_mt) end
