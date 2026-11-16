import type { UIMessage } from "ai";
import { createContext, useContext } from "react";

export interface ChatConnection {
	messages: UIMessage[];
	status: "submitted" | "streaming" | "ready" | "error";
	error: Error | undefined;
	send: (text: string) => void;
	stop: () => void;
	/** Ask the last question again. */
	retry: () => void;
	transport: "websocket" | "http";
}

export const ChatContext = createContext<ChatConnection | null>(null);

/** The open conversation's connection (inside ChatConnectionProvider). */
export function useChatConnection(): ChatConnection {
	const chat = useContext(ChatContext);
	if (!chat) throw new Error("useChatConnection must be used inside ChatConnectionProvider");
	return chat;
}

/** The chat's live connection failed (blocked or dropped WebSocket, network error). */
export const isConnectionError = (e: Error | undefined) => !!e && /websocket|connection|network|failed to fetch|load failed/i.test(e.message);
