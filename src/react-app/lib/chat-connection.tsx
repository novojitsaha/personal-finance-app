// How the chat page talks to a conversation's ChatAgent.
//
// Preferred: a WebSocket (Agents SDK useAgentChat), which streams answers and
// can resume a stream after a short drop. Some networks block WebSockets
// (corporate web filters such as Zscaler): the socket never opens or is cut,
// and the question never reaches the server. Then the chat switches to plain
// HTTP: POST /agents/chat-agent/<id>/http-chat, answered as a server-sent
// event stream (AI SDK DefaultChatTransport). Both paths read and write the
// same saved conversation. Once HTTP was needed, it is used straight away for
// a day, so a filtered network doesn't wait for the WebSocket every time.
import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useChat } from "@ai-sdk/react";
import { useAgent } from "agents/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type ChatConnection, ChatContext, isConnectionError } from "./chat-context";


const PREF_KEY = "chat-transport";
const HTTP_FOR_MS = 24 * 3600 * 1000;
/** How long to wait for the WebSocket before using HTTP. */
const CONNECT_TIMEOUT_MS = 5000;

function preferHttp(): boolean {
	try {
		const until = Number(localStorage.getItem(PREF_KEY));
		return Number.isFinite(until) && until > Date.now();
	} catch {
		return false;
	}
}
function rememberHttp() {
	try {
		localStorage.setItem(PREF_KEY, String(Date.now() + HTTP_FOR_MS));
	} catch {
		/* storage unavailable: fall back again next time */
	}
}


/** Gives `children` (via useChatConnection) a working connection to conversation `id`. */
export function ChatConnectionProvider({ id, children }: { id: string; children: React.ReactNode }) {
	const [http, setHttp] = useState(preferHttp);
	// A question typed while the WebSocket was failing, to send again over HTTP.
	const [pending, setPending] = useState<string | null>(null);
	if (http) return <HttpChat id={id} pending={pending}>{children}</HttpChat>;
	return (
		<WebSocketChat
			id={id}
			onFallback={(unsent) => {
				rememberHttp();
				setPending(unsent);
				setHttp(true);
			}}
		>
			{children}
		</WebSocketChat>
	);
}

function WebSocketChat({ id, onFallback, children }: { id: string; onFallback: (unsent: string | null) => void; children: React.ReactNode }) {
	const agent = useAgent({ agent: "ChatAgent", name: id });
	const chat = useAgentChat({ agent });
	const lastSent = useRef<string | null>(null);
	const answered = useRef(false);

	// Fall back if the socket hasn't opened in time, or drops before any answer arrived.
	useEffect(() => {
		const timer = setTimeout(() => {
			if (agent.readyState !== WebSocket.OPEN) onFallback(lastSent.current);
		}, CONNECT_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [agent, onFallback]);
	useEffect(() => {
		if (chat.status === "streaming") answered.current = true;
		if (isConnectionError(chat.error) && !answered.current) onFallback(lastSent.current);
	}, [chat.status, chat.error, onFallback]);

	const { sendMessage } = chat;
	const send = useCallback(
		(text: string) => {
			lastSent.current = text;
			answered.current = false;
			sendMessage({ text });
		},
		[sendMessage],
	);
	const value: ChatConnection = {
		messages: chat.messages,
		status: chat.status,
		error: chat.error,
		send,
		stop: () => chat.stop(),
		retry: () => {
			chat.clearError();
			chat.regenerate();
		},
		transport: "websocket",
	};
	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

function HttpChat({ id, pending, children }: { id: string; pending: string | null; children: React.ReactNode }) {
	const [initial, setInitial] = useState<UIMessage[] | null>(null);
	useEffect(() => {
		let cancelled = false;
		fetch(`/agents/chat-agent/${id}/get-messages`, { credentials: "same-origin" })
			.then((r) => (r.ok ? r.json() : []))
			.catch(() => [])
			.then((m: UIMessage[]) => !cancelled && setInitial(Array.isArray(m) ? m : []));
		return () => {
			cancelled = true;
		};
	}, [id]);
	if (!initial) return <p className="p-6 text-sm text-muted-foreground">Loading chat…</p>;
	return (
		<HttpChatLoaded id={id} initial={initial} pending={pending}>
			{children}
		</HttpChatLoaded>
	);
}

function HttpChatLoaded({ id, initial, pending, children }: { id: string; initial: UIMessage[]; pending: string | null; children: React.ReactNode }) {
	const transport = useMemo(() => new DefaultChatTransport({ api: `/agents/chat-agent/${id}/http-chat`, credentials: "same-origin" }), [id]);
	const chat = useChat({ id, messages: initial, transport });
	// Resend the question the WebSocket couldn't deliver (unless the server has
	// it). Deferred, so a dev-mode double effect run sends it once.
	const resent = useRef(false);
	useEffect(() => {
		if (resent.current || !pending) return;
		const timer = setTimeout(() => {
			resent.current = true;
			const last = initial[initial.length - 1];
			const text = last?.role === "user" ? last.parts.map((p: UIMessage["parts"][number]) => (p.type === "text" ? p.text : "")).join("") : null;
			if (text === pending) void chat.regenerate();
			else void chat.sendMessage({ text: pending });
		}, 0);
		return () => clearTimeout(timer);
	}, [pending, initial, chat]);
	const value: ChatConnection = {
		messages: chat.messages,
		status: chat.status,
		error: chat.error,
		send: (text) => void chat.sendMessage({ text }),
		stop: () => void chat.stop(),
		retry: () => {
			chat.clearError();
			void chat.regenerate();
		},
		transport: "http",
	};
	return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
