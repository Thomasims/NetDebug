'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { GLuaDebugSession } from './gluadebug';
import * as Net from 'net';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.commands.registerCommand('extension.glua-netdebug.getGModDir', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the path to the garrysmod directory to use for providing source files.",
			value: ""
		});
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.glua-netdebug.getHost', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the host address and port to debug.",
			value: "localhost:27100"
		});
	}));
	context.subscriptions.push(vscode.commands.registerCommand('extension.glua-netdebug.getKey', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the key used by the server to debug.",
			value: "CHANGEME"
		});
	}));

	// register a configuration provider for 'mock' debug type
	const provider = new MockConfigurationProvider()
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('mock', provider));
	context.subscriptions.push(provider);
}

export function deactivate() {
	// nothing to do
}

class MockConfigurationProvider implements vscode.DebugConfigurationProvider {

	private _server?: Net.Server;

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor && editor.document.languageId === 'markdown' ) {
				config.type = 'mock';
				config.name = 'Launch';
				config.request = 'launch';
				config.program = '${file}';
				config.stopOnEntry = true;
			}
		}

		if (!config.program) {
			return vscode.window.showInformationMessage("Cannot find a program to debug").then(_ => {
				return undefined;	// abort launch
			});
		}

        if (!this._server) {

            // start listening on a random port
            this._server = Net.createServer(socket => {
                const session = new GLuaDebugSession();
                session.setRunAsServer(true);
                session.start(<NodeJS.ReadableStream>socket, socket);
            }).listen(0);
        }

        // make VS Code connect to debug server instead of launching debug adapter
        config.debugServer = this._server.address().port;

		return config;
	}

	dispose() {
		if (this._server) {
			this._server.close();
		}
	}
}