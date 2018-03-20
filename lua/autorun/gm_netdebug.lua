
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

if SERVER then AddCSLuaFile() end
if not pcall( require, "netdebug" ) then return end

netdebug.bind( config.address, config.port )
netdebug.setkey( config.key )

-- Utility function to iterate over locals/upvalues
local lpairs = function( fFunc, fFetcher )
	local i = 0
	return function()
		i = i + 1
		return fFetcher( fFunc, i ) 
	end
end

netdebug.startdebug = function( tDebug )
	local tLines = {}
	for i, tBreakpoint in ipairs( tDebug.breakpoints ) do
		-- I know this may seem backwards but it allows for better performance while debugging.
		tLines[tBreakpoint.line] = tLines[tBreakpoint.line] or {}
		tLines[tBreakpoint.line][tBreakpoint.src] = true
	end
	local bCanSkip = true
	local sStep, iStackStep = "continue", 0
	local tStepOver
	local tStack
	local iStack = -1
	debug.sethook( function( sType, iLine )
		if bCanSkip and sType ~= "line" then return end
		local tFiles = tLines[iLine]
		if bCanSkip and not tFiles then return end
		local sSrc = debug.getinfo( 2, "S" ).short_src
		if bCanSkip and not tFiles[sSrc] then return end
		
		if bCanSkip then -- We've just hit a breakpoint, construct the call stack
			tStack = { src = "TOP", line = -1, previous = {}}
			local tInfo = debug.getinfo( 3, "lS" )
			local i = 3
			local tPtr = tStack.previous
			while tInfo do
				tPtr.src = tInfo.short_src
				tPtr.line = tInfo.currentline
				tPtr.previous = {}
				tPtr = tPtr.previous
				i = i + 1
				tInfo = debug.getinfo( i, "lS" )
			end
			iStack = i - 2
			bCanSkip = false
			sStep = "in"
		end

		local bShouldBreak = false

		if sType == "line" then
			-- DONE: Break if this is a breakpoint
			-- DONE: Break if we're just stepping
			if sStep == "in" or iStack <= iStackStep then
				bShouldBreak = true
			end
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
			if sSrc == "[C]" then return end -- Don't bother adding C calls to the stack, return is never called.
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
		elseif sType == "return" then
			-- DONE: Update stack
			-- DONE: Set breaktype to in if iStack is back
			tStack = tStack.previous
			iStack = iStack - 1
			if sStep == "over" and iStack <= iStackStep then
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
			end
		end

		if bShouldBreak then
			sStep = netdebug.onbreak( sSrc, iLine )
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
		end
	end, "lcr" )
end

netdebug.stopdebug = function()
	debug.sethook()
end