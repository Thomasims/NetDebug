import { readFileSync } from 'fs';
import { EventEmitter } from 'events';
import { createConnection, Socket } from 'net';
import { logger } from 'vscode-debugadapter';
import { createHash } from 'crypto';

export interface GLuaBreakpoint {
	id: number;
	line: number;
	verified: boolean;
}

interface LuaKeyPair {
	key: string;
	type: string;
	value: any;
}

interface LuaPosition {
	file: string;
	line: number;
	column: number;
	args: LuaKeyPair[];
	locals: LuaKeyPair[];
	upvalues: LuaKeyPair[];
}

interface LuaMessage {
	type: string;
	info: any;
}

export class GLuaRuntime extends EventEmitter {
	private _garrysmod: string;
	private _key: string;
	private _stack: LuaPosition[];
	private _ready: boolean;

	private _breakPoints = new Map<string, GLuaBreakpoint[]>();

	private _breakpointId = 1;
	
	private _connection: Socket;

	private _evalreq: Map<string, (value: any) => void>;


	constructor() {
		super();
	}

	public start(garrysmod: string, host: string, key: string): Promise<string> {
		logger.log("start");

		this._garrysmod = garrysmod;
		this._key = key;
		this._ready = false;

		this._evalreq = new Map<string, (value: any) => void>();

		let runtime = this;
		return new Promise((success, reject) => {
			let matches = host.match("([^:]+)(?::(.*))?");
			if(!matches) {
				reject("Invalid Host");
				return;
			};
			runtime._connection = createConnection(parseInt(matches[2] || "27100"), matches[1]);
			runtime._connection.setTimeout(10000);
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
				runtime.sendToLua({type:"AuthReq"});
				success();
			});
			let reading: boolean = false;
			let readingsize: number = 0, readingpos: number = 0;
			let readingbuffer: Buffer;
			runtime._connection.on("data", data => {
				let offset = 0;
				if(!reading) {
					readingsize = data.readUInt32BE(0);
					offset = 4;
					readingbuffer = new Buffer(new ArrayBuffer(readingsize));
					readingpos = 0;
					reading = true;
				}
				data.copy(readingbuffer, readingpos, offset);
				readingpos += data.length - offset;
				if(readingpos == readingsize) {
					logger.log("received frame");
					try {
						runtime.receiveFromLua(JSON.parse(readingbuffer.toString('utf8')));
					} catch(e) {
						logger.log(e);
					}
					reading = false;
				}
			});
		});
	}

	public continue() {
		logger.log("continue");
		this.sendToLua({
			type: "continue"
		});
	}

	public step(event = 'stopOnStep') {
		logger.log("step");
		this.sendEvent(event);
		this.sendToLua({
			type: "step",
			info: event
		});
	}

	public stack(startFrame: number, endFrame: number): any {
		logger.log("stack");
		const frames = new Array<any>();
		for (let i = startFrame; i < Math.min(endFrame, this._stack.length); i++) {
			const frame = this._stack[i];
			let file = frame.file.match(/[^\\\/]+$/);
			frames.push({
				index: i,
				name: `${file}:${frame.line}`,
				file: frame.file,
				line: frame.line,
				column: frame.column
			});
		}
		return {
			frames: frames,
			count: this._stack.length
		};
	}

	private _varreq: (value: any) => void;
	public subvar(frame: string): Promise<any> {
		return new Promise<any>(success => {
			this._varreq = success;
			this.sendToLua({
				type: "DetailReq",
				info: frame
			})
		});
	}

	public args(frame: string): LuaKeyPair[] {
		return this._stack[frame].args;
	}

	public locals(frame: string): LuaKeyPair[] {
		return this._stack[frame].locals;
	}

	public upvalues(frame: string): LuaKeyPair[] {
		return this._stack[frame].upvalues;
	}

	public evaluate(id: string, expression: string, context?: string, frameId?: number): Promise<any> {
		this.sendToLua({
			type: "EvalReq",
			info: {
				id: id,
				expression: expression,
				context: context,
				frame: frameId
			}
		})
		return new Promise<any>(success => {
			this._evalreq.set(id, success);
		});
	}

	public setBreakPoint(path: string, line: number) : GLuaBreakpoint {
		logger.log("setBreakPoint");
		const bp = <GLuaBreakpoint> { verified: false, line, id: this._breakpointId++ };
		let bps = this._breakPoints.get(path);
		if (!bps) {
			bps = new Array<GLuaBreakpoint>();
			this._breakPoints.set(path, bps);
		}
		bps.push(bp);

		this.verifyBreakpoints(path);
		this.updateBreakpoints();

		return bp;
	}

	public clearBreakPoint(path: string, line: number) : GLuaBreakpoint | undefined {
		logger.log("clearBreakPoint");
		let bps = this._breakPoints.get(path);
		if (bps) {
			const index = bps.findIndex(bp => bp.line === line);
			if (index >= 0) {
				const bp = bps[index];
				bps.splice(index, 1);
				this.updateBreakpoints();
				return bp;
			}
		}
		return undefined;
	}

	public clearBreakpoints(path: string): void {
		logger.log("clearBreakpoints");
		this._breakPoints.delete(path);
		this.updateBreakpoints();
	}

	private _lasttimeout: NodeJS.Timer | null;
	private updateBreakpoints(nosend?: boolean | undefined): any {
		let breakpoints = new Array<any>();
		this._breakPoints.forEach((bps, path) => {
			if(path.startsWith(this._garrysmod)) {
				let src = (path.substr(this._garrysmod.length)).replace(/\\/g,"/");
				bps.forEach(bp => {
					breakpoints.push({
						src: src,
						line: bp.line
					});
				});
			}
		});
		if(this._ready && !nosend) {
			if(this._lasttimeout)
				clearTimeout(this._lasttimeout);
			this._lasttimeout = setTimeout(() => {
				this.sendToLua({
					type: "BreakpointUpd",
					info: this.updateBreakpoints(true)
				})
				this._lasttimeout = null;
			}, 100);
		}
		return breakpoints;
	}

	private verifyBreakpoints(path: string) : void {
		let bps = this._breakPoints.get(path);
		if (bps) {
			let lines = readFileSync(path).toString().split('\n');
			bps.forEach(bp => {
				if (!bp.verified && bp.line < lines.length) {
					const srcLine = lines[bp.line - 1].trim();
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

	private receiveFromLua(data: LuaMessage) {
		switch(data.type) {
			case "Frame":
				let garrysmod = this._garrysmod;
				this._stack = data.info as LuaPosition[];
				this._stack.forEach(frame => {
					frame.file = garrysmod + frame.file;
				});
				let frame = this._stack[0];
				this.sendEvent('output', "step", frame.file, frame.line, frame.column);
				this.sendEvent('stopOnBreakpoint');
				break;
			case "AuthRsp":
				let hash = createHash("sha256");
				hash.update(this._key);
				hash.update(data.info as string);
				this.sendToLua({
					type: "AuthRsp",
					info: hash.digest("hex")
				});
				this.sendToLua({
					type: "StartDebug",
					info: {
						breakpoints: this.updateBreakpoints(true)
					}
				});
				this._ready = true;
				break;
			case "DetailRsp":
				this._varreq(data.info as LuaKeyPair[]);
				break;
			case "EvalRsp":
				let fn = this._evalreq.get(data.info.id);
				if(fn)
					fn(data.info);
				this._evalreq.delete(data.info.id);
				break;
			case "continue":
				this.sendEvent("continue");
		}
	}

	private sendToLua(data: any) {
		let str = JSON.stringify(data);
		let length = Buffer.byteLength(str, 'utf8');
		var ar = new ArrayBuffer(length + 4);
		var buffer = new Buffer(ar);
		buffer.writeInt32BE(length, 0);
		buffer.write(str, 4, undefined, "utf8");
		this._connection.write(buffer);
	}
}