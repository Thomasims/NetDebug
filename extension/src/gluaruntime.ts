import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import { createConnection, Socket } from 'net';
import { logger } from 'vscode-debugadapter';

export interface GLuaBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

/**
 * A Mock runtime with minimal debugger functionality.
 */
export class GLuaRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string;
	public get sourceFile() {
		return this._sourceFile;
	}

	// the contents (= lines) of the one and only file
	private _sourceLines: string[];

	// This is the next line that will be 'executed'
	private _currentLine = 0;

	// maps from sourceFile to array of Mock breakpoints
	private _breakPoints = new Map<string, GLuaBreakpoint[]>();

	// since we want to send breakpoint events, we will assign an id to every event
	// so that the frontend can match events with breakpoints.
	private _breakpointId = 1;
	
	private _connection: Socket;


	constructor() {
		super();
	}

	/**
	 * Start executing the given program.
	 */
	public start(garrysmod: string, host: string, key: string): Promise<string> {

		this.loadSource(garrysmod);
		this._currentLine = 2;

		let runtime = this;
		return new Promise((success, reject) => {
			let matches = host.match("([^:]+)(?::(.*))?");
			if(!matches) {
				reject("Invalid Host");
				return;
			};
			runtime._connection = createConnection(parseInt(matches[2] || "27100"), matches[1]);
			runtime._connection.setTimeout(1000);
			runtime._connection.on("error", err => {
				logger.log("runtime error");
				reject(err.message);
			});
			runtime._connection.on("close", () => {
				logger.log("runtime close");
				runtime.sendEvent('end');
			});
			runtime._connection.on("connect", () => {
				logger.log("runtime open");
				success();
				runtime.verifyBreakpoints(runtime._sourceFile);
				runtime.sendEvent('output', "abc", runtime._sourceFile, 2, 7);
				runtime.sendEvent('stopOnBreakpoint');
				runtime.continue();
			});
		});
	}

	/**
	 * Continue execution to the end/beginning.
	 */
	public continue() {
		
	}

	/**
	 * Step to the next/previous non empty line.
	 */
	public step(event = 'stopOnStep') {
		this.sendEvent(event);
	}

	/**
	 * Returns a fake 'stacktrace' where every 'stackframe' is a word from the current line.
	 */
	public stack(startFrame: number, endFrame: number): any {

		const words = this._sourceLines[this._currentLine].trim().split(/\s+/);

		const frames = new Array<any>();
		// every word of the current line becomes a stack frame.
		for (let i = startFrame; i < Math.min(endFrame, words.length); i++) {
			const name = words[i];	// use a word of the line as the stackframe name
			frames.push({
				index: i,
				name: `${name}(${i})`,
				file: this._sourceFile,
				line: this._currentLine
			});
		}
		return {
			frames: frames,
			count: words.length
		};
	}

	/*
	 * Set breakpoint in file with given line.
	 */
	public setBreakPoint(path: string, line: number) : GLuaBreakpoint {

		const bp = <GLuaBreakpoint> { verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<GLuaBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(path);

		return bp;
	}

	/*
	 * Clear breakpoint in file with given line.
	 */
	public clearBreakPoint(path: string, line: number) : GLuaBreakpoint | undefined {
		let bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				return bp;
			}
		}
		return undefined;
	}

	/*
	 * Clear all breakpoints for file.
	 */
	public clearBreakpoints(path: string): void {
		this._breakPoints.delete(path);
	}

	// private methods

	private loadSource(file: string) {
		if (this._sourceFile !== file) {
			this._sourceFile = file;
			this._sourceLines = readFileSync(this._sourceFile).toString().split('\n');
		}
	}

	private verifyBreakpoints(path: string) : void {
		let bps = this._breakPoints.get(path);
		if (bps) {
			this.loadSource(path);
			bps.forEach(bp => {
				if (!bp.verified && bp.line < this._sourceLines.length) {
					const srcLine = this._sourceLines[bp.line].trim();
					if (srcLine.length !== 0) {
						bp.verified = true;
						this.sendEvent('breakpointValidated', bp);
					}
				}
			});
		}
	}

	private sendEvent(event: string, ... args: any[]) {
		setImmediate(_ => {
			this.emit(event, ...args);
		});
	}
}