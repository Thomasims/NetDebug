# NetDebug
Garry's Mod lua debugger for VSCode

This allows you to debug (place breakpoints, step through code, ..) a Garry's Mod server using the debugger interface in VSCode.

***The following information is not fool-proof and assumes a basic understanding of 

# Building
There are 3 main parts to this project:
- The VSCode extension that'll interface between the debugging tools and the game.
- The GMod binary module, used to obtain blocking sockets to pause execution.
- The GMod lua code that implements to protocol to talk to the extension.

### VSCode extension
This is my first attempt at making a VSCode extension so these instructions may not work for you.
- Open uo a terminal in the cloned directory, cd into `extension`
- Type `npm install` (I'm not sure this is necessary)
- Type `npm run package`, it should create a *.vsix file in that directory
- In VSCode, in the extension menu, select the 3 dots at the top and choose `Install from VSIX`
- Select the *.vsix file that you just created and it should install it.

### Binary module
I can't give a complete set of instructions on this one as I always have to fiddle with stuff when I make one,
so I'll have to redirect you to this page: https://wiki.garrysmod.com/page/Creating_Binary_Modules
There are a couple of things to note:
- I used premake5, not premake4 like those instructions say. I don't know how big of an impact this has.
- You'll need to add the OpenSSL headers and libs to your project (I used it for the auth and may later do more with it).
- You'll need to put `libcrypto-1_1.dll` next to the server executable as a result.
- This module may work on the client, I have not tested this. But you'll have to rename the module to `gmcl_blocksocket_win32.dll` for it to load properly.

### Lua code
Now this is the easiest one, you just need to put the `lua/autorun/gm_netdebug.lua` in a place where it will be executed automatically.
Or just clone the project in the addons folder, the folder structure is already correct. (should be `addons/netdebug/lua/autorun/gm_netdebug.lua`)

# Running
- Edit the lua file and change the config there to suit your setup before launching the server.
- Launch the Garry's Mod server.
- Start a new debugging session in VSCode (F5) and choose `GLua Debug` (one the first run this will not launch but instead show the config)
- Modify the new launch configuration to suit your setup.
  - `garrysmod` should point to the `garrysmod` directory of the server (or a local copy). (This is the directory that contains `addons`, `gamemodes` and so on.)
  - `host` is a string in 2 parts seperated by a colon, the address and the port. Use the same as in the config of the lua file.
  - `key` is the key used in the config of the lua file
- Place breakpoints and start debugging in vscode.

# Notes
- The server uses a timer to listen for new requests. As such you will need to have a player (or a bot) on the server for it to run.
