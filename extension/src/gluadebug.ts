import {
	Logger, logger,
	LoggingDebugSession,
	InitializedEvent, TerminatedEvent, StoppedEvent, BreakpointEvent, OutputEvent,
	Thread, StackFrame, Scope, Source, Handles, Breakpoint, ContinuedEvent
} from 'vscode-debugadapter';
import { DebugProtocol } from 'vscode-debugprotocol';
import { basename } from 'path';
import { GLuaRuntime, GLuaBreakpoint } from './gluaruntime';
const { Subject } = require('await-notify');

interface AttachRequestArguments extends DebugProtocol.AttachRequestArguments {
	garrysmod: string;
	host: string;
	key: string;
}

export class GLuaDebugSession extends LoggingDebugSession {

	private static THREAD_ID = 1;

	private _runtime: GLuaRuntime;

	private _variableHandles = new Handles<string>();

	private _configurationDone = new Subject();

	public constructor() {
		super("gluadebug.log");

		this.setDebuggerLinesStartAt1(true);
		this.setDebuggerColumnsStartAt1(true);

		this._runtime = new GLuaRuntime();

		// setup event handlers
		this._runtime.on('stopOnEntry', () => {
			this.sendEvent(new StoppedEvent('entry', GLuaDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnStep', () => {
			this.sendEvent(new StoppedEvent('step', GLuaDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnBreakpoint', () => {
			this.sendEvent(new StoppedEvent('breakpoint', GLuaDebugSession.THREAD_ID));
		});
		this._runtime.on('stopOnException', () => {
			this.sendEvent(new StoppedEvent('exception', GLuaDebugSession.THREAD_ID));
		});
		this._runtime.on('continue', () => {
			this.sendEvent(new ContinuedEvent(GLuaDebugSession.THREAD_ID));
		});
		this._runtime.on('breakpointValidated', (bp: GLuaBreakpoint) => {
			this.sendEvent(new BreakpointEvent('changed', <DebugProtocol.Breakpoint>{ verified: bp.verified, id: bp.id }));
		});
		this._runtime.on('output', (text, filePath, line, column) => {
			const e: DebugProtocol.OutputEvent = new OutputEvent(`${text}\n`);
			e.body.source = this.createSource(filePath);
			e.body.line = this.convertDebuggerLineToClient(line);
			e.body.column = this.convertDebuggerColumnToClient(column);
			this.sendEvent(e);
		});
		this._runtime.on('end', () => {
			this.sendEvent(new TerminatedEvent());
		});
	}

	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDoneRequest.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code to use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = false;

		// make VS Code to show a 'step back' button
		response.body.supportsStepBack = false;


		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected async attachRequest(response: DebugProtocol.AttachResponse, args: AttachRequestArguments) {
		logger.setup(Logger.LogLevel.Verbose, false);
		await this._configurationDone.wait(1000);
		this._runtime.start(args.garrysmod, args.host, args.key).then(() => {
			logger.log("adapter then");
			this.sendResponse(response);
		}).catch(err => {
			logger.log("adapter catch");
			response.message = err;
			response.success = false;
			this.sendErrorResponse(response, err);
		});
 
	}

	protected setBreakPointsRequest(response: DebugProtocol.SetBreakpointsResponse, args: DebugProtocol.SetBreakpointsArguments): void {

		const path = <string>args.source.path;
		const clientLines = args.lines || [];

		// clear all breakpoints for this file
		this._runtime.clearBreakpoints(path);

		// set and verify breakpoint locations
		const actualBreakpoints = clientLines.map(l => {
			let { verified, line, id } = this._runtime.setBreakPoint(path, this.convertClientLineToDebugger(l));
			const bp = <DebugProtocol.Breakpoint> new Breakpoint(verified, this.convertDebuggerLineToClient(line));
			bp.id= id;
			return bp;
		});

		// send back the actual breakpoint positions
		response.body = {
			breakpoints: actualBreakpoints
		};
		this.sendResponse(response);
	}

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports now threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(GLuaDebugSession.THREAD_ID, "thread 1")
			]
		};
		this.sendResponse(response);
	}

	protected stackTraceRequest(response: DebugProtocol.StackTraceResponse, args: DebugProtocol.StackTraceArguments): void {

		const startFrame = typeof args.startFrame === 'number' ? args.startFrame : 0;
		const maxLevels = typeof args.levels === 'number' ? args.levels : 1000;
		const endFrame = startFrame + maxLevels;

		const stk = this._runtime.stack(startFrame, endFrame);

		response.body = {
			stackFrames: stk.frames.map(f => new StackFrame(f.index, f.name, this.createSource(f.file), this.convertDebuggerLineToClient(f.line), this.convertDebuggerColumnToClient(f.column))),
			totalFrames: stk.count
		};
		this.sendResponse(response);
	}

	protected scopesRequest(response: DebugProtocol.ScopesResponse, args: DebugProtocol.ScopesArguments): void {

		const frameReference = args.frameId;
		const scopes = new Array<Scope>();
		scopes.push(new Scope("Arguments", this._variableHandles.create("args_" + frameReference), false));
		scopes.push(new Scope("Locals", this._variableHandles.create("locals_" + frameReference), false));
		scopes.push(new Scope("Upvalues", this._variableHandles.create("upvalues_" + frameReference), false));

		response.body = {
			scopes: scopes
		};
		this.sendResponse(response);
	}

	protected variablesRequest(response: DebugProtocol.VariablesResponse, args: DebugProtocol.VariablesArguments): void {

		const variables = new Array<DebugProtocol.Variable>();
		const id = this._variableHandles.get(args.variablesReference);
		let mts = id.match(/([^_]+)_(.*)/);
		if(mts) {
			let type = mts[1], frame = mts[2];
			if(type == "subvar") {
				(this._runtime[type](frame) as Promise<any>).then(v => {
					v.forEach((val) => {
						if(val.type == "table") {
							variables.push({
								name: val.name,
								type: "table",
								value: val.val,
								variablesReference: this._variableHandles.create("subvar_" + frame + "." + val.name)
							});
						} else
							variables.push({
								name: val.name,
								type: val.type == "number" ? "float" : val.type,
								value: val.val,
								variablesReference: 0
							});
					});

					response.body = {
						variables: variables
					};
					this.sendResponse(response);
				});
			} else {
				(this._runtime[type](parseInt(frame)) as Array<any>).forEach((val) => {
					if(val.type == "table") {
						variables.push({
							name: val.name,
							type: "table",
							value: val.val,
							variablesReference: this._variableHandles.create("subvar_" + type + "_" + frame + "." + val.name)
						});
					} else
						variables.push({
							name: val.name,
							type: val.type == "number" ? "float" : val.type,
							value: val.val,
							variablesReference: 0
						});
				});

				response.body = {
					variables: variables
				};
				this.sendResponse(response);
			}
		}
	}

	protected continueRequest(response: DebugProtocol.ContinueResponse, args: DebugProtocol.ContinueArguments): void {
		this._runtime.continue();
		this.sendResponse(response);
	}

	protected nextRequest(response: DebugProtocol.NextResponse, args: DebugProtocol.NextArguments): void {
		this._runtime.step();
		this.sendResponse(response);
	}

	protected stepInRequest(response: DebugProtocol.StepInResponse, args: DebugProtocol.StepInArguments): void {
		this._runtime.step("stepIn");
		this.sendResponse(response);
	}

	protected stepOutRequest(response: DebugProtocol.StepOutResponse, args: DebugProtocol.StepOutArguments): void {
		this._runtime.step("stepOut");
		this.sendResponse(response);
	}

	private _exprid = 1;
	protected evaluateRequest(response: DebugProtocol.EvaluateResponse, args: DebugProtocol.EvaluateArguments): void {

		/*if (args.context === 'repl') {
			// 'evaluate' supports to create and delete breakpoints from the 'repl':
			const matches = /new +([0-9]+)/.exec(args.expression);
			if (matches && matches.length === 2) {
				const mbp = this._runtime.setBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
				const bp = <DebugProtocol.Breakpoint> new Breakpoint(mbp.verified, this.convertDebuggerLineToClient(mbp.line), undefined, this.createSource(this._runtime.sourceFile));
				bp.id= mbp.id;
				this.sendEvent(new BreakpointEvent('new', bp));
				reply = `breakpoint created`;
			} else {
				const matches = /del +([0-9]+)/.exec(args.expression);
				if (matches && matches.length === 2) {
					const mbp = this._runtime.clearBreakPoint(this._runtime.sourceFile, this.convertClientLineToDebugger(parseInt(matches[1])));
					if (mbp) {
						const bp = <DebugProtocol.Breakpoint> new Breakpoint(false);
						bp.id= mbp.id;
						this.sendEvent(new BreakpointEvent('removed', bp));
						reply = `breakpoint deleted`;
					}
				}
			}
		}*/

		let id = "E" + this._exprid++;
		this._runtime.evaluate(id, args.expression, args.context, args.frameId).then((reply) => {
			if(reply.type == "table") {
				response.body = {
					type: "table",
					result: reply.val,
					variablesReference: this._variableHandles.create("subvar_expr_" + args.frameId + "." + id)
				};
			} else
				response.body = {
					type: reply.type == "number" ? "float" : reply.type,
					result: reply.val,
					variablesReference: 0
				};
			this.sendResponse(response);
		});
	}

	//---- helpers

	private createSource(filePath: string): Source {
		return new Source(basename(filePath), this.convertDebuggerPathToClient(filePath), undefined, undefined, 'glua-adapter-data');
	}
}