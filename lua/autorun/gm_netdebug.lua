
local config = {

	-- Address to bind, default: localhost
	address = "localhost",
	-- Port to bind, default: 27100
	port = 27100,
	
	-- Secret key shared between this host and authorized client(s).
	-- It is strongly advised to change this value to avoid potential attacks.
	key = "CHANGEME"
	
	-- NOTE: Confidentiality is not (yet) supported, the code and debugging information
	-- travels in plain text over the network. Keep this in mind if the clients
	-- connect from the internet.
	
	}
	
	local a, b = pcall( require, "blocksocket" )
	ErrorNoHalt(b)
	if not a then return end
	
	module("netdebug", package.seeall)
	
	local sv = blocksocket()
	SV=sv
	sv:Bind( config.address, config.port )
	local sState = sv:GetState()
	local bDebugging = false
	local bAuthed = false
	local sNonce
	timer.Create( "NetDebug", 1, 0, function()
		if bDebugging then return end
		if sState == "Bound" then
			if sv:TryAccept() then
				bAuthed = false
				sState = sv:GetState()
				print("Accepted a socket")
			end
		elseif sState == "Connected" then
			local str = sv:TryReadString()
			if str then
				local dt = util.JSONToTable( str )
				if dt and dt.type then
					if bAuthed then
						onmessage(dt)
					else
						if dt.type == "AuthReq" then
							sNonce = string.format( "%08X%08X", math.random( 0, 4294967296 ), math.random( 0, 4294967296 ) )
							sv:WriteString( util.TableToJSON{
								type = "AuthRsp",
								info = sNonce
							} )
							print("Sent nonce")
						elseif dt.type == "AuthRsp" then
							if sv:CheckAuth( config.key, sNonce, dt.info:upper() ) then
								bAuthed = true
								print("Debugger authed")
							else
								sv:Drop()
								print("Debugger refused")
							end
						end
					end
				else
					sv:Drop()
					stopdebug()
				end
			end
			sState = sv:GetState()
		end
	end )
	
	-- Utility function to iterate over locals/upvalues
	local lpairs = function( fFunc, fFetcher )
		local i = 0
		return function()
			i = i + 1
			return fFetcher( fFunc, i ) 
		end
	end
	
	local tLines = {}
	
	updatebreakpoints = function( tBreakpoints )
		tLines = {}
		for i, tBreakpoint in ipairs( tBreakpoints ) do
			-- I know this may seem backwards but it allows for better performance while debugging.
			tLines[tBreakpoint.line] = tLines[tBreakpoint.line] or {}
			tLines[tBreakpoint.line][tBreakpoint.src] = true
		end
	end
	
	local bCanSkip = true
	local sStep, iStackStep = "continue", 0
	local tStepOver
	local tStack
	local iStack = -1
	
	startdebug = function( tDebug )
		updatebreakpoints( tDebug.breakpoints )
		debug.sethook( function( sType, iLine )
			local sSrc
			if bCanSkip then
				if sType ~= "line" then return end
				local tFiles = tLines[iLine]
				if not tFiles then return end
				sSrc = debug.getinfo( 2, "S" ).short_src
				if not tFiles[sSrc] then return end
			else
				sSrc = debug.getinfo( 2, "S" ).short_src
			end
			
			if bCanSkip then -- We've just hit a breakpoint (or we were paused by the debugger), construct the call stack
				tStack = {}
				local tInfo = debug.getinfo( 2 )
				local i = 2
				local tPtr = tStack
				while tInfo do
					tPtr.src = tInfo.short_src
					tPtr.line = tInfo.currentline
					tPtr.info = tInfo
					tPtr.previous = { src = "TOP", line = -1, previous = {} }
					tPtr = tPtr.previous
					i = i + 1
					tInfo = debug.getinfo( i )
				end
				iStack = i - 2
				bCanSkip = false
				bDebugging = true
				sStep = "in"
			end
	
			local bShouldBreak = false
	
			if sType == "line" then
				-- DONE: Break if this is a breakpoint
				-- DONE: Break if we're just stepping
				if sStep == "in" or iStack <= iStackStep then
					bShouldBreak = true
				end
				tStack.src = sSrc
				tStack.line = iLine
			elseif sType == "call" then
				-- DONE: Detect tail-calls and modify the stack info accordingly
				-- DONE: Update stack
				-- DONE: Break if we're stepping in
				local tParentInfo = debug.getinfo( 3, "lS" ) or { short_src = "TOP", currentline = -1 }
				if tParentInfo.short_src ~= tStack.src or tParentInfo.currentline ~= tStack.line then
					if sStep == "over" and not tStepOver then
						tStepOver = tStack
					end
					tStack = tStack.previous -- Tail-call, pop parent
					iStack = iStack - 1
				end
				if sSrc ~= "[C]" then -- Don't bother adding C calls to the stack, return is never called.
					local tInfo = debug.getinfo( 2 )
					iLine = tInfo.currentline
					tStack = {
						src = sSrc,
						line = iLine,
						info = tInfo,
						previous = tStack
					}
					iStack = iStack + 1
					if sStep == "in" then
						bShouldBreak = true
					end
				end
			elseif sType == "return" then
				-- DONE: Update stack
				-- DONE: Set breaktype to in if iStack is back
				tStack = tStack.previous
				iStack = iStack - 1
				if sStep == "over" and iStack < iStackStep then
					local tInfo = debug.getinfo( 2 )
					iLine = tInfo.currentline
					bShouldBreak = true
					if tStepOver then
						-- TODO: use tStepOver for visuals
						tStepOver = nil
					end
				end
				if iStack == 0 then
					bCanSkip = true -- Returned from the last function, no point in continuing after this.
					bShouldBreak = false
				end
			end
	
			if bShouldBreak then
				sStep = dobreak( tStack )
				iStackStep = iStack
				if sStep == "out" then
					sStep = "over"
					iStackStep = iStack - 1
				elseif sStep == "continue" then
					bCanSkip = true
				end
			end
	
			if bCanSkip then
				sStep = "continue"
				iStack = -1
				tStepOver = nil
				tStack = nil
				iStackStep = 0
				bDebugging = false
				sendmessage {
					type = "continue"
				}
			end
		end, "lcr" )
	end
	
	stopdebug = function()
		bDebugging = false
		sStep = "continue"
		iStack = -1
		tStepOver = nil
		tStack = nil
		iStackStep = 0
		bCanSkip = true
		debug.sethook()
	end
	local frames
	local framesdt
	dobreak = function( tStack )
		frames = {}
		framesdt = {}
		local tPtr = tStack
		local iF = 3
		while tPtr and tPtr.src ~= "TOP" do
			local args = {}
			local locals = {}
			local upvalues = {}
			local info = {args={},locals={},upvalues={},expr={}}
			framesdt[#framesdt + 1] = info
			for name, val in lpairs(iF, debug.getlocal) do
				if name ~= "(*temporary)" then
					if #args < tPtr.info.nparams then
						args[#args + 1] = {
							name = name,
							type = type(val),
							val = tostring(val)
						}
						info.args[name] = val
					else
						locals[#locals + 1] = {
							name = name,
							type = type(val),
							val = tostring(val)
						}
						info.locals[name] = val
					end
				end
			end
			for name, val in lpairs(tPtr.info.func, debug.getupvalue) do
				upvalues[#upvalues + 1] = {
					name = name,
					type = type(val),
					val = tostring(val)
				}
				info.upvalues[name] = val
			end
			iF = iF + 1
			frames[#frames + 1] = {
				file = tPtr.src,
				line = tPtr.line,
				column = 0,
				args = args,
				locals = locals,
				upvalues = upvalues
			}
			tPtr = tPtr.previous
		end
		sendmessage {
			type = "Frame",
			info = frames
		}
		while true do
			local s = sv:ReadString()
			if not s then return stopdebug() end
			local b, m = pcall(onmessage, util.JSONToTable(s))
			if b and m then
				return m
			elseif not b then
				ErrorNoHalt(m)
				stopdebug()
			end
		end
	end
	
	local oframe = {expr={}}
	
	onmessage = function( tMsg )
		if tMsg.type == "StartDebug" then
			startdebug(tMsg.info)
			return "continue"
		elseif tMsg.type == "BreakpointUpd" then
			updatebreakpoints(tMsg.info)
		elseif tMsg.type == "DetailReq" then
			local tp, fr, dt = tMsg.info:match("([^_]+)_([^.]+)%.(.*)")
			local vars = (framesdt and framesdt[tonumber(fr) + 1] or oframe)[tp]
			local var = vars
			for n in dt:gmatch("[^.]+") do
				if n:sub(1,1) == "\"" then
					var = var[n:sub(2, -2)]
				else
					local nm = tonumber(n)
					if nm then
						var = var[nm]
					else
						for k, v in pairs(var) do
							if tostring(k) == n then
								var = v
								break
							end
						end
					end
				end
			end
			local vals = {}
			for k,v in pairs(var) do
				if type(k) == "string" then
					k = "\"" .. k .. "\""
				else
					k = tostring(k)
				end
				vals[#vals + 1] = {
					name = k,
					type = type(v),
					val = tostring(v)
				}
			end
			sendmessage{
				type = "DetailRsp",
				info = vals
			}
		elseif tMsg.type == "EvalReq" then
			local code = ""
			local args = {}
			local frame
			if tMsg.info.frame then
				frame = framesdt[tMsg.info.frame + 1]
				local i = 1
				for k,v in pairs(frame.upvalues) do
					code = string.format("%slocal %s = select(%d, ...)\n", code, k, i) args[i]=v i=i+1
				end
				for k,v in pairs(frame.args) do
					code = string.format("%slocal %s = select(%d, ...)\n", code, k, i) args[i]=v i=i+1
				end
				for k,v in pairs(frame.locals) do
					if k:match("^[a-zA-Z_][^ ]*$") then
						code = string.format("%slocal %s = select(%d, ...)\n", code, k, i)
						args[i] = v i = i + 1
					end
				end
			else
				frame = oframe
			end
			local fn, err = CompileString(code .. "return " .. tMsg.info.expression, tMsg.info.context)
			local response = {id = tMsg.info.id, type = "nil", val = "nil"}
			if not fn then
				response.type = "error"
				response.val = err
			else
				local success, val = pcall(fn, unpack(args))
				if not success then
					response.type = "error"
					response.val = err
				else
					response.type = type(val)
					response.val = tostring(val)
					frame.expr[tMsg.info.id] = val
				end
			end
			sendmessage{
				type = "EvalRsp",
				info = response
			}
		elseif tMsg.type == "continue" then
			return "continue"
		elseif tMsg.type == "step" then
			if tMsg.info == "stopOnStep" then
				return "over"
			elseif tMsg.info == "stepIn" then
				return "in"
			elseif tMsg.info == "stepOut" then
				return "out"
			end
		end
	end

	sendmessage = function( tMsg )
		sv:WriteString( util.TableToJSON( tMsg ) )
	end