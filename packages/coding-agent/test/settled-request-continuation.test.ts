import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	getCurrentSystemMessage,
	getModel,
	type Model,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

interface SeenRequest {
	model: Model<any>;
	context: TranscriptContext;
	options: SimpleStreamOptions | undefined;
}

function assistant(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 10,
			output: 2,
			cacheRead: 8,
			cacheWrite: 0,
			totalTokens: 20,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("settled request continuation", () => {
	let session: AgentSession | undefined;
	let tempDir: string | undefined;

	afterEach(() => {
		session?.dispose();
		if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
	});

	it("preserves the latest request and appends exactly one user message", async () => {
		tempDir = join(tmpdir(), `pi-settled-request-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		const requests: SeenRequest[] = [];
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: "Stable system prompt", tools: [] },
			streamFn: (requestModel, context, options) => {
				requests.push({ model: requestModel, context, options });
				const stream = createAssistantMessageEventStream();
				const response = assistant(requests.length === 1 ? "work completed" : "dense summary");
				queueMicrotask(() => {
					stream.push({ type: "start", partial: { ...response, content: [] } });
					stream.push({ type: "done", reason: "stop", message: response });
				});
				return stream;
			},
		});
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		await authStorage.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
		const modelRegistry = await createModelRegistry(authStorage, tempDir);
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager: SettingsManager.create(tempDir, tempDir),
			cwd: tempDir,
			modelRuntime: getModelRuntime(modelRegistry),
			resourceLoader: createTestResourceLoader(),
		});

		await session.prompt("Implement the change");
		const result = await session.extensionRunner
			.createContext()
			.completeFromLatestSettledRequest("Summarize without calling tools");

		expect(result.content).toEqual([{ type: "text", text: "dense summary" }]);
		expect(requests).toHaveLength(2);
		const [source, continuation] = requests;
		expect(continuation.model).toBe(source.model);
		expect(getCurrentSystemMessage(continuation.context.messages)).toEqual(
			getCurrentSystemMessage(source.context.messages),
		);
		expect(continuation.options?.sessionId).toBe(source.options?.sessionId);
		expect(continuation.options?.reasoning).toBe(source.options?.reasoning);
		expect(continuation.context.messages.slice(0, source.context.messages.length)).toEqual(source.context.messages);
		expect(continuation.context.messages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", text: "Summarize without calling tools" }],
		});
	});
});
